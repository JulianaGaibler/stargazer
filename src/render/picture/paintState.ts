import type { CameraView2D } from '../../camera/CameraView2D'
import type { Node2D } from '../../scene/Node2D'
import type { Canvas } from './Canvas'
import type { Picture } from './Picture'

/**
 * Whether a node's `paint` is running. Marking a node for repaint from inside
 * one is a bug, because the compose walk has already decided what to draw this
 * frame, so it throws in development.
 */
let painting: object | null = null

/**
 * Record `node.paint` into `picture` through `canvas`, at `scale` device pixels
 * per unit and seen through `view`.
 *
 * @internal
 */
export function recordPaint(
  node: Node2D,
  canvas: Canvas,
  picture: Picture,
  scale: number,
  view: CameraView2D,
): void {
  painting = node
  canvas.begin(picture, scale, view)
  try {
    node.paint?.(canvas)
  } finally {
    canvas.end()
    painting = null
  }
}

/** @internal The node being painted, or `null`. */
export function paintingNode(): object | null {
  return painting
}
