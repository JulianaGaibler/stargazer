// Gradient fills that bypass the path fills: radial circles, masked radial
// backgrounds, shader quads and linear polygons, plus the per-frame count of
// which linear gradients fills drew with.
//
// `GpuGfx` hands each of these calls here and rolls the count once per frame.

import { diagnostics } from '../../diagnostics/Diagnostics'
import type { Gfx2D, GfxGradientStop, GfxLinearGradient } from './Gfx2D'
import type { Texture } from './GfxDevice'
import type { GpuBatchContext } from './GpuBatchContext'
import { emitDebugPolygonOutline } from './debugWireframe'
import type { ShaderQuad } from './ShaderQuad'
import type { ColoredTriProgram } from './programs/coloredTri'
import type { GradientRadialProgram } from './programs/gradientRadial'
import type { MaskedGradientProgram } from './programs/maskedGradient'
import type { ShaderQuadProgram } from './programs/shaderQuad'

/** What gradient fills need from the `GpuGfx` that owns them. */
export interface GradientFillsHost {
  ctx: GpuBatchContext
  coloredTri: ColoredTriProgram
  radial: GradientRadialProgram
  masked: MaskedGradientProgram
  shaderQuad: ShaderQuadProgram
  /** The `Gfx2D` that debug wireframes are drawn through. */
  gfx: Pick<Gfx2D, 'strokeLine'>
}

export class GradientFills {
  readonly #ctx: GpuBatchContext
  readonly #coloredTri: ColoredTriProgram
  readonly #radial: GradientRadialProgram
  readonly #masked: MaskedGradientProgram
  readonly #shaderQuad: ShaderQuadProgram
  readonly #gfx: GradientFillsHost['gfx']

  constructor(host: GradientFillsHost) {
    this.#ctx = host.ctx
    this.#coloredTri = host.coloredTri
    this.#radial = host.radial
    this.#masked = host.masked
    this.#shaderQuad = host.shaderQuad
    this.#gfx = host.gfx
  }

  /** Make this frame's count the previous one, and start a new count. */
  beginFrame(): void {
    const used = this.#gradientUsePrev
    this.#gradientUsePrev = this.#gradientUse
    this.#gradientUse = used
    used.clear()
  }

  /**
   * How many fills drew with each gradient this frame and the frame before,
   * keyed by the gradient's device-space axis and stops. Two fills with the
   * same key share a paint and can draw as one run.
   */
  #gradientUse = new Map<string, number>()
  #gradientUsePrev = new Map<string, number>()

  /**
   * Count `fill` as drawn this frame, and report whether another fill drew with
   * the same gradient the frame before.
   */
  shared(fill: GfxLinearGradient): boolean {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const x0 = t.a * fill.x0 + t.c * fill.y0 + t.e
    const y0 = t.b * fill.x0 + t.d * fill.y0 + t.f
    const x1 = t.a * fill.x1 + t.c * fill.y1 + t.e
    const y1 = t.b * fill.x1 + t.d * fill.y1 + t.f
    let key = `${x0},${y0},${x1},${y1},${this.#ctx.stateStack.getAlpha()}`
    for (const s of fill.stops) key += `|${s.offset}:${s.color}`
    this.#gradientUse.set(key, (this.#gradientUse.get(key) ?? 0) + 1)
    return (this.#gradientUsePrev.get(key) ?? 0) > 1
  }

  fillCircleRadialGradient(
    cx: number,
    cy: number,
    r: number,
    stops: readonly GfxGradientStop[],
  ): void {
    if (r <= 0 || stops.length === 0) return
    const rampRow = this.#ctx.textureManager.ensureStopsRow(stops)
    if (rampRow < 0) return
    const off = this.#radial.beginInstance(this.#ctx)
    if (off < 0) return
    const slot = this.#ctx.curSlot
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const dcx = t.a * cx + t.c * cy + t.e
    const dcy = t.b * cx + t.d * cy + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const dr = r * Math.sqrt(det)
    const alpha = this.#ctx.stateStack.getAlpha()
    const f = this.#radial.floatView
    f[off + 0] = dcx
    f[off + 1] = dcy
    f[off + 2] = dr
    f[off + 3] = alpha
    f[off + 4] = rampRow
    f[off + 5] = 0
    this.#radial.commitInstance(slot)
  }

  drawShaderQuad(
    quad: ShaderQuad,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (w <= 0 || h <= 0) return
    if (this.#ctx.stateStack.getClipMask()) {
      diagnostics.report(
        'SG2006',
        'drawShaderQuad ignores setClipMask. Sample a mask inside the shader, or use setClip.',
      )
    }
    this.#shaderQuad.record(this.#ctx, quad, x, y, w, h)
  }

  fillMaskedRadialGradient(
    mask: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    gcx: number,
    gcy: number,
    gr: number,
    stops: readonly GfxGradientStop[],
  ): void {
    if (gr <= 0 || dw <= 0 || dh <= 0 || stops.length === 0) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    // Axis-aligned assumption (same as drawImage): the background base
    // transform never rotates/skews.
    if (Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9) return
    const rampRow = this.#ctx.textureManager.ensureStopsRow(stops)
    if (rampRow < 0) return
    const entry = this.#ctx.textureManager.getOrCreateEntry(mask)
    if (entry === null) return
    let tex: Texture
    let u0: number, v0: number, u1: number, v1: number
    if ('srcRect' in entry) {
      tex = entry.tex
      const r = entry.srcRect
      u0 = r[0]
      v0 = r[1]
      u1 = r[2]
      v1 = r[3]
    } else {
      tex = entry
      u0 = 0
      v0 = 0
      u1 = 1
      v1 = 1
    }
    const off = this.#masked.beginInstance(this.#ctx, tex)
    if (off < 0) return
    const slot = this.#ctx.curSlot
    const dstX = t.a * dx + t.e
    const dstY = t.d * dy + t.f
    const dstW = t.a * dw
    const dstH = t.d * dh
    const dcx = t.a * gcx + t.c * gcy + t.e
    const dcy = t.b * gcx + t.d * gcy + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const dr = gr * Math.sqrt(det)
    const alpha = this.#ctx.stateStack.getAlpha()
    const f = this.#masked.floatView
    f[off + 0] = dstX
    f[off + 1] = dstY
    f[off + 2] = dstW
    f[off + 3] = dstH
    f[off + 4] = u0
    f[off + 5] = v0
    f[off + 6] = u1
    f[off + 7] = v1
    f[off + 8] = dcx
    f[off + 9] = dcy
    f[off + 10] = dr
    f[off + 11] = alpha
    f[off + 12] = rampRow
    this.#masked.commitInstance(slot)
  }

  fillPolyLinearGradient(
    pts: ArrayLike<number>,
    count: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colorStart: string,
    colorEnd: string,
  ): void {
    this.#coloredTri.fillPolyLinearGradient(
      this.#ctx,
      pts,
      count,
      x0,
      y0,
      x1,
      y1,
      colorStart,
      colorEnd,
    )
    if (this.#ctx.curDebugMode === 'polygons') {
      emitDebugPolygonOutline(this.#gfx, this.#ctx, pts, count, true)
    }
  }
}
