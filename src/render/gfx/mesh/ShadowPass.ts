// The shadow-caster depth pre-pass: owns the depth-only pipelines, the camera
// and object rings, the shadow map textures and the per-light shadow links.
// Maps are reused while the casters, the lights and the map size stay the same.

import type {
  BindGroupLayout,
  DepthState,
  GfxDevice,
  Pipeline,
  ShaderModule,
  ShaderReflection,
  ShadowArray,
  ShadowCube,
} from '../GfxDevice'
import type { MeshNode } from '../../../nodes/MeshNode'
import {
  DirectionalLight3D,
  PointLight3D,
  SpotLight3D,
  type Light3D,
} from '../../../nodes/Light3D'
import {
  fitDirectionalOrtho,
  fitPointCubeFace,
  fitSpotPerspective,
  type Aabb,
} from '../../../math/shadowFit'
import { vec3 } from '../../../math/Vec3'
import type { Mat4 } from '../../../math/Mat4'
import {
  boxOutsideFrustum,
  createFrustum,
  frustumFromMatrix,
  type FrustumPlanes,
} from '../../../math/frustum'
import type { RenderQuality } from '../../RenderQuality'
import { CAMERA3D_UBO_BINDING, MESH_OBJECT_UBO_BINDING } from '../batchLayout'
import { UboRing } from '../programs/programCommon'
import shadowDepthWgsl from '../shaders/shadow_depth.wgsl?raw'
import shadowDepthVertSrc from '../shaders/shadow_depth.gen.vert.glsl?raw'
import shadowDepthFragSrc from '../shaders/shadow_depth.gen.frag.glsl?raw'
import shadowDepthReflect from '../shaders/shadow_depth.reflect.json'
import shadowCubeWgsl from '../shaders/shadow_cube.wgsl?raw'
import shadowCubeVertSrc from '../shaders/shadow_cube.gen.vert.glsl?raw'
import shadowCubeFragSrc from '../shaders/shadow_cube.gen.frag.glsl?raw'
import shadowCubeReflect from '../shaders/shadow_cube.reflect.json'
import {
  CUBE_CAM_BYTES,
  MAX_SHADOW_LAYERS,
  SHADOW_CAM_BYTES,
  SHADOW_OBJECT_BYTES,
  posLayout,
} from './meshLayout'
import { RingBinding } from './RingBinding'
import type { MeshGeometryCache } from './MeshGeometryCache'
import type { GpuMesh, ShadowLink } from './meshTypes'
import { castersAABB, castersFar, lightForward, worldBox } from './meshBounds'

export class ShadowPass {
  readonly #device: GfxDevice
  readonly #quality: RenderQuality

  #shader!: ShaderModule
  #cubeShader!: ShaderModule
  #pipeline!: Pipeline
  #cubePipeline!: Pipeline
  #camLayout!: BindGroupLayout
  #cubeCamLayout!: BindGroupLayout
  #objectLayout!: BindGroupLayout
  // Camera UBOs, one slice per layer/face via a dynamic-offset ring. A shared
  // buffer would clobber under WebGPU's deferred submission (every pass would
  // read the last-written matrix). The ring gives each pass its own slice.
  #camRing!: UboRing
  #camBinding!: RingBinding
  #cubeCamRing!: UboRing
  #cubeCamBinding!: RingBinding
  #objectRing!: UboRing
  #objectBinding!: RingBinding

  #array: ShadowArray | null = null
  #cube: ShadowCube | null = null
  #placeholderArray: ShadowArray | null = null
  #placeholderCube: ShadowCube | null = null
  #resolution = 0

  /** The light-space matrices of the shadow layers, for the frame block. */
  readonly mats = new Float32Array(16 * MAX_SHADOW_LAYERS)
  /** Each shadowed light's layer or cube link, for the lights block. */
  readonly byLight = new Map<Light3D, ShadowLink>()

