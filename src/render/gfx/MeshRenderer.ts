import { RenderFailures } from './RenderFailures'
import type {
  BindGroup,
  BindGroupEntry,
  BindGroupLayout,
  TargetFormat,
  DepthState,
  GfxDevice,
  Pipeline,
  RenderTarget,
  ShaderModule,
  ShadowArray,
  ShadowCube,
  Texture,
  UBuffer,
} from './GfxDevice'
import type { CameraView3D } from '../../camera/CameraView3D'
import type { Node } from '../../scene/Node'
import type { Node3D } from '../../scene/Node3D'
import { MeshNode } from '../../nodes/MeshNode'
import { Light3D } from '../../nodes/Light3D'
import { isEffectivelyVisible, walkTree } from '../../scene/traverse'
import { mat3, mat3NormalMatrix, type Mat3 } from '../../math/Mat3'
import {} from '../../math/shadowFit'
import { createFrustum, frustumFromMatrix } from '../../math/frustum'
import { RenderQuality } from '../RenderQuality'
import { Fog } from '../Fog'
import {
  CAMERA3D_UBO_BINDING,
  MESH_LIGHTS_UBO_BINDING,
  MESH_OBJECT_UBO_BINDING,
  MESH_SHADOW_UBO_BINDING,
} from './batchLayout'
import { UboRing } from './programs/programCommon'
import type { TextureInspector } from './TextureManager'
import type { ShaderReflection } from './GfxDevice'
import meshWgsl from './shaders/mesh.wgsl?raw'
import meshVertSrc from './shaders/mesh.gen.vert.glsl?raw'
import meshFragSrc from './shaders/mesh.gen.frag.glsl?raw'
import meshReflect from './shaders/mesh.reflect.json'
import meshPbrWgsl from './shaders/mesh_pbr.wgsl?raw'
import meshPbrVertSrc from './shaders/mesh_pbr.gen.vert.glsl?raw'
import meshPbrFragSrc from './shaders/mesh_pbr.gen.frag.glsl?raw'
import meshPbrReflect from './shaders/mesh_pbr.reflect.json'
import {
  FALLBACK_LIGHT,
  FLAT_FRAME_BYTES,
  FLAT_OBJECT_BYTES,
  LIGHTS_BYTES,
  PBR_FRAME_BYTES,
  PBR_OBJECT_BYTES,
  SHADOW_FRAME_BYTES,
  U_AO,
  U_PBR_TEX_BASE,
  U_SHADOW_ARRAY,
  U_SHADOW_CUBE,
  U_TEX,
  flatVertexLayout,
  pbrVertexLayout,
} from './mesh/meshLayout'
import { writeAoParams, writeFog, writeLights } from './mesh/meshUniforms'
import { MeshGeometryCache } from './mesh/MeshGeometryCache'
import { MeshTextures } from './mesh/MeshTextures'
import { ShadowPass } from './mesh/ShadowPass'
import { GBufferPass } from './mesh/GBufferPass'
import type { GpuMesh } from './mesh/meshTypes'
import { meshOutside } from './mesh/meshBounds'

/**
 * One mesh's draw in the main pass. Every mesh is recorded and has its uniforms
 * staged before the first draw is issued, so each ring uploads once.
 */
interface DrawRec {
  mesh: MeshNode
  gpu: GpuMesh
  pbr: boolean
  blended: boolean
  /** Index into the pipeline arrays, see {@link variantOf}. */
  variant: number
  /** Byte offset of the mesh's slice in its object ring. */
  offset: number
  /** Squared distance to the eye, for ordering. */
  dist: number
  /** Bound textures, one for the flat program and six for PBR. */
  tex: Texture[]
}

/** The object bind group a mesh last drew with, and what it was built from. */
interface ObjectGroup {
  pbr: boolean
  generation: number
  tex: Texture[]
  group: BindGroup
}

/** Pipeline array index from cull and depth write. */
function variantOf(doubleSided: boolean, write: boolean): number {
  return (doubleSided ? 2 : 0) + (write ? 1 : 0)
}

/**
 * Opaque meshes first, grouped by program and state and nearest first, so the
 * depth test rejects what hides behind them. Transparent meshes after, back to
 * front.
 */
function drawOrder(a: DrawRec, b: DrawRec): number {
  if (a.blended !== b.blended) return a.blended ? 1 : -1
  if (a.blended) return b.dist - a.dist
  if (a.pbr !== b.pbr) return a.pbr ? 1 : -1
  if (a.variant !== b.variant) return a.variant - b.variant
  return a.dist - b.dist
}

