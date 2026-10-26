// Text-quad program: the sole single-texture affine-quad draw. Backs both
// `Gfx2D.fillText` (cached label textures) and `Gfx2D.drawImage` (particle
// sprites, baked bitmaps). Draws a source rect from one texture as an affine
// quad, so rotation is free (no re-rasterization, just a different per-instance
// matrix). Label lookup lives on `GpuGfx` (needs `TextureManager`). This
// program owns the shader/VAO/stream plumbing and the buffer write.

import {
  LOC_TEXT_MCOL0,
  LOC_TEXT_MCOL1,
  LOC_TEXT_MTRANSLATE,
  LOC_TEXT_SRC,
  LOC_TEXT_TINT,
  LOC_TEXT_UNIT,
  TEXT_QUAD_BUFFER_BYTES,
  TEXT_QUAD_INSTANCE_STRIDE,
} from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import type { Texture } from '../GfxDevice'
import { InstancedQuadProgram } from './instancedQuad'
import textQuadWgsl from '../shaders/textQuad.gen.wgsl?raw'
import textQuadVertSrc from '../shaders/textQuad.gen.vert.glsl?raw'
import textQuadFragSrc from '../shaders/textQuad.gen.frag.glsl?raw'
import textQuadReflect from '../shaders/textQuad.reflect.json'

export class TextQuadProgram extends InstancedQuadProgram {
  readonly kind = 'textQuad' as const

  constructor() {
    super({
      label: 'textQuad',
      vertex: textQuadVertSrc,
      fragment: textQuadFragSrc,
      wgsl: textQuadWgsl,
      reflection: textQuadReflect,
      bufferBytes: TEXT_QUAD_BUFFER_BYTES,
      stride: TEXT_QUAD_INSTANCE_STRIDE,
      unitLocation: LOC_TEXT_UNIT,
      attributes: [
        { location: LOC_TEXT_MCOL0, format: 'float32x2', offset: 0 },
        { location: LOC_TEXT_MCOL1, format: 'float32x2', offset: 8 },
        { location: LOC_TEXT_MTRANSLATE, format: 'float32x2', offset: 16 },
        { location: LOC_TEXT_SRC, format: 'float32x4', offset: 24 },
        { location: LOC_TEXT_TINT, format: 'unorm8x4', offset: 40 },
      ],
      material: [{ binding: 0, type: 'texture-2d' }],
    })
  }

  /**
   * Begin (or continue) the `textQuad` batch for `tex` and reserve one instance
   * record. Returns the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, tex: Texture): number {
    ctx.beginBatch('textQuad', { texture: tex })
    return ctx.reserveInstance(this.ring)
  }

  runBounds(run: DrawRun, out: Float64Array): boolean {
    const f = this.ring.floatView
    const words = TEXT_QUAD_INSTANCE_STRIDE / 4
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let w = run.startWord; w < run.endWord; w += words) {
      // The quad is `translate + col0 * u + col1 * v` over the unit square.
      const tx = f[w + 4]
      const ty = f[w + 5]
      for (let k = 0; k < 4; k++) {
        const u = k & 1
        const v = k >> 1
        const x = tx + f[w] * u + f[w + 2] * v
        const y = ty + f[w + 1] * u + f[w + 3] * v
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (!(minX <= maxX && minY <= maxY)) return false
    out[0] = minX
    out[1] = minY
    out[2] = maxX
    out[3] = maxY
    return true
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    const material = run.texture
      ? this.textureBindGroup(ctx, run.texture)
      : null
    this.drawInstanced(ctx, run, material)
  }
}
