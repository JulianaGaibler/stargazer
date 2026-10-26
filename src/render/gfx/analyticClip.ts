// Resolves a `Gfx2D.setClip` shape into the device-space clip the shaders
// test against, alongside the inverse that maps device pixels back into the
// space the shape was given in.

import type { GfxClipShape } from './Gfx2D'
import { resolveRadii } from './roundRectRadii'
import type { ResolvedClip } from './StateStack'
import type { TransformOut } from './TransformStack'

const NO_CLIP_RADII = [0, 0, 0, 0] as const

/**
 * `shape` resolved through transform `t`. The result is a fresh object, since
 * the state stack keeps the clip after the call returns.
 */
export function resolveClip(
  t: TransformOut,
  shape: GfxClipShape,
): ResolvedClip {
  const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c))
  // The inverse maps a device pixel back into the space the shape was given
  // in. A transform with no inverse clips everything: the shape is moved out
  // of reach.
  const det = t.a * t.d - t.b * t.c
  const singular = !(Math.abs(det) > 1e-12)
  const inv = singular ? 0 : 1 / det
  const ia = singular ? 0 : t.d * inv
  const ib = singular ? 0 : -t.b * inv
  const ic = singular ? 0 : -t.c * inv
  const id = singular ? 0 : t.a * inv
  const ie = singular ? 0 : (t.c * t.f - t.d * t.e) * inv
  const iff = singular ? 0 : (t.b * t.e - t.a * t.f) * inv
  const far = 1e9
  if (shape.kind === 'circle') {
    return {
      kind: 1,
      cx: t.a * shape.cx + t.c * shape.cy + t.e,
      cy: t.b * shape.cx + t.d * shape.cy + t.f,
      r: shape.r * scale,
      halfW: 0,
      halfH: 0,
      radii: NO_CLIP_RADII,
      lcx: singular ? far : shape.cx,
      lcy: shape.cy,
      lr: shape.r,
      lhalfW: 0,
      lhalfH: 0,
      lradii: NO_CLIP_RADII,
      ia,
      ib,
      ic,
      id,
      ie,
      if: iff,
    }
  }
  const midX = shape.x + shape.w / 2
  const midY = shape.y + shape.h / 2
  const lradii = resolveRadii(
    shape.radii ?? shape.radius ?? 0,
    shape.w,
    shape.h,
  )
  return {
    kind: 2,
    cx: t.a * midX + t.c * midY + t.e,
    cy: t.b * midX + t.d * midY + t.f,
    r: 0,
    halfW: (shape.w / 2) * Math.abs(t.a),
    halfH: (shape.h / 2) * Math.abs(t.d),
    radii: [
      lradii[0] * scale,
      lradii[1] * scale,
      lradii[2] * scale,
      lradii[3] * scale,
    ],
    lcx: singular ? far : midX,
    lcy: midY,
    lr: 0,
    lhalfW: shape.w / 2,
    lhalfH: shape.h / 2,
    lradii,
    ia,
    ib,
    ic,
    id,
    ie,
    if: iff,
  }
}