  readonly #shadowLights: Light3D[] = []
  // What the shadow maps were last rendered from. They are reused while the
  // casters, the lights and the map size stay the same.
  #valid = false
  #sig = new Float32Array(0)
  #sigPrev = new Float32Array(0)
  #refs: unknown[] = []
  #refsPrev: unknown[] = []
  // Each caster's upload and ring slice, and the camera slices.
  readonly #casterGpu: GpuMesh[] = []
  readonly #casterOff: number[] = []
  readonly #layerCamOff: number[] = [0, 0, 0, 0]
  readonly #faceCamOff: number[] = [0, 0, 0, 0, 0, 0]
  /** Each shadow layer's and cube face's frustum. */
  readonly #layerFrusta: FrustumPlanes[] = Array.from(
    { length: MAX_SHADOW_LAYERS },
    createFrustum,
  )
  readonly #faceFrusta: FrustumPlanes[] = Array.from(
    { length: 6 },
    createFrustum,
  )
  /** The world box of each staged caster, six numbers each. */
  #casterBox = new Float64Array(0)
  readonly #box = new Float64Array(6)
  readonly #camStaging = new Float32Array(CUBE_CAM_BYTES / 4)
  readonly #objStaging = new Float32Array(SHADOW_OBJECT_BYTES / 4)

  constructor(device: GfxDevice, quality: RenderQuality) {
    this.#device = device
    this.#quality = quality
    this.createResources()
  }

  createResources(): void {
    const device = this.#device
    this.#shader = device.createShaderModule({
      glsl: { vertex: shadowDepthVertSrc, fragment: shadowDepthFragSrc },
      wgsl: {
        code: shadowDepthWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: shadowDepthReflect as ShaderReflection,
      label: 'shadow-depth',
    })
    this.#cubeShader = device.createShaderModule({
      glsl: { vertex: shadowCubeVertSrc, fragment: shadowCubeFragSrc },
      wgsl: {
        code: shadowCubeWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: shadowCubeReflect as ShaderReflection,
      label: 'shadow-cube',
    })
    this.#camLayout = device.createBindGroupLayout([
      {
        binding: CAMERA3D_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])
    this.#cubeCamLayout = device.createBindGroupLayout([
      {
        binding: CAMERA3D_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])
    this.#objectLayout = device.createBindGroupLayout([
      {
        binding: MESH_OBJECT_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])
    // One slice per shadow layer / cube face. Slot counts are sized past the
    // real maxima (4 array layers, 6 cube faces) so the ring never overflows.
    this.#camRing = new UboRing(device, SHADOW_CAM_BYTES, 8, 'shadowCam', true)
    this.#camBinding = new RingBinding(
      this.#camRing,
      this.#camLayout,
      CAMERA3D_UBO_BINDING,
      SHADOW_CAM_BYTES,
    )
    this.#cubeCamRing = new UboRing(device, CUBE_CAM_BYTES, 8, 'cubeCam', true)
    this.#cubeCamBinding = new RingBinding(
      this.#cubeCamRing,
      this.#cubeCamLayout,
      CAMERA3D_UBO_BINDING,
      CUBE_CAM_BYTES,
    )
    this.#objectRing = new UboRing(
      device,
      SHADOW_OBJECT_BYTES,
      256,
      'shadowObj',
      true,
    )
    this.#objectBinding = new RingBinding(
      this.#objectRing,
      this.#objectLayout,
      MESH_OBJECT_UBO_BINDING,
      SHADOW_OBJECT_BYTES,
    )
  }

  /**
   * Build the depth-only pipelines (no color target). False when `stale`
   * reports the warmup was superseded, so the caller stops.
   */
  async buildPipelines(stale: () => boolean): Promise<boolean> {
    const device = this.#device
    this.#pipeline = await device.createPipeline({
      shader: this.#shader,
      vertexLayout: [posLayout()],
      bindGroupLayouts: [this.#camLayout, this.#objectLayout],
      color: null,
      depth: { test: true, write: true } satisfies DepthState,
      cull: 'none',
      frontFace: device.ndc.frontFace,
      primitive: 'triangle-list',
      samples: 1,
      label: 'shadow-depth',
    })
    if (stale()) return false
    this.#cubePipeline = await device.createPipeline({
      shader: this.#cubeShader,
      vertexLayout: [posLayout()],
      bindGroupLayouts: [this.#cubeCamLayout, this.#objectLayout],
      color: null,
      depth: { test: true, write: true },
      cull: 'none',
      frontFace: device.ndc.frontFace,
      primitive: 'triangle-list',
      samples: 1,
      label: 'shadow-cube',
    })
    return !stale()
  }

  /** Drop the maps without freeing them, for a lost context. */
  onContextRestored(): void {
    this.#array = null
    this.#cube = null
    this.#placeholderArray = null
    this.#placeholderCube = null
    this.#resolution = 0
    this.drop()
    this.createResources()
  }

  /** Forget the shadow links, so the frame draws unshadowed. */
  drop(): void {
    this.byLight.clear()
    this.#valid = false
  }

  /**
   * Render the shadow-caster depth maps as depth-only render passes and fill
   * {@link ShadowPass.byLight}. Returns how many passes ran, none when the maps
   * are reused.
   */
  render(
    casters: MeshNode[],
    lights: readonly Light3D[],
    geometry: MeshGeometryCache,
  ): number {
    const size = this.#quality.shadowMapSize
    if (size !== this.#resolution) {
      if (this.#array) this.#device.deleteShadowArray(this.#array)
      if (this.#cube) this.#device.deleteShadowCube(this.#cube)
      this.#array = null
      this.#cube = null
      this.#resolution = size
      this.#valid = false
    }
    const shadowLights = this.#shadowLights
    shadowLights.length = 0
    for (const light of lights) {
      if (light.shadowEnabled) shadowLights.push(light)
    }
    if (shadowLights.length === 0 || casters.length === 0) {
      this.drop()
      return 0
    }
    // The maps and the per-light links from the last render still hold when
    // nothing they were made from has changed.
    const unchanged = this.#inputsUnchanged(casters, shadowLights)
    if (this.#valid && unchanged) return 0
    const aabb = castersAABB(casters)
    if (!aabb) {
      this.drop()
      return 0
    }
    this.byLight.clear()
    this.#valid = true
    const device = this.#device
    this.#objectRing.reset(device)
    this.#camRing.reset(device)
    this.#cubeCamRing.reset(device)

    // Every layer and face draws the same casters, so each caster's model matrix
    // is written once and its slice shared by all of them.
    const gpus = this.#casterGpu
    const offsets = this.#casterOff
    gpus.length = 0
    offsets.length = 0
    const s = this.#objStaging
    if (this.#casterBox.length < casters.length * 6) {
      this.#casterBox = new Float64Array(casters.length * 6)
    }
    const boxes = this.#casterBox
    for (const caster of casters) {
      const gpu = geometry.ensure(caster)
      if (!gpu) continue
      s.set(caster.worldMatrix, 0)
      const o = gpus.length * 6
      if (worldBox(caster, this.#box)) boxes.set(this.#box, o)
      else boxes.fill(NaN, o, o + 6)
      gpus.push(gpu)
      offsets.push(this.#objectRing.push(device, s))
    }

    let layer = 0
    for (const light of shadowLights) {
      if (layer >= MAX_SHADOW_LAYERS) break
      const vp = this.#matrixFor(light, aabb)
      if (!vp) continue
      this.#layerCamOff[layer] = this.#camRing.push(
        device,
        vp as unknown as Float32Array,
      )
      this.mats.set(vp, layer * 16)
      frustumFromMatrix(this.#layerFrusta[layer], vp, device.ndc.clipDepth)
      this.byLight.set(light, { kind: 1, param: layer })
      layer++
    }
    const point = shadowLights.find(
      (l): l is PointLight3D => l instanceof PointLight3D,
    )
    const pointFar = point ? this.#stagePointFaces(point, aabb) : 0
    this.#objectRing.flush(device)
    this.#camRing.flush(device)
    this.#cubeCamRing.flush(device)

    for (let l = 0; l < layer; l++) {
      device.beginRenderPass({
        depth: {
          target: { shadowArray: this.#ensureArray(), layer: l },
          loadOp: 'clear',
        },
      })
      this.#drawCasters(false, this.#layerCamOff[l], this.#layerFrusta[l])
      device.endRenderPass()
    }
    if (point) {
      const cube = this.#ensureCube()
      for (let face = 0; face < 6; face++) {
        device.beginRenderPass({
          depth: { target: { shadowCube: cube, face }, loadOp: 'clear' },
        })
        this.#drawCasters(true, this.#faceCamOff[face], this.#faceFrusta[face])
        device.endRenderPass()
      }
      this.byLight.set(point, { kind: 2, param: pointFar })
    }
    return layer + (point ? 6 : 0)
  }

  /**
   * Whether everything the shadow maps depend on matches the last render, and
   * if not, record it for the next comparison. That is each caster and its
   * geometry, each shadowing light's placement and reach, and the map size.
   */
  #inputsUnchanged(
    casters: readonly MeshNode[],
    lights: readonly Light3D[],
  ): boolean {
    const need = casters.length * 16 + lights.length * 20 + 1
    if (this.#sig.length !== need) this.#sig = new Float32Array(need)
    const sig = this.#sig
    const refs = this.#refs
    refs.length = 0
    let o = 0
    for (const caster of casters) {
      sig.set(caster.worldMatrix, o)
      o += 16
      refs.push(caster, caster.geometry)
    }
    for (const light of lights) {
      sig.set(light.worldMatrix, o)
      o += 16
      sig[o++] =
        light instanceof DirectionalLight3D ? light.shadowMaxDistance : 0
      sig[o++] = light instanceof SpotLight3D ? light.outerConeAngle : 0
      sig[o++] =
        light instanceof PointLight3D || light instanceof SpotLight3D
          ? light.range
          : 0
      sig[o++] = 0
      refs.push(light)
    }
    sig[o] = this.#resolution
    let same = this.#sigPrev.length === sig.length
    for (let i = 0; same && i < sig.length; i++) {
      if (sig[i] !== this.#sigPrev[i]) same = false
    }
    for (let i = 0; same && i < refs.length; i++) {
      if (refs[i] !== this.#refsPrev[i]) same = false
    }
    same = same && refs.length === this.#refsPrev.length
    if (!same) {
      ;[this.#sig, this.#sigPrev] = [this.#sigPrev, this.#sig]
      ;[this.#refs, this.#refsPrev] = [this.#refsPrev, this.#refs]
    }
    return same
  }

  /**
   * Stage the camera slices of the six faces of a point light's depth cubemap
   * and return the light's far distance.
   */
  #stagePointFaces(light: PointLight3D, aabb: Aabb): number {
    const device = this.#device
    const w = light.worldMatrix
    const px = w[12]
    const py = w[13]
    const pz = w[14]
    const far = light.range > 0 ? light.range : castersFar(aabb, px, py, pz)
    const near = Math.max(0.05, far * 0.005)
    const pos = vec3(px, py, pz)
    for (let face = 0; face < 6; face++) {
      // Pad the projection far so geometry at `dist ≈ far` isn't clipped.
      const vp = fitPointCubeFace(
        pos,
        face,
        near,
        far * 1.01,
        device.ndc.clipDepth,
      )
      frustumFromMatrix(this.#faceFrusta[face], vp, device.ndc.clipDepth)
      const s = this.#camStaging
      s.set(vp, 0)
      s[16] = px
      s[17] = py
      s[18] = pz
      s[20] = far
      this.#faceCamOff[face] = this.#cubeCamRing.push(device, s)
    }
    return far
  }

  /** Light-space view-projection for a directional/spot caster, or null. */
  #matrixFor(light: Light3D, aabb: Aabb): Mat4 | null {
    if (light instanceof DirectionalLight3D) {
      return fitDirectionalOrtho(
        aabb,
        lightForward(light),
        this.#quality.shadowMapSize,
        light.shadowMaxDistance,
        this.#device.ndc.clipDepth,
      )
    }
    if (light instanceof SpotLight3D) {
      const w = light.worldMatrix
      const far =
        light.range > 0 ? light.range : castersFar(aabb, w[12], w[13], w[14])
      return fitSpotPerspective(
        vec3(w[12], w[13], w[14]),
        lightForward(light),
        light.outerConeAngle,
        Math.max(0.05, far * 0.01),
        far,
        this.#device.ndc.clipDepth,
      )
    }
    return null
  }

  /**
   * Draw the staged casters into the open shadow pass. `camOff` is the pass's
   * slice of the camera ring (group 0), and each caster has its own slice of
   * the object ring (group 1).
   */
  #drawCasters(cube: boolean, camOff: number, frustum: FrustumPlanes): void {
    const device = this.#device
    const pipeline = cube ? this.#cubePipeline : this.#pipeline
    const camGroup = (cube ? this.#cubeCamBinding : this.#camBinding).group(
      device,
    )
    const objGroup = this.#objectBinding.group(device)
    const gpus = this.#casterGpu
    const offsets = this.#casterOff
    const boxes = this.#casterBox
    for (let i = 0; i < gpus.length; i++) {
      // A caster outside this map's sides or past its far plane cannot reach
      // it. One nearer than the near plane still can, so that plane is kept out.
      const o = i * 6
      if (
        boxes[o] === boxes[o] &&
        (boxOutsideFrustum(
          frustum,
          boxes[o],
          boxes[o + 1],
          boxes[o + 2],
          boxes[o + 3],
          boxes[o + 4],
          boxes[o + 5],
          0,
          4,
        ) ||
          boxOutsideFrustum(
            frustum,
            boxes[o],
            boxes[o + 1],
            boxes[o + 2],
            boxes[o + 3],
            boxes[o + 4],
            boxes[o + 5],
            5,
            6,
          ))
      ) {
        continue
      }
      const gpu = gpus[i]
      device.draw({
        pipeline,
        vertexBuffers: gpu.shadowBuffers,
        indexBuffer: gpu.ibo,
        bindGroups: [
          { group: 0, bindGroup: camGroup, dynamicOffsets: [camOff] },
          { group: 1, bindGroup: objGroup, dynamicOffsets: [offsets[i]] },
        ],
        indexCount: gpu.indexCount,
      })
    }
  }

  #ensureArray(): ShadowArray {
    if (!this.#array) {
      this.#array = this.#device.createShadowArray(
        this.#quality.shadowMapSize,
        MAX_SHADOW_LAYERS,
      )
    }
    return this.#array
  }

  #ensureCube(): ShadowCube {
    if (!this.#cube)
      this.#cube = this.#device.createShadowCube(this.#quality.shadowMapSize)
    return this.#cube
  }

  /** The depth array to bind, or a 1x1 placeholder while there are no maps. */
  arrayForBind(): ShadowArray {
    if (this.#array) return this.#array
    if (!this.#placeholderArray)
      this.#placeholderArray = this.#device.createShadowArray(1, 1)
    return this.#placeholderArray
  }

  /** The depth cube to bind, or a 1x1 placeholder while there are no maps. */
  cubeForBind(): ShadowCube {
    if (this.#cube) return this.#cube
    if (!this.#placeholderCube)
      this.#placeholderCube = this.#device.createShadowCube(1)
    return this.#placeholderCube
  }

  destroy(): void {
    const device = this.#device
    device.deleteShaderModule(this.#shader)
    device.deleteShaderModule(this.#cubeShader)
    for (const ring of [this.#camRing, this.#cubeCamRing, this.#objectRing]) {
      ring.dispose(device)
    }
    if (this.#array) device.deleteShadowArray(this.#array)
    if (this.#placeholderArray) device.deleteShadowArray(this.#placeholderArray)
    if (this.#cube) device.deleteShadowCube(this.#cube)
    if (this.#placeholderCube) device.deleteShadowCube(this.#placeholderCube)
  }
}
