// Shared plumbing for the instanced unit-quad programs: one shader, one ring
// stream of fixed-stride instance records, one material bind group layout, and
// the blend pipelines built from them.

import { RingStream } from '../RingStream'
import type { BatchKind } from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type {
  BindGroup,
  BindGroupLayout,
  BindGroupLayoutEntry,
  GfxBlendMode,
  GfxDevice,
  Pipeline,
  ShaderModule,
  ShaderReflection,
  Texture,
  VertexBufferLayout,
} from '../GfxDevice'
import {
  drawInstancedRun,
  unitQuadLayout,
  warmupBlendPipelines,
  type BlendPipelineOptions,
} from './programCommon'

/** What an {@link InstancedQuadProgram} builds its GPU resources from. */
export interface InstancedQuadSpec {
  label: string
  vertex: string
  fragment: string
  wgsl: string
  reflection: unknown
  bufferBytes: number
  stride: number
  unitLocation: number
  attributes: VertexBufferLayout['attributes']
  material: BindGroupLayoutEntry[]
  blends?: GfxBlendMode[]
}

/** The unit quad plus one instance-rate buffer of `stride` bytes. */
export function instancedQuadLayout(
  unitLocation: number,
  stride: number,
  attributes: VertexBufferLayout['attributes'],
): VertexBufferLayout[] {
  return [
    unitQuadLayout(unitLocation),
    { arrayStride: stride, stepMode: 'instance', attributes },
  ]
}

export abstract class InstancedQuadProgram implements GpuProgram {
  abstract readonly kind: BatchKind

  readonly #spec: InstancedQuadSpec
  #shader!: ShaderModule
  #pipelines: Map<string, Pipeline> = new Map()
  #vertexLayout: VertexBufferLayout[] = []
  /** One bind group per texture, for a material that is a single texture. */
  #bindGroups = new WeakMap<Texture, BindGroup>()
  // Plain fields rather than getters, since subclasses write records through
  // them once per draw.
  protected ring!: RingStream
  protected materialLayout!: BindGroupLayout

  constructor(spec: InstancedQuadSpec) {
    this.#spec = spec
  }

  get stream(): RingStream {
    return this.ring
  }

  get floatView(): Float32Array {
    return this.ring.floatView
  }

  get uintView(): Uint32Array {
    return this.ring.uintView
  }

  init(device: GfxDevice, _ctx: GpuBatchContext): void {
    const spec = this.#spec
    this.#shader = device.createShaderModule({
      glsl: { vertex: spec.vertex, fragment: spec.fragment },
      wgsl: {
        code: spec.wgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: spec.reflection as ShaderReflection,
      label: spec.label,
    })
    this.ring = new RingStream(
      device,
      spec.bufferBytes,
      spec.stride,
      spec.label,
    )
    this.materialLayout = device.createBindGroupLayout(spec.material)
    this.#bindGroups = new WeakMap()
    this.#vertexLayout = instancedQuadLayout(
      spec.unitLocation,
      spec.stride,
      spec.attributes,
    )
  }

  async warmup(device: GfxDevice, ctx: GpuBatchContext): Promise<void> {
    this.#pipelines = await warmupBlendPipelines(device, ctx, {
      shader: this.#shader,
      vertexLayout: this.#vertexLayout,
      bindGroupLayouts: [ctx.frameBindGroupLayout, this.materialLayout],
      blends: this.#spec.blends,
      variants: this.pipelineVariants(ctx),
    })
  }

  /** Pipeline variants beyond the plain and clip-tested ones. */
  protected pipelineVariants(
    _ctx: GpuBatchContext,
  ): BlendPipelineOptions['variants'] {
    return undefined
  }

  commitInstance(slot: number): void {
    this.ring.commitInstance(slot)
  }

  /** The cached bind group for a material of one texture at binding 0. */
  protected textureBindGroup(ctx: GpuBatchContext, tex: Texture): BindGroup {
    let bg = this.#bindGroups.get(tex)
    if (!bg) {
      bg = ctx.device.createBindGroup(this.materialLayout, [
        { binding: 0, resource: { texture: tex } },
      ])
      this.#bindGroups.set(tex, bg)
    }
    return bg
  }

  protected drawInstanced(
    ctx: GpuBatchContext,
    run: DrawRun,
    material: BindGroup | null,
    variant?: string,
    stencilReference?: number,
  ): void {
    drawInstancedRun(
      ctx,
      this.#pipelines,
      ctx.unitQuadBuffer,
      this.ring,
      this.#spec.stride,
      run,
      material,
      variant,
      stencilReference,
    )
  }

  abstract drawRun(ctx: GpuBatchContext, run: DrawRun): void
}
