// Text draws: resolves a label for a string and style, then draws it from the
// shared label page or its own texture.

import type { GfxTextStyle } from './Gfx2D'
import type { GpuBatchContext } from './GpuBatchContext'
import { SHAPE_TEX_LABEL } from './batchLayout'
import { packColor } from './packing'
import { labelFont } from './labelFont'
import { DEFAULT_LABEL_FONT, type LabelStyle } from './rasterizeLabel'
import type { ShapeProgram } from './programs/shape'
import type { TextQuadProgram } from './programs/textQuad'
import type { LabelTexture } from './TextureManager'

/** The style a `fillText` call without one draws with. */
const NO_TEXT_STYLE: GfxTextStyle = {}

/** The color a tinted label is rasterized in, so the tint alone colors it. */
const TINT_BASE = '#fff'

/**
 * The scale-independent half of a label's cache key. `TextureManager` appends
 * the scale bucket. Newline separators cannot collide: labels are single-line,
 * so the text has none, and font/align/baseline/color never do.
 */

function labelBaseKey(text: string, style: LabelStyle): string {
  return `${text}\n${style.font}\n${style.align}\n${style.baseline}\n${style.color}\n`
}

export class TextDraw {
  readonly #ctx: GpuBatchContext
  readonly #shape: ShapeProgram
  readonly #textQuad: TextQuadProgram

  /**
   * The resolved style of the label being drawn, reused across calls. The
   * texture cache reads it only while rasterizing and keeps no reference.
   */
  readonly #labelStyle: LabelStyle = {
    font: DEFAULT_LABEL_FONT,
    align: 'left',
    baseline: 'alphabetic',
    color: '#000',
  }

  constructor(
    ctx: GpuBatchContext,
    shape: ShapeProgram,
    textQuad: TextQuadProgram,
  ) {
    this.#ctx = ctx
    this.#shape = shape
    this.#textQuad = textQuad
  }

  warmText(text: string, style: GfxTextStyle = NO_TEXT_STYLE): void {
    if (text.length === 0) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const deviceScale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d))
    if (!(deviceScale > 0)) return
    this.#label(text, style, deviceScale, true)
  }

  /**
   * The label for `text`. A font with a px size is keyed without it and
   * rasterized at its size in device px, so `labelScale` is what the label's
   * sizes are multiplied by to reach local units. Any other font is keyed whole
   * and rasterized at the scale. With `warm`, a text label is rasterized at its
   * exact size even while its size is changing.
   */
  #label(
    text: string,
    style: GfxTextStyle,
    deviceScale: number,
    warm = false,
  ): LabelTexture | null {
    const resolved = this.#labelStyle
    const fontName = style.font ?? DEFAULT_LABEL_FONT
    resolved.font = fontName
    resolved.align = style.align ?? 'left'
    resolved.baseline = style.baseline ?? 'alphabetic'
    resolved.color = style.tint ? TINT_BASE : (style.color ?? '#000')
    const font = labelFont(fontName)
    if (!font) {
      this.#labelScale = 1
      return this.#ctx.textureManager.ensureLabelTexture(
        labelBaseKey(text, resolved),
        text,
        resolved,
        deviceScale,
      )
    }
    const label = this.#ctx.textureManager.ensureTextLabel(
      `${text}\n${font.head}\u0000${font.tail}\n${resolved.align}\n${resolved.baseline}\n${resolved.color}\n`,
      text,
      resolved,
      font,
      font.size,
      deviceScale,
      warm,
    )
    this.#labelScale = label?.px ? font.size / label.px : 1
    return label
  }
  #labelScale = 1

  fillText(
    text: string,
    x: number,
    y: number,
    style: GfxTextStyle = NO_TEXT_STYLE,
  ): void {
    if (text.length === 0) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    // Net local->device scale, independent of rotation (columns of the linear
    // part). Drives how sharply the label is rasterized. Rotation is free.
    const deviceScale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d))
    if (!(deviceScale > 0)) return

    const label = this.#label(text, style, deviceScale)
    if (label === null) return

    // Local-space dst rect: bitmap top-left relative to the (x, y) anchor. A
    // label's sizes are in px of the font size it was rasterized at.
    const ls = this.#labelScale
    const dx = x - label.anchorOffsetX * ls
    const dy = y - label.anchorOffsetY * ls
    const w = label.localW * ls
    const h = label.localH * ls
    // Affine mapping the unit square [0,1]² -> device px:
    //   pos = col0 * u + col1 * v + translate
    const col0x = t.a * w
    const col0y = t.b * w
    const col1x = t.c * h
    const col1y = t.d * h
    let tx = t.a * dx + t.c * dy + t.e
    let ty = t.b * dx + t.d * dy + t.f
    // Subpixel snap for axis-aligned draws (all screen-space labels, and any
    // non-rotated world label): land the 1:1 texels on whole device pixels so
    // they don't smear. Skip when rotated/skewed (snapping wouldn't align).
    if (Math.abs(t.b) < 1e-6 && Math.abs(t.c) < 1e-6) {
      tx = Math.round(tx)
      ty = Math.round(ty)
    }

    // Tint = white × alpha (premultiplied), which keeps a baked glyph color
    // (and a multi-color emoji) and only applies the current alpha. A tinted
    // label is white, and the tint is its color × alpha.
    const alpha = this.#ctx.stateStack.getAlpha()
    let packedTint: number
    if (style.tint) {
      packedTint = packColor(style.color ?? '#000', alpha) >>> 0
    } else {
      const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
      packedTint = ((a << 24) | (a << 16) | (a << 8) | a) >>> 0
    }

    // Sample the label's region in its texture: a sub-rect of the shared label
    // page, or the whole texture ([0,0,1,1]) for an oversized dedicated label.
    const sr = label.srcRect
    // Shape routing: only page-backed labels (the shared label page bound at the
    // shape's fixed label unit) can go through it. An oversized label has its own
    // texture, so it stays on the textQuad program.
    if (label.tex === this.#ctx.textureManager.getLabelPageTexture()) {
      this.#shape.textured(
        this.#ctx,
        col0x,
        col0y,
        col1x,
        col1y,
        tx,
        ty,
        sr[0],
        sr[1],
        sr[2],
        sr[3],
        SHAPE_TEX_LABEL,
        packedTint,
      )
      return
    }

    const words = this.#textQuad.beginInstance(this.#ctx, label.tex)
    if (words < 0) return
    const slot = this.#ctx.curSlot
    const fv = this.#textQuad.floatView
    const uv = this.#textQuad.uintView
    fv[words + 0] = col0x
    fv[words + 1] = col0y
    fv[words + 2] = col1x
    fv[words + 3] = col1y
    fv[words + 4] = tx
    fv[words + 5] = ty
    fv[words + 6] = sr[0] // u0
    fv[words + 7] = sr[1] // v0
    fv[words + 8] = sr[2] // u1
    fv[words + 9] = sr[3] // v1
    uv[words + 10] = packedTint
    this.#textQuad.commitInstance(slot)
  }
}
