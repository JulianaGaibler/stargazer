// The `'polygons'` debug render mode's wireframes, drawn as thin strokes over
// the geometry a fill or stroke produced.

import type { GfxStrokeStyle } from './Gfx2D'
import type { GpuBatchContext } from './GpuBatchContext'

/** The stroke call the wireframes draw through. */
interface LineSink {
  strokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void
}

/** A one device pixel wide line, whatever the current transform's scale. */
function wireStyle(ctx: GpuBatchContext): GfxStrokeStyle {
  ctx.txStack.read(ctx.txOut)
  const t = ctx.txOut
  const det = Math.abs(t.a * t.d - t.b * t.c)
  const scale = det > 1e-9 ? Math.sqrt(det) : 1
  return {
    color: 'rgba(96, 165, 250, 0.75)',
    width: 1 / scale,
  }
}

/**
 * Thin wireframe around a local-space polygon. Width inverts the current
 * transform's uniform scale so it stays ~1 device pixel regardless of zoom.
 */
export function emitDebugPolygonOutline(
  sink: LineSink,
  ctx: GpuBatchContext,
  pts: ArrayLike<number>,
  count: number,
  closed: boolean,
): void {
  if (count < 2) return
  const style = wireStyle(ctx)
  for (let i = 0; i < count - 1; i++) {
    sink.strokeLine(
      pts[i * 2],
      pts[i * 2 + 1],
      pts[(i + 1) * 2],
      pts[(i + 1) * 2 + 1],
      style,
    )
  }
  if (closed && count >= 3) {
    const last = count - 1
    sink.strokeLine(pts[last * 2], pts[last * 2 + 1], pts[0], pts[1], style)
  }
}

/**
 * Wireframe for a stroke that routed through the outline tessellator: every
 * triangle edge of its actual output (core, joins, and fringe ring), not the
 * source contour `emitDebugPolygonOutline` draws for a fill. Deliberately not
 * just the outer boundary: the join tessellation, the fringe ring, and a
 * short-segment overlap (see `strokeOutline.ts`) are exactly what this mode
 * exists to let you see.
 */
export function emitDebugOutlineMesh(
  sink: LineSink,
  ctx: GpuBatchContext,
  outline: {
    positions: readonly number[]
    indices: readonly number[]
  },
): void {
  const idx = outline.indices
  if (idx.length < 3) return
  const style = wireStyle(ctx)
  const pos = outline.positions
  const triCount = idx.length / 3
  for (let i = 0; i < triCount; i++) {
    const i0 = idx[i * 3]
    const i1 = idx[i * 3 + 1]
    const i2 = idx[i * 3 + 2]
    const x0 = pos[i0 * 2]
    const y0 = pos[i0 * 2 + 1]
    const x1 = pos[i1 * 2]
    const y1 = pos[i1 * 2 + 1]
    const x2 = pos[i2 * 2]
    const y2 = pos[i2 * 2 + 1]
    sink.strokeLine(x0, y0, x1, y1, style)
    sink.strokeLine(x1, y1, x2, y2, style)
    sink.strokeLine(x2, y2, x0, y0, style)
  }
}
