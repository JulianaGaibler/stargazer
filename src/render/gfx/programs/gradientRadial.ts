// Radial-gradient program: `Gfx2D.fillCircleRadialGradient`. The ramp atlas
// lookup lives on `GpuGfx` (needs `TextureManager`). This program owns the
// shader/VAO/stream plumbing and the buffer write. The atlas is a fixed
// texture (see `TextureManager.getRampAtlasTexture`), so unlike the mask in
// `maskedGradient`, nothing here varies the bind group per draw.

import {
  GRADIENT_BUFFER_BYTES,
  GRADIENT_INSTANCE_STRIDE,
  LOC_GRAD_CENTER,
  LOC_GRAD_RADALPHA,
  LOC_GRAD_RAMPROW,
  LOC_GRAD_UNIT,
} from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import { InstancedQuadProgram } from './instancedQuad'
import gradientRadialWgsl from '../shaders/gradientRadial.gen.wgsl?raw'
import gradientRadialVertSrc from '../shaders/gradientRadial.gen.vert.glsl?raw'
import gradientRadialFragSrc from '../shaders/gradientRadial.gen.frag.glsl?raw'
import gradientRadialReflect from '../shaders/gradientRadial.reflect.json'

export class GradientRadialProgram extends InstancedQuadProgram {
  readonly kind = 'gradientRadial' as const

  constructor() {
    super({
      label: 'gradientRadial',
      vertex: gradientRadialVertSrc,
      fragment: gradientRadialFragSrc,
      wgsl: gradientRadialWgsl,
      reflection: gradientRadialReflect,
      bufferBytes: GRADIENT_BUFFER_BYTES,
      stride: GRADIENT_INSTANCE_STRIDE,
      unitLocation: LOC_GRAD_UNIT,
      attributes: [
        { location: LOC_GRAD_CENTER, format: 'float32x2', offset: 0 },
        { location: LOC_GRAD_RADALPHA, format: 'float32x2', offset: 8 },
        { location: LOC_GRAD_RAMPROW, format: 'float32', offset: 16 },
      ],
      material: [{ binding: 0, type: 'texture-2d' }],
    })
  }

  /**
   * Begin (or continue) the `gradientRadial` batch and reserve one instance
   * record. The atlas is a fixed texture, so distinct gradients (distinct rows)
   * never break the batch, only a switch away from this program does. Returns
   * the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext): number {
    ctx.beginBatch('gradientRadial')
    return ctx.reserveInstance(this.ring)
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    // The placeholder stands in until the atlas exists, and each gets its own
    // cached bind group.
    const atlas =
      ctx.textureManager.getRampAtlasTexture() ?? ctx.placeholderTexture
    this.drawInstanced(ctx, run, this.textureBindGroup(ctx, atlas))
  }
}
