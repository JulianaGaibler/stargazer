// Splits a CSS font around its px size, so a label of one font at any size
// shares a texture-cache key.

import type { LabelFontTemplate } from './TextureManager'
import { evictOldest } from './evictOldest'

const FONT_SIZE = /(\d*\.?\d+)px/
/** A font split around its px size, with that size, or `null` without one. */
export interface LabelFont extends LabelFontTemplate {
  size: number
}
/** Fonts recently drawn, split around their size. */
const LABEL_FONTS = new Map<string, LabelFont | null>()

export function labelFont(font: string): LabelFont | null {
  let hit = LABEL_FONTS.get(font)
  if (hit !== undefined) return hit
  const m = FONT_SIZE.exec(font)
  const size = m ? Number(m[1]) : NaN
  hit =
    m && Number.isFinite(size) && size > 0
      ? {
          head: font.slice(0, m.index),
          tail: font.slice(m.index + m[0].length),
          size,
        }
      : null
  if (LABEL_FONTS.size >= 256) evictOldest(LABEL_FONTS)
  LABEL_FONTS.set(font, hit)
  return hit
}
