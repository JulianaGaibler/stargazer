// Image draws: a small image joins the shared label page, a larger one comes
// from the texture manager's atlas or its own texture.

import type { GfxImageOptions } from './Gfx2D'
import type { Texture } from './GfxDevice'
import type { GpuBatchContext } from './GpuBatchContext'
import { SHAPE_TEX_ATLAS, SHAPE_TEX_LABEL } from './batchLayout'
import type { ShapeProgram } from './programs/shape'
import type { TextQuadProgram } from './programs/textQuad'

export class ImageDraw {
  readonly #ctx: GpuBatchContext
  readonly #shape: ShapeProgram
  readonly #textQuad: TextQuadProgram

  constructor(
    ctx: GpuBatchContext,
    shape: ShapeProgram,
    textQuad: TextQuadProgram,
  ) {
    this.#ctx = ctx
    this.#shape = shape
    this.#textQuad = textQuad
  }

  drawImage(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    opts?: GfxImageOptions,
  ): void {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    if (
      !this.#ctx.textureManager.isAtlasSource(img) &&
      this.#drawImageRaster(img, dx, dy, dw, dh, opts)
    ) {
      return
    }
    const entry = this.#ctx.textureManager.getOrCreateEntry(img)
    if (entry === null) return
    // Discriminate atlas entry vs standalone Texture. Atlas entries carry
    // a `srcRect` field, standalone Textures don't.
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
    // Full affine (shares the shape/textQuad layout): the unit square [0,1]²
    // maps to device px via mCol0·u + mCol1·v + translate, so rotation/skew are
    // free, with no axis-aligned rejection.
    const col0x = t.a * dw
    const col0y = t.b * dw
    const col1x = t.c * dh
    const col1y = t.d * dh
    let tx = t.a * dx + t.c * dy + t.e
    let ty = t.b * dx + t.d * dy + t.f
    // Subpixel-snap only when axis-aligned (matches fillText): land 1:1 texels
    // on whole device pixels so blits don't smear. Skip when rotated/skewed.
    if (Math.abs(t.b) < 1e-6 && Math.abs(t.c) < 1e-6) {
      tx = Math.round(tx)
      ty = Math.round(ty)
    }
    const alpha = this.#ctx.stateStack.getAlpha()
    const tintByte = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    const packedTint =
      ((tintByte << 24) | (tintByte << 16) | (tintByte << 8) | tintByte) >>> 0
    // Shape routing: only atlas sprites (the particle atlas bound at the shape's
    // fixed atlas unit) go through it. A per-source image has its own texture,
    // which the shape doesn't bind, so it stays on the textQuad program.
    if (tex === this.#ctx.textureManager.getAtlasTexture()) {
      this.#shape.textured(
        this.#ctx,
        col0x,
        col0y,
        col1x,
        col1y,
        tx,
        ty,
        u0,
        v0,
        u1,
        v1,
        SHAPE_TEX_ATLAS,
        packedTint,
      )
      return
    }
    const words = this.#textQuad.beginInstance(this.#ctx, tex)
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
    fv[words + 6] = u0
    fv[words + 7] = v0
    fv[words + 8] = u1
    fv[words + 9] = v1
    uv[words + 10] = packedTint >>> 0
    this.#textQuad.commitInstance(slot)
  }

  /**
   * Draw a small image from the shared label page, so it joins the draws of the
   * text and shapes around it. False when the image is too large for a page
   * slot, and the caller draws it from its own texture.
   */
  #drawImageRaster(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    opts: GfxImageOptions | undefined,
  ): boolean {
    const t = this.#ctx.txOut
    const devW = Math.hypot(t.a, t.b) * dw
    const devH = Math.hypot(t.c, t.d) * dh
    const label = this.#ctx.textureManager.ensureImageRaster(
      img,
      devW,
      devH,
      opts?.smoothing !== false,
    )
    if (label === null) return false
    if (label.tex !== this.#ctx.textureManager.getLabelPageTexture())
      return false
    const col0x = t.a * dw
    const col0y = t.b * dw
    const col1x = t.c * dh
    const col1y = t.d * dh
    let tx = t.a * dx + t.c * dy + t.e
    let ty = t.b * dx + t.d * dy + t.f
    if (Math.abs(t.b) < 1e-6 && Math.abs(t.c) < 1e-6) {
      tx = Math.round(tx)
      ty = Math.round(ty)
    }
    const alpha = this.#ctx.stateStack.getAlpha()
    const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    const packedTint = ((a << 24) | (a << 16) | (a << 8) | a) >>> 0
    const sr = label.srcRect
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
    return true
  }
}