/**
 * Draws the 3D tree through the {@link GfxDevice} seam: a flat + a PBR pipeline,
 * per-mesh GPU buffers uploaded on demand, per-frame + per-object uniform
 * blocks, and back-to-front ordering so transparent surfaces blend correctly.
 *
 * `Stage` owns one instance and calls {@link MeshRenderer.render} once per frame
 * inside the main render pass, and {@link MeshRenderer.renderShadows} as a
 * depth-only pre-pass. Pipelines pre-warm asynchronously. `Stage` gates the 3D
 * pass on {@link MeshRenderer.ready}.
 */
export class MeshRenderer {
  readonly #device: GfxDevice
  readonly #targetColor: TargetFormat

  #flatShader!: ShaderModule
  #pbrShader!: ShaderModule
  /** Flat / PBR pipelines, indexed by {@link variantOf}. */
  #flatPipelines: Pipeline[] = []
  #pbrPipelines: Pipeline[] = []
  #ready = false
  readonly #failures: RenderFailures
  #warmupSeq = 0

  // Bind-group layouts.
  #flatFrameLayout!: BindGroupLayout
  #flatObjectLayout!: BindGroupLayout
  #pbrFrameLayout!: BindGroupLayout
  #pbrObjectLayout!: BindGroupLayout

  // Per-frame UBOs + bind groups.
  #flatFrameUbo!: UBuffer
  #flatFrameBindGroup: BindGroup | null = null
  #flatFrameBoundAo: Texture | null = null
  #pbrFrameUbo!: UBuffer
  #lightsUbo!: UBuffer
  #shadowFrameUbo!: UBuffer
  #pbrFrameBindGroup: BindGroup | null = null
  #pbrFrameBoundArray: ShadowArray | null = null
  #pbrFrameBoundCube: ShadowCube | null = null
  #pbrFrameBoundAo: Texture | null = null

  // Screen-space AO state, pushed each frame by the stage before `render`.
  #aoTex: Texture | null = null
  #aoEnabled = false
  #aoPixelW = 0
  #aoPixelH = 0
  #aoDirectStrength = 0
  // Per-object dynamic-offset rings. All are staged: a pass writes every slice
  // into CPU memory and uploads once, so no draw is dropped and a frame costs
  // one buffer write per ring.
  #flatObjectRing!: UboRing
  #pbrObjectRing!: UboRing
  readonly #gbuffer: GBufferPass

