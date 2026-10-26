// Masked-radial-gradient program: `Gfx2D.fillMaskedRadialGradient` (the arcade
// launcher's drifting clouds). Mask silhouette on texture unit 0, ramp atlas
// on unit 1. The mask/atlas lookups live on `GpuGfx` (need `TextureManager`).
// This program owns the shader/VAO/stream plumbing and the buffer write.

import {
  LOC_MASKGRAD_DST,
  LOC_MASKGRAD_GRAD,
  LOC_MASKGRAD_RAMPROW,
  LOC_MASKGRAD_SRC,
  LOC_MASKGRAD_UNIT,
  MASKED_GRAD_BUFFER_BYTES,
  MASKED_GRAD_INSTANCE_STRIDE,
} from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import type { BindGroup, GfxDevice, Texture } from '../GfxDevice'
import { InstancedQuadProgram } from './instancedQuad'
import maskedGradientWgsl from '../shaders/maskedRadialGradient.gen.wgsl?raw'
import maskedGradientVertSrc from '../shaders/maskedRadialGradient.gen.vert.glsl?raw'
import maskedGradientFragSrc from '../shaders/maskedRadialGradient.gen.frag.glsl?raw'
import maskedGradientReflect from '../shaders/maskedRadialGradient.reflect.json'

export class MaskedGradientProgram extends InstancedQuadProgram {
  readonly kind = 'maskedGradient' as const

  /**
   * (mask -> (atlas -> bind group)). The mask varies per draw, the atlas is a
   * fixed texture.
   */
  #bindGroups = new WeakMap<Texture, WeakMap<Texture, BindGroup>>()

  constructor() {
    super({
      label: 'maskedGradient',
      vertex: maskedGradientVertSrc,
      fragment: maskedGradientFragSrc,
      wgsl: maskedGradientWgsl,
      reflection: maskedGradientReflect,
      bufferBytes: MASKED_GRAD_BUFFER_BYTES,
      stride: MASKED_GRAD_INSTANCE_STRIDE,
      unitLocation: LOC_MASKGRAD_UNIT,
      attributes: [
        { location: LOC_MASKGRAD_DST, format: 'float32x4', offset: 0 },
        { location: LOC_MASKGRAD_SRC, format: 'float32x4', offset: 16 },
        { location: LOC_MASKGRAD_GRAD, format: 'float32x4', offset: 32 },
        { location: LOC_MASKGRAD_RAMPROW, format: 'float32', offset: 48 },
      ],
      material: [
        { binding: 0, type: 'texture-2d' },
        { binding: 1, type: 'texture-2d' },
      ],
    })
  }

  override init(device: GfxDevice, ctx: GpuBatchContext): void {
    super.init(device, ctx)
    this.#bindGroups = new WeakMap()
  }

  #bindGroupFor(
    ctx: GpuBatchContext,
    mask: Texture,
    atlas: Texture,
  ): BindGroup {
    let byAtlas = this.#bindGroups.get(mask)
    if (!byAtlas) {
      byAtlas = new WeakMap()
      this.#bindGroups.set(mask, byAtlas)
    }
    let bg = byAtlas.get(atlas)
    if (!bg) {
      bg = ctx.device.createBindGroup(this.materialLayout, [
        { binding: 0, resource: { texture: mask } },
        { binding: 1, resource: { texture: atlas } },
      ])
      byAtlas.set(atlas, bg)
    }
    return bg
  }

  /**
   * Begin (or continue) the `maskedGradient` batch for `mask` and reserve one
   * instance record. The ramp atlas is a fixed texture and does not enter the
   * batch key, only the mask does. Returns the word offset, or `-1` on
   * overflow.
   */
  beginInstance(ctx: GpuBatchContext, mask: Texture): number {
    ctx.beginBatch('maskedGradient', { texture: mask })
    return ctx.reserveInstance(this.ring)
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    const atlas =
      ctx.textureManager.getRampAtlasTexture() ?? ctx.placeholderTexture
    const material = run.texture
      ? this.#bindGroupFor(ctx, run.texture, atlas)
      : null
    this.drawInstanced(ctx, run, material)
  }
}
