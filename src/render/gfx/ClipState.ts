import type { ClipBounds } from './programs/coloredTri'

/** One clip path pushed by `clipPath`, undone by the `restore` of its level. */
export interface ClipPush {
  level: number
  /** Device bounds to pop, `null` when the clip raised no pixels. */
  bounds: ClipBounds | null
  /** Whether the depth went up, `false` when the depth cap refused it. */
  raised: boolean
}

/**
 * The save depth and the clip pushes that `save`, `restore` and `clipPath`
 * share with the offscreen stack, which parks both while a surface is open.
 */
export class ClipState {
  saveLevel = 0
  readonly pushes: ClipPush[] = []
}