  // The frame's meshes and lights, gathered by `collect`.
  readonly #meshes: MeshNode[] = []
  readonly #lights: Light3D[] = []
  /** Opaque meshes, the set the AO G-buffer draws. */
  readonly #opaque: MeshNode[] = []
  /** Opaque meshes that cast shadows. */
  readonly #casters: MeshNode[] = []
  #collected = false
  readonly #visit = (n: Node): void => {
    if (n instanceof MeshNode) {
      if (n.geometry && isEffectivelyVisible(n)) this.#meshes.push(n)
    } else if (n instanceof Light3D && isEffectivelyVisible(n)) {
      this.#lights.push(n)
    }
  }
  // Records of the main pass and the object bind groups meshes drew with.
  readonly #recs: DrawRec[] = []
  readonly #drawList: DrawRec[] = []
  #objectGroups = new WeakMap<MeshNode, ObjectGroup>()
  /** The camera's frustum. */
  readonly #frustum = createFrustum()
  readonly #box = new Float64Array(6)

  // Staging buffers for the UBO writes.
  readonly #flatFrameStaging = new Float32Array(FLAT_FRAME_BYTES / 4)
  readonly #flatObjStaging = new Float32Array(FLAT_OBJECT_BYTES / 4)
  readonly #pbrFrameStaging = new Float32Array(PBR_FRAME_BYTES / 4)
  readonly #lightsBuf = new ArrayBuffer(LIGHTS_BYTES)
  readonly #lightsF = new Float32Array(this.#lightsBuf)
  readonly #lightsI = new Int32Array(this.#lightsBuf)
  readonly #shadowFrameStaging = new Float32Array(SHADOW_FRAME_BYTES / 4)
  readonly #pbrObjStaging = new Float32Array(PBR_OBJECT_BYTES / 4)

  readonly #geometry: MeshGeometryCache
  readonly #textures: MeshTextures
  #whiteTex!: Texture
  readonly #offRestore: () => void
  readonly #normalMat: Mat3 = mat3()
  readonly #quality: RenderQuality
  readonly #fog: Fog
  readonly #shadows: ShadowPass

  readonly stats = {
    draws: 0,
    visible: 0,
    /** Meshes outside the camera's view, not drawn in the main pass. */
    culled: 0,
    vertices: 0,
    triangles: 0,
    /** Shadow depth passes rendered this frame, none when the maps are reused. */
    shadowPasses: 0,
  }

  constructor(
    device: GfxDevice,
    targetColor: TargetFormat,
    quality: RenderQuality = new RenderQuality(),
    fog: Fog = new Fog(),
    failures: RenderFailures = new RenderFailures(),
  ) {
    this.#failures = failures
    this.#device = device
    // Own a private copy: `retarget` mutates this, and the caller may share the
    // object it passed.
    this.#targetColor = { ...targetColor }
    this.#quality = quality
    this.#fog = fog
    this.#shadows = new ShadowPass(device, quality)
    this.#gbuffer = new GBufferPass(device)
    this.#geometry = new MeshGeometryCache(device, (mesh) =>
      this.#objectGroups.delete(mesh),
    )
    this.#textures = new MeshTextures(device, quality)
    this.#createResources()
    this.#offRestore = device.onContextRestored(() => this.#onContextRestored())
  }

  /** Whether the pipelines are warm. `Stage` skips the 3D pass until then. */
  get ready(): boolean {
    return this.#ready
  }

  /**
   * Re-point the color pipelines at a new target color format / sample count
   * and re-warm them. `Stage` calls this after a live MSAA swap so the baked
   * pipeline sample count matches the resized render target. No-op when
   * unchanged. `ready` drops until the async re-warm completes, so `Stage`
   * skips the 3D pass in the meantime. The depth-only shadow pipelines are
   * single-sample and unaffected, but the shared re-warm rebuilds them too.
   */
  retarget(targetColor: TargetFormat): void {
    if (
      this.#targetColor.format === targetColor.format &&
      this.#targetColor.samples === targetColor.samples &&
      this.#targetColor.depthStencil === targetColor.depthStencil
    )
      return
    this.#targetColor.format = targetColor.format
    this.#targetColor.samples = targetColor.samples
    this.#targetColor.depthStencil = targetColor.depthStencil
    void this.#warmup()
  }

  #createResources(): void {
    const device = this.#device
    this.#flatShader = device.createShaderModule({
      glsl: { vertex: meshVertSrc, fragment: meshFragSrc },
      wgsl: {
        code: meshWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: meshReflect as ShaderReflection,
      label: 'mesh-flat',
    })
    this.#pbrShader = device.createShaderModule({
      glsl: { vertex: meshPbrVertSrc, fragment: meshPbrFragSrc },
      wgsl: {
        code: meshPbrWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: meshPbrReflect as ShaderReflection,
      label: 'mesh-pbr',
    })
    // Bind-group layouts.
    this.#flatFrameLayout = device.createBindGroupLayout([
      { binding: CAMERA3D_UBO_BINDING, type: 'uniform-buffer' },
      { binding: U_AO, type: 'texture-2d' },
    ])
    this.#flatObjectLayout = device.createBindGroupLayout([
      {
        binding: MESH_OBJECT_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
      { binding: U_TEX, type: 'texture-2d' },
    ])
    this.#pbrFrameLayout = device.createBindGroupLayout([
      { binding: CAMERA3D_UBO_BINDING, type: 'uniform-buffer' },
      { binding: MESH_LIGHTS_UBO_BINDING, type: 'uniform-buffer' },
      { binding: MESH_SHADOW_UBO_BINDING, type: 'uniform-buffer' },
      { binding: U_AO, type: 'texture-2d' },
      { binding: U_SHADOW_ARRAY, type: 'texture-2d-array-shadow' },
      { binding: U_SHADOW_CUBE, type: 'texture-cube-shadow' },
    ])
    this.#pbrObjectLayout = device.createBindGroupLayout([
      {
        binding: MESH_OBJECT_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({
        binding: U_PBR_TEX_BASE + i,
        type: 'texture-2d' as const,
      })),
    ])

    // Per-frame UBOs + stable bind groups.
    this.#flatFrameUbo = device.createUniformBuffer(FLAT_FRAME_BYTES)
    // The flat frame bind group is built lazily in `#beginFlat` so it can bind
    // the current AO texture (or the white fallback) and rebuild when it changes.
    this.#flatFrameBindGroup = null
    this.#flatFrameBoundAo = null
    this.#pbrFrameUbo = device.createUniformBuffer(PBR_FRAME_BYTES)
    this.#lightsUbo = device.createUniformBuffer(LIGHTS_BYTES)
    this.#shadowFrameUbo = device.createUniformBuffer(SHADOW_FRAME_BYTES)
    this.#pbrFrameBindGroup = null
    this.#pbrFrameBoundArray = null
    this.#pbrFrameBoundCube = null
    // Per-object rings.
    this.#flatObjectRing = new UboRing(
      device,
      FLAT_OBJECT_BYTES,
      256,
      'flatObj',
      true,
    )
    this.#pbrObjectRing = new UboRing(
      device,
      PBR_OBJECT_BYTES,
      256,
      'pbrObj',
      true,
    )
    this.#whiteTex = this.#device.createTexture2D({ width: 1, height: 1 })
    void this.#warmup()
  }

  async #warmup(): Promise<void> {
    try {
      await this.#buildPipelines()
    } catch (err) {
      // 3D stays off. The 2D passes are unaffected.
      this.#failures.report('3D renderer', err)
    }
  }

  async #buildPipelines(): Promise<void> {
    this.#ready = false
    const seq = ++this.#warmupSeq
    const device = this.#device
    const format = this.#targetColor.format
    const samples = this.#targetColor.samples
    // The shared screen target may carry stencil for the 2D path alongside the
    // depth this pass needs. The shadow, cube and G-buffer pipelines below
    // render into their own depth-only targets and keep the derived default.
    const depthStencil = this.#targetColor.depthStencil
    const flatLayout = [this.#flatFrameLayout, this.#flatObjectLayout]
    const pbrLayout = [this.#pbrFrameLayout, this.#pbrObjectLayout]
    for (const cull of ['back', 'none'] as const) {
      for (const write of [true, false]) {
        const depth: DepthState = { test: true, write }
        const key = `${cull}|${write}`
        const variant = variantOf(cull === 'none', write)
        this.#flatPipelines[variant] = await device.createPipeline({
          shader: this.#flatShader,
          vertexLayout: flatVertexLayout(),
          bindGroupLayouts: flatLayout,
          color: { format, blend: 'source-over' },
          depth,
          depthStencil,
          cull,
          frontFace: device.ndc.frontFace,
          primitive: 'triangle-list',
          samples,
          label: `mesh-flat-${key}`,
        })
        if (seq !== this.#warmupSeq) return
        this.#pbrPipelines[variant] = await device.createPipeline({
          shader: this.#pbrShader,
          vertexLayout: pbrVertexLayout(),
          bindGroupLayouts: pbrLayout,
          color: { format, blend: 'source-over' },
          depth,
          depthStencil,
          cull,
          frontFace: device.ndc.frontFace,
          primitive: 'triangle-list',
          samples,
          label: `mesh-pbr-${key}`,
        })
        if (seq !== this.#warmupSeq) return
      }
    }
    if (!(await this.#shadows.buildPipelines(() => seq !== this.#warmupSeq)))
      return
    await this.#gbuffer.buildPipeline()
    if (seq === this.#warmupSeq) this.#ready = true
  }

  #onContextRestored(): void {
    this.#geometry.reset()
    this.#textures.reset()
    this.#shadows.onContextRestored()
    this.#gbuffer.createResources()
    this.#flatPipelines = []
    this.#pbrPipelines = []
    this.#objectGroups = new WeakMap()
    this.#createResources()
  }

  /**
   * Push this frame's screen-space AO for the mesh shaders to sample. `tex` is
   * the blurred AO texture (null when AO is off), `enabled` gates the ambient
   * modulation, and `pixelW`/`pixelH` size the screen-space lookup. Call before
   * {@link MeshRenderer.render}.
   */
  setAmbientOcclusion(
    tex: Texture | null,
    enabled: boolean,
    pixelW: number,
    pixelH: number,
    directStrength: number,
  ): void {
    this.#aoTex = tex
    this.#aoEnabled = enabled && tex !== null
    this.#aoPixelW = pixelW
    this.#aoPixelH = pixelH
    this.#aoDirectStrength = directStrength
  }

  /** The AO texture to bind, or the 1×1 white fallback when AO is off. */
  #aoResolved(): Texture {
    return this.#aoTex ?? this.#whiteTex
  }

  /**
   * Gather the frame's meshes and lights in one walk. `Stage` calls this once
   * before the shadow pass, and the shadow, G-buffer and main passes read the
   * result. A pass called without it gathers for itself.
   */
  collect(root: Node): void {
    this.#meshes.length = 0
    this.#lights.length = 0
    this.#opaque.length = 0
    this.#casters.length = 0
    walkTree(root, this.#visit)
    for (const mesh of this.#meshes) {
      if (isBlended(mesh)) continue
      this.#opaque.push(mesh)
      if (mesh.material.castShadow !== false) this.#casters.push(mesh)
    }
    this.#collected = true
  }

  #ensureCollected(root: Node): void {
    if (this.#collected) return
    this.collect(root)
    this.#collected = false
  }

  /**
   * Draw every visible, ready node under `root`, viewed through `camera`. Runs
   * inside the stage's main render pass. Each pipeline bakes its own depth/cull
   * state, so no device state is set imperatively.
   */
  render(camera: CameraView3D, root: Node, debugMode = 0): void {
    // The uploaded view-projection must land depth in the backend's clip range
    // (WebGPU keeps [0,1], WebGL [-1,1]). The camera rebuilds only on a change.
    const device = this.#device
    camera.setClipDepth(device.ndc.clipDepth)
    this.stats.draws = 0
    this.stats.visible = 0
    this.stats.culled = 0
    this.stats.vertices = 0
    this.stats.triangles = 0
    this.#flatObjectRing.reset(device)
    this.#pbrObjectRing.reset(device)
    this.#ensureCollected(root)
    // The main pass is the last reader of the frame's lists.
    this.#collected = false
    const meshes = this.#meshes
    if (meshes.length === 0) return

    const eye = camera.eyePosition()
    const frustum = frustumFromMatrix(
      this.#frustum,
      camera.viewProjection,
      device.ndc.clipDepth,
    )
    // Record each mesh and stage its uniforms, then upload each ring once and
    // draw.
    const list = this.#drawList
    list.length = 0
    let anyFlat = false
    let anyPbr = false
    for (const mesh of meshes) {
      if (meshOutside(mesh, frustum, this.#box)) {
        this.stats.culled++
        continue
      }
      const gpu = this.#geometry.ensure(mesh)
      if (!gpu) continue
      const rec = this.#record(list.length)
      rec.mesh = mesh
      rec.gpu = gpu
      rec.blended = isBlended(mesh)
      rec.pbr = !!mesh.material.pbr
      // Transparent meshes still depth-test against the opaque ones but stop
      // writing it.
      rec.variant = variantOf(mesh.material.doubleSided === true, !rec.blended)
      const w = mesh.worldMatrix
      const dx = w[12] - eye.x
      const dy = w[13] - eye.y
      const dz = w[14] - eye.z
      rec.dist = dx * dx + dy * dy + dz * dz
      if (rec.pbr) {
        this.#stagePbr(rec)
        anyPbr = true
      } else {
        this.#stageFlat(rec)
        anyFlat = true
      }
      list.push(rec)
    }
    if (list.length === 0) return
    list.sort(drawOrder)
    if (anyFlat) this.#beginFlat(camera, eye, debugMode)
    if (anyPbr) this.#beginPbr(camera, eye, debugMode, this.#lights)
    this.#flatObjectRing.flush(device)
    this.#pbrObjectRing.flush(device)
    for (const rec of list) this.#drawRec(rec)
  }

  /** The `i`th pooled draw record. */
  #record(i: number): DrawRec {
    let rec = this.#recs[i]
    if (!rec) {
      rec = {
        mesh: null as unknown as MeshNode,
        gpu: null as unknown as GpuMesh,
        pbr: false,
        blended: false,
        variant: 0,
        offset: 0,
        dist: 0,
        tex: [],
      }
      this.#recs[i] = rec
    }
    return rec
  }

  /**
   * Render the shadow-caster depth maps for this frame as depth-only render
   * passes, before the stage's main pass. Stores per-light shadow state that
   * the following {@link MeshRenderer.render} feeds to the PBR program.
   */
  renderShadows(root: Node): void {
    this.stats.shadowPasses = 0
    if (!this.#ready || !this.#quality.meshShadowsEnabled) {
      this.#shadows.drop()
      return
    }
    this.#ensureCollected(root)
    this.stats.shadowPasses = this.#shadows.render(
      this.#casters,
      this.#lights,
      this.#geometry,
    )
  }

  /**
   * Ambient-occlusion G-buffer prepass: draw opaque, AO-receiving geometry into
   * `target`, writing the view-space normal (octahedral in RG) to the color
   * attachment, and depth to the sampleable depth attachment. Runs
   * single-sample before the main pass. The AO pass reads both to estimate
   * occlusion. Transparent meshes are skipped (they write no depth), matching
   * the shadow-caster set. No-op until pipelines warm.
   */
  renderGBuffer(camera: CameraView3D, root: Node, target: RenderTarget): void {
    if (!this.#ready) return
    const device = this.#device
    camera.setClipDepth(device.ndc.clipDepth)
    this.#ensureCollected(root)
    this.#gbuffer.render(camera, this.#opaque, this.#geometry, target)
  }

  /** Write the flat program's per-frame block (once per frame). */
  #beginFlat(
    camera: CameraView3D,
    eye: { x: number; y: number; z: number },
    debugMode: number,
  ): void {
    const s = this.#flatFrameStaging
    s.set(camera.viewProjection, 0) // u_viewProj @0..15
    s[16] = eye.x
    s[17] = eye.y
    s[18] = eye.z // u_eyePos @16
    const l = FALLBACK_LIGHT
    s[20] = l.ambient[0]
    s[21] = l.ambient[1]
    s[22] = l.ambient[2] // u_ambient @20
    writeFog(this.#fog, s, 24) // u_fogColor @24, u_fogParams @28
    s[32] = l.direction[0]
    s[33] = l.direction[1]
    s[34] = l.direction[2] // u_lightDir @32
    s[36] = l.color[0]
    s[37] = l.color[1]
    s[38] = l.color[2] // u_lightColor @36
    s[40] = debugMode // u_debug @40
    writeAoParams(
      s,
      44,
      this.#aoEnabled,
      this.#aoPixelW,
      this.#aoPixelH,
      this.#aoDirectStrength,
    ) // u_aoParams @44
    const device = this.#device
    device.updateUniformBuffer(this.#flatFrameUbo, s)
    // Rebuild the frame bind group when the bound AO texture changes.
    const ao = this.#aoResolved()
    if (!this.#flatFrameBindGroup || this.#flatFrameBoundAo !== ao) {
      this.#flatFrameBindGroup = device.createBindGroup(this.#flatFrameLayout, [
        {
          binding: CAMERA3D_UBO_BINDING,
          resource: { uniformBuffer: this.#flatFrameUbo },
        },
        { binding: U_AO, resource: { texture: ao } },
      ])
      this.#flatFrameBoundAo = ao
    }
  }

  /**
   * Write the PBR program's per-frame + lights + shadow blocks (once per
   * frame).
   */
  #beginPbr(
    camera: CameraView3D,
    eye: { x: number; y: number; z: number },
    debugMode: number,
    lights: Light3D[],
  ): void {
    const device = this.#device
    const f = this.#pbrFrameStaging
    f.set(camera.viewProjection, 0)
    f[16] = eye.x
    f[17] = eye.y
    f[18] = eye.z
    const amb = FALLBACK_LIGHT.ambient
    f[20] = amb[0]
    f[21] = amb[1]
    f[22] = amb[2]
    writeFog(this.#fog, f, 24)
    f[32] = debugMode
    writeAoParams(
      f,
      36,
      this.#aoEnabled,
      this.#aoPixelW,
      this.#aoPixelH,
      this.#aoDirectStrength,
    ) // u_aoParams @36
    device.updateUniformBuffer(this.#pbrFrameUbo, f)

    writeLights(this.#lightsF, this.#lightsI, lights, this.#shadows.byLight)
    device.updateUniformBuffer(this.#lightsUbo, this.#lightsF)

    // Shadow frame: matrices + (texel, samples, backend conventions). The
    // convention flags let the shadow sample reconcile the light-space depth
    // and the shadow-map row order per backend (see mesh_pbr.wgsl).
    const sf = this.#shadowFrameStaging
    sf.set(this.#shadows.mats, 0) // u_shadowMat[4] @0..63
    sf[64] = 1 / this.#quality.shadowMapSize // u_shadowMeta.x
    sf[65] = this.#quality.shadowSoftness // u_shadowMeta.y
    // u_shadowMeta.z is 1 when the light projection keeps depth in [0,1].
    // u_shadowMeta.w is 1 when the shadow map is stored top-down (both true on
    // WebGPU).
    sf[66] = device.ndc.clipDepth === 'zero-to-one' ? 1 : 0
    sf[67] = device.ndc.textureTopDown ? 1 : 0
    device.updateUniformBuffer(this.#shadowFrameUbo, sf)

    // Rebuild the frame bind group when the bound shadow maps or AO texture change.
    const arr = this.#shadows.arrayForBind()
    const cube = this.#shadows.cubeForBind()
    const ao = this.#aoResolved()
    if (
      !this.#pbrFrameBindGroup ||
      this.#pbrFrameBoundArray !== arr ||
      this.#pbrFrameBoundCube !== cube ||
      this.#pbrFrameBoundAo !== ao
    ) {
      this.#pbrFrameBindGroup = device.createBindGroup(this.#pbrFrameLayout, [
        {
          binding: CAMERA3D_UBO_BINDING,
          resource: { uniformBuffer: this.#pbrFrameUbo },
        },
        {
          binding: MESH_LIGHTS_UBO_BINDING,
          resource: { uniformBuffer: this.#lightsUbo },
        },
        {
          binding: MESH_SHADOW_UBO_BINDING,
          resource: { uniformBuffer: this.#shadowFrameUbo },
        },
        { binding: U_AO, resource: { texture: ao } },
        { binding: U_SHADOW_ARRAY, resource: { shadowArray: arr } },
        { binding: U_SHADOW_CUBE, resource: { shadowCube: cube } },
      ])
      this.#pbrFrameBoundArray = arr
      this.#pbrFrameBoundCube = cube
      this.#pbrFrameBoundAo = ao
    }
  }

  /** Write a flat mesh's object block into its ring and note its texture. */
  #stageFlat(rec: DrawRec): void {
    const mesh = rec.mesh
    const s = this.#flatObjStaging
    s.set(mesh.worldMatrix, 0) // u_model @0..15
    const c = mesh.material.color
    s[16] = c[0]
    s[17] = c[1]
    s[18] = c[2]
    s[19] = c[3] * mesh.transform.alpha // u_color @16
    const m = mesh.material
    // An unlit mesh can still carry artwork. The flat program takes it straight
    // and upright.
    const base = m.baseColorTex
      ? this.#textures.resolve(m.baseColorTex, 'u_texture')
      : null
    s[20] = m.lit ? 1 : 0 // u_flags.x = lit
    s[21] = 0 // u_flags.y, unused
    s[22] = base ? 1 : 0 // u_flags.z = material texture
    s[23] = m.alphaMode === 'MASK' ? (m.alphaCutoff ?? 0.5) : 0 // u_flags.w
    rec.tex[0] = base ?? this.#whiteTex
    rec.offset = this.#flatObjectRing.push(this.#device, s)
  }

  /** Write a PBR mesh's object block into its ring and note its textures. */
  #stagePbr(rec: DrawRec): void {
    const mesh = rec.mesh
    const gpu = rec.gpu
    const m = mesh.material
    const s = this.#pbrObjStaging
    s.fill(0)
    s.set(mesh.worldMatrix, 0) // u_model @0..15
    mat3NormalMatrix(this.#normalMat, mesh.worldMatrix)
    // u_normalMatrix (mat4 @16): write the mat3 into the upper 3 columns.
    const nm = this.#normalMat
    s[16] = nm[0]
    s[17] = nm[1]
    s[18] = nm[2]
    s[20] = nm[3]
    s[21] = nm[4]
    s[22] = nm[5]
    s[24] = nm[6]
    s[25] = nm[7]
    s[26] = nm[8]
    const c = m.color
    s[32] = c[0]
    s[33] = c[1]
    s[34] = c[2]
    s[35] = c[3] * mesh.transform.alpha // u_baseColorFactor @32
    const e = m.emissiveFactor
    s[36] = e?.[0] ?? 0
    s[37] = e?.[1] ?? 0
    s[38] = e?.[2] ?? 0 // u_emissiveFactor @36
    s[40] = m.metallicFactor ?? 1
    s[41] = m.roughnessFactor ?? 1
    s[42] = m.occlusionStrength ?? 1
    s[43] = m.normalScale ?? 1 // u_matParams0 @40
    s[44] = m.alphaCutoff ?? 0.5
    s[45] = m.diffuseTransmission ?? 0
    s[46] = gpu.hasTangent ? 1 : 0
    s[47] = m.alphaMode === 'MASK' ? 1 : m.alphaMode === 'BLEND' ? 2 : 0 // u_matParams1 @44
    // has-flags + textures @48 (u_hasTex0), @52 (u_hasTex1).
    const t0 = this.#textures.resolve(m.baseColorTex, 'u_baseColorTex')
    const t1 = this.#textures.resolve(m.metalRoughTex, 'u_metalRoughTex')
    const t2 = this.#textures.resolve(m.normalTex, 'u_normalTex')
    const t3 = this.#textures.resolve(m.occlusionTex, 'u_occlusionTex')
    const t4 = this.#textures.resolve(m.emissiveTex, 'u_emissiveTex')
    const t5 = this.#textures.resolve(
      m.diffuseTransmissionTex,
      'u_diffuseTransmissionTex',
    )
    s[48] = t0 ? 1 : 0
    s[49] = t1 ? 1 : 0
    s[50] = t2 ? 1 : 0
    s[51] = t3 ? 1 : 0
    s[52] = t4 ? 1 : 0
    s[53] = t5 ? 1 : 0
    s[54] = m.toonSteps ?? 0 // u_hasTex1.z: diffuse banding, off below 2
    const white = this.#whiteTex
    const tex = rec.tex
    tex[0] = t0 ?? white
    tex[1] = t1 ?? white
    tex[2] = t2 ?? white
    tex[3] = t3 ?? white
    tex[4] = t4 ?? white
    tex[5] = t5 ?? white
    rec.offset = this.#pbrObjectRing.push(this.#device, s)
  }

  /**
   * The object bind group for a record: its ring slice and its textures. A mesh
   * keeps the one it built until its textures change or its ring grows.
   */
  #objectGroup(rec: DrawRec): BindGroup {
    const ring = rec.pbr ? this.#pbrObjectRing : this.#flatObjectRing
    const count = rec.pbr ? 6 : 1
    const held = this.#objectGroups.get(rec.mesh)
    if (
      held &&
      held.pbr === rec.pbr &&
      held.generation === ring.generation &&
      sameTextures(held.tex, rec.tex, count)
    ) {
      return held.group
    }
    const entries: BindGroupEntry[] = [
      {
        binding: MESH_OBJECT_UBO_BINDING,
        resource: {
          uniformBuffer: ring.buffer,
          size: rec.pbr ? PBR_OBJECT_BYTES : FLAT_OBJECT_BYTES,
        },
      },
    ]
    if (rec.pbr) {
      for (let i = 0; i < count; i++) {
        entries.push({
          binding: U_PBR_TEX_BASE + i,
          resource: { texture: rec.tex[i] },
        })
      }
    } else {
      entries.push({ binding: U_TEX, resource: { texture: rec.tex[0] } })
    }
    const group = this.#device.createBindGroup(
      rec.pbr ? this.#pbrObjectLayout : this.#flatObjectLayout,
      entries,
    )
    this.#objectGroups.set(rec.mesh, {
      pbr: rec.pbr,
      generation: ring.generation,
      tex: rec.tex.slice(0, count),
      group,
    })
    return group
  }

  #drawRec(rec: DrawRec): void {
    const gpu = rec.gpu
    const objGroup = this.#objectGroup(rec)
    this.#device.draw({
      pipeline: rec.pbr
        ? this.#pbrPipelines[rec.variant]
        : this.#flatPipelines[rec.variant],
      vertexBuffers: rec.pbr ? gpu.pbrBuffers : gpu.flatBuffers,
      indexBuffer: gpu.ibo,
      bindGroups: [
        // Set by `#beginFlat` / `#beginPbr`, which run before any draw.
        {
          group: 0,
          bindGroup: rec.pbr
            ? this.#pbrFrameBindGroup!
            : this.#flatFrameBindGroup!,
        },
        { group: 1, bindGroup: objGroup, dynamicOffsets: [rec.offset] },
      ],
      indexCount: gpu.indexCount,
    })
    this.#countDraw(gpu)
  }

  #countDraw(gpu: GpuMesh): void {
    this.stats.draws++
    this.stats.visible++
    this.stats.vertices += gpu.indexCount
    this.stats.triangles += gpu.indexCount / 3
  }

  get textureInspector(): TextureInspector | null {
    return this.#textures.inspector
  }

  release(mesh: MeshNode): void {
    this.#geometry.release(mesh)
  }

  destroy(): void {
    this.#offRestore()
    this.#geometry.destroy()
    this.#textures.destroy()
    this.#device.deleteTexture(this.#whiteTex)
    this.#device.deleteShaderModule(this.#flatShader)
    this.#device.deleteShaderModule(this.#pbrShader)
    this.#device.deleteUniformBuffer(this.#flatFrameUbo)
    this.#device.deleteUniformBuffer(this.#pbrFrameUbo)
    this.#device.deleteUniformBuffer(this.#lightsUbo)
    this.#device.deleteUniformBuffer(this.#shadowFrameUbo)
    for (const ring of [this.#flatObjectRing, this.#pbrObjectRing]) {
      ring.dispose(this.#device)
    }
    this.#gbuffer.destroy()
    this.#shadows.destroy()
  }
}

function sameTextures(held: Texture[], now: Texture[], count: number): boolean {
  for (let i = 0; i < count; i++) if (held[i] !== now[i]) return false
  return true
}

/**
 * True for meshes drawn in the transparent bucket, those with a `BLEND`
 * material. Opaque and alpha-`MASK` meshes stay in the depth-writing opaque
 * bucket.
 */
function isBlended(node: Node3D): boolean {
  return node instanceof MeshNode && node.material.alphaMode === 'BLEND'
}
