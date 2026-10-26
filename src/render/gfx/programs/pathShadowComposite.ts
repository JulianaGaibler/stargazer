// Outset path-shadow composite program: an instanced affine quad sampling a
// cached blurred-coverage mask (`PathShadowCache`), tinted and knocked out of
// the shape's own silhouette. Registered as an ordinary `GpuProgram` so it
// shares the screen target's format, the analytic clip, and `GpuGfx`'s
// re-warm on retarget, same reasoning as every other 2D program.

import {
  LOC_PATHSHADOW_DITHER,
  LOC_PATHSHADOW_MCOL0,
  LOC_PATHSHADOW_MCOL1,
  LOC_PATHSHADOW_MTRANSLATE,
  LOC_PATHSHADOW_SRC,
  LOC_PATHSHADOW_TINT,
  LOC_PATHSHADOW_UNIT,
  PATHSHADOW_BUFFER_BYTES,
  PATHSHADOW_INSTANCE_STRIDE,
} from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import type { Texture } from '../GfxDevice'
import { InstancedQuadProgram } from './instancedQuad'
import pathShadowCompositeWgsl from '../shaders/pathShadowComposite.gen.wgsl?raw'
import pathShadowCompositeVertSrc from '../shaders/pathShadowComposite.gen.vert.glsl?raw'
import pathShadowCompositeFragSrc from '../shaders/pathShadowComposite.gen.frag.glsl?raw'
import pathShadowCompositeReflect from '../shaders/pathShadowComposite.reflect.json'

export class PathShadowCompositeProgram extends InstancedQuadProgram {
  readonly kind = 'pathShadowComposite' as const

  constructor() {
    super({
      label: 'pathShadowComposite',
      vertex: pathShadowCompositeVertSrc,
      fragment: pathShadowCompositeFragSrc,
      wgsl: pathShadowCompositeWgsl,
      reflection: pathShadowCompositeReflect,
      bufferBytes: PATHSHADOW_BUFFER_BYTES,
      stride: PATHSHADOW_INSTANCE_STRIDE,
      unitLocation: LOC_PATHSHADOW_UNIT,
      attributes: [
        { location: LOC_PATHSHADOW_MCOL0, format: 'float32x2', offset: 0 },
        { location: LOC_PATHSHADOW_MCOL1, format: 'float32x2', offset: 8 },
        {
          location: LOC_PATHSHADOW_MTRANSLATE,
          format: 'float32x2',
          offset: 16,
        },
        { location: LOC_PATHSHADOW_SRC, format: 'float32x4', offset: 24 },
        { location: LOC_PATHSHADOW_TINT, format: 'unorm8x4', offset: 40 },
        { location: LOC_PATHSHADOW_DITHER, format: 'float32', offset: 44 },
      ],
      material: [{ binding: 0, type: 'texture-2d' }],
      // The knockout and the tint's own alpha already resolve translucency
      // correctly under plain over-compositing. A shadow is never drawn
      // additively.
      blends: ['source-over'],
    })
  }

  /**
   * Begin (or continue) the batch for `mask` and reserve one instance record.
   * Returns the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, mask: Texture): number {
    ctx.beginBatch('pathShadowComposite', { texture: mask })
    return ctx.reserveInstance(this.ring)
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    const material = run.texture
      ? this.textureBindGroup(ctx, run.texture)
      : null
    this.drawInstanced(ctx, run, material)
  }
}
