// The ambient occlusion G-buffer prepass: draws opaque geometry into a
// single-sample target holding the view-space normal and linear depth that the
// AO pass reads.

import type {
  BindGroup,
  BindGroupLayout,
  GfxDevice,
  Pipeline,
  RenderTarget,
  ShaderModule,
  ShaderReflection,
  UBuffer,
} from '../GfxDevice'
import type { CameraView3D } from '../../../camera/CameraView3D'
import type { MeshNode } from '../../../nodes/MeshNode'
import { createFrustum, frustumFromMatrix } from '../../../math/frustum'
import { CAMERA3D_UBO_BINDING, MESH_OBJECT_UBO_BINDING } from '../batchLayout'
import { UboRing } from '../programs/programCommon'
import gbufferWgsl from '../shaders/gbuffer.wgsl?raw'
import gbufferVertSrc from '../shaders/gbuffer.gen.vert.glsl?raw'
import gbufferFragSrc from '../shaders/gbuffer.gen.frag.glsl?raw'
import gbufferReflect from '../shaders/gbuffer.reflect.json'
import {
  GBUFFER_FRAME_BYTES,
  GBUFFER_OBJECT_BYTES,
  normalLayout,
  posLayout,
} from './meshLayout'
import { RingBinding } from './RingBinding'
import type { MeshGeometryCache } from './MeshGeometryCache'
import type { GpuMesh } from './meshTypes'
import { meshOutside } from './meshBounds'

export class GBufferPass {
  readonly #device: GfxDevice
  #shader!: ShaderModule
  #pipeline!: Pipeline
  #frameLayout!: BindGroupLayout
  #objectLayout!: BindGroupLayout
  #frameUbo!: UBuffer
  #frameBindGroup!: BindGroup
  #objectRing!: UboRing
  #objectBinding!: RingBinding
  readonly #gpus: GpuMesh[] = []
  readonly #offsets: number[] = []
  readonly #frustum = createFrustum()
  readonly #box = new Float64Array(6)
  readonly #frameStaging = new Float32Array(GBUFFER_FRAME_BYTES / 4)
  readonly #objStaging = new Float32Array(GBUFFER_OBJECT_BYTES / 4)

  constructor(device: GfxDevice) {
    this.#device = device
    this.createResources()
  }

  createResources(): void {
    const device = this.#device
    this.#shader = device.createShaderModule({
      glsl: { vertex: gbufferVertSrc, fragment: gbufferFragSrc },
      wgsl: {
        code: gbufferWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: gbufferReflect as ShaderReflection,
      label: 'ao-gbuffer',
    })
    this.#frameLayout = device.createBindGroupLayout([
      { binding: CAMERA3D_UBO_BINDING, type: 'uniform-buffer' },
    ])
    this.#objectLayout = device.createBindGroupLayout([
      {
        binding: MESH_OBJECT_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])
    // One per-frame block, one per-object ring.
    this.#frameUbo = device.createUniformBuffer(GBUFFER_FRAME_BYTES)
    this.#frameBindGroup = device.createBindGroup(this.#frameLayout, [
      {
        binding: CAMERA3D_UBO_BINDING,
        resource: { uniformBuffer: this.#frameUbo },
      },
    ])
    this.#objectRing = new UboRing(
      device,
      GBUFFER_OBJECT_BYTES,
      256,
      'gbufObj',
      true,
    )
    this.#objectBinding = new RingBinding(
      this.#objectRing,
      this.#objectLayout,
      MESH_OBJECT_UBO_BINDING,
      GBUFFER_OBJECT_BYTES,
    )
  }

  /** Single-sample RGBA8 packing view normal (RG) + 16-bit linear depth (BA). */
  async buildPipeline(): Promise<void> {
    const device = this.#device
    // No blend, it overwrites every covered pixel.
    this.#pipeline = await device.createPipeline({
      shader: this.#shader,
      vertexLayout: [posLayout(), normalLayout()],
      bindGroupLayouts: [this.#frameLayout, this.#objectLayout],
      color: { format: 'linear', blend: 'none' },
      depth: { test: true, write: true },
      cull: 'back',
      frontFace: device.ndc.frontFace,
      primitive: 'triangle-list',
      samples: 1,
      label: 'ao-gbuffer',
    })
  }

  /**
   * Draw `opaque` into `target`, writing the view-space normal (octahedral in
   * RG) to the color attachment, and depth to the sampleable depth attachment.
   */
  render(
    camera: CameraView3D,
    opaque: readonly MeshNode[],
    geometry: MeshGeometryCache,
    target: RenderTarget,
  ): void {
    const device = this.#device
    // Frame block: view-projection + view + near/far, so the prepass can write
    // linear view depth.
    const f = this.#frameStaging
    f.set(camera.viewProjection as unknown as Float32Array, 0)
    f.set(camera.view as unknown as Float32Array, 16)
    f[32] = camera.near
    f[33] = camera.far
    device.updateUniformBuffer(this.#frameUbo, f)
    this.#objectRing.reset(device)
    const gpus = this.#gpus
    const offsets = this.#offsets
    gpus.length = 0
    offsets.length = 0
    const s = this.#objStaging
    const frustum = frustumFromMatrix(
      this.#frustum,
      camera.viewProjection,
      device.ndc.clipDepth,
    )
    for (const mesh of opaque) {
      if (meshOutside(mesh, frustum, this.#box)) continue
      const gpu = geometry.ensure(mesh)
      if (!gpu) continue
      s.set(mesh.worldMatrix as unknown as Float32Array, 0)
      gpus.push(gpu)
      offsets.push(this.#objectRing.push(device, s))
    }
    this.#objectRing.flush(device)
    device.beginRenderPass({
      color: {
        target,
        loadOp: 'clear',
        // (0.5, 0.5) octahedral-decodes to +Z. The cleared background normal is
        // arbitrary, since the AO pass ignores far-depth texels.
        clearColor: [0.5, 0.5, 0, 1],
      },
      depth: {
        target: { renderTarget: target },
        loadOp: 'clear',
        clearValue: 1,
      },
    })
    const objGroup = this.#objectBinding.group(device)
    for (let i = 0; i < gpus.length; i++) {
      const gpu = gpus[i]
      device.draw({
        pipeline: this.#pipeline,
        vertexBuffers: gpu.gbufferBuffers,
        indexBuffer: gpu.ibo,
        bindGroups: [
          { group: 0, bindGroup: this.#frameBindGroup },
          { group: 1, bindGroup: objGroup, dynamicOffsets: [offsets[i]] },
        ],
        indexCount: gpu.indexCount,
      })
    }
    device.endRenderPass()
  }

  destroy(): void {
    this.#device.deleteShaderModule(this.#shader)
    this.#device.deleteUniformBuffer(this.#frameUbo)
    this.#objectRing.dispose(this.#device)
  }
}
