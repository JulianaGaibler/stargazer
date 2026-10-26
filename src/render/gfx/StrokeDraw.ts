// Strokes: the segment stroker for plain lines, curves and polylines, the
// outline tessellator for gradients and aligned strokes, and the caches that
// keep stroke work between frames.
//
// `GpuGfx` hands each stroke call here and sweeps the caches once per frame.

import type { Gfx2D, GfxStrokeStyle, SolidStrokeStyle } from './Gfx2D'
import type { GpuBatchContext, GpuGfxStats } from './GpuBatchContext'
import { parseColor } from './parseColor'
import { RetainedCache } from './RetainedCache'
import {
  getContourClosed,
  getPathContours,
  getRegistrationEpoch,
} from './PathTessellationRegistry'
import {
  strokeOutline,
  scaleBucketCenter,
  scaleBucketIndex,
  StrokeOutlineBuffer,
  DEFAULT_MITER_LIMIT,
  wouldFallBackToCenter,
} from './strokeOutline'
import { flattenQuadratic } from '../../assets/SvgPathContours'
import type { GfxPath } from './GfxPath'
import { CURVE_FLATTEN_MAX_POINTS, CURVE_FLATTEN_TOL_PX } from './batchLayout'
import { emitDebugOutlineMesh } from './debugWireframe'
import type { StrokeProgram } from './programs/stroke'
import type { ShapeProgram } from './programs/shape'
import type { ColoredTriProgram } from './programs/coloredTri'
import type { UnimplementedCounts } from './GpuGfx'

/**
 * Fewest segments a path stroke has before its packed instances are worth
 * keeping on the GPU between frames.
 */
const RETAIN_STROKE_SEGMENTS = 256

/**
 * `style` with a flat color, for the circle and round-rect strokes. A gradient
 * stroke on those shapes is not supported: the `shape` program's paint slot
 * serves the fill. It falls back to the gradient's first stop rather than
 * dropping the stroke. A style that already has a flat color is returned as is,
 * so the common case copies nothing.
 */
export function solidStroke(style: GfxStrokeStyle): SolidStrokeStyle {
  const color = style.color
  if (typeof color === 'string') return style as SolidStrokeStyle
  return { ...style, color: color.stops[0]?.color ?? '#000' }
}

/** What strokes need from the `GpuGfx` that owns them. */
export interface StrokeDrawHost {
  ctx: GpuBatchContext
  stroke: StrokeProgram
  shape: ShapeProgram
  coloredTri: ColoredTriProgram
  stats: GpuGfxStats
  unimplemented: UnimplementedCounts
  /** The `Gfx2D` that debug wireframes of outline meshes are drawn through. */
  gfx: Pick<Gfx2D, 'strokeLine'>
  hasStencil(): boolean
}

export class StrokeDraw {
  readonly #ctx: GpuBatchContext
  readonly #stroke: StrokeProgram
  readonly #shape: ShapeProgram
  readonly #coloredTri: ColoredTriProgram
  readonly #stats: GpuGfxStats
  readonly #unimplemented: UnimplementedCounts
  readonly #gfx: StrokeDrawHost['gfx']
  readonly #hasStencil: () => boolean

  constructor(host: StrokeDrawHost) {
    this.#ctx = host.ctx
    this.#stroke = host.stroke
    this.#shape = host.shape
    this.#coloredTri = host.coloredTri
    this.#stats = host.stats
    this.#unimplemented = host.unimplemented
    this.#gfx = host.gfx
    this.#hasStencil = () => host.hasStencil()
  }

  /** Tessellated stroke outlines of registered paths, by style and scale. */
  readonly outlines = new RetainedCache<{
    buffer: StrokeOutlineBuffer
    bytes: number
    release(): void
  }>({
    name: 'Stroke outlines',
    idleFrames: 120,
    budgetBytes: 8 * 1024 * 1024,
  })

  /** The convex pieces of strokes drawn as a filled union, by path and shape. */
  readonly strokePieces = new RetainedCache<{
    path: GfxPath
    bytes: number
    release(): void
  }>({
    name: 'Stroke pieces',
    idleFrames: 120,
    budgetBytes: 8 * 1024 * 1024,
  })

  /** Set while `strokePath` holds one stencil group over all its contours. */
  pathGroup = false

  /**
   * The recorded call being replayed, a stable identity for as long as the
   * picture that holds it is unchanged. `null` outside a replay.
   */
  #replaySource: object | null = null

  replaySource(token: object | null): void {
    this.#replaySource = token
  }

  /** Points of an outline-stroked line or curve, reused across calls. */
  readonly #linePoints = new Float32Array(4)
  readonly #curvePoints = new Float32Array(CURVE_FLATTEN_MAX_POINTS * 2)

  strokeCircle(cx: number, cy: number, r: number, style: GfxStrokeStyle): void {
    this.#shape.strokeCircle(this.#ctx, cx, cy, r, solidStroke(style))
  }

  /**
   * Whether `style` needs the outline tessellator rather than the segment
   * stroker.
   */
  needsOutline(style: GfxStrokeStyle): boolean {
    return (
      (style.align !== undefined && style.align !== 'center') ||
      style.exactJoins === true ||
      typeof style.color !== 'string'
    )
  }

  strokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    if (this.needsOutline(style)) {
      const pts = this.#linePoints
      pts[0] = x0
      pts[1] = y0
      pts[2] = x1
      pts[3] = y1
      this.#strokeOutlineUncached(pts, 2, false, style)
      return
    }
    this.#stroke.line(this.#ctx, x0, y0, x1, y1, style as SolidStrokeStyle)
  }

  strokeQuadratic(
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    if (this.needsOutline(style)) {
      this.#ctx.txStack.read(this.#ctx.txOut)
      const t = this.#ctx.txOut
      const det = Math.abs(t.a * t.d - t.b * t.c)
      const localTol = CURVE_FLATTEN_TOL_PX / (Math.sqrt(det) || 1)
      const buf = this.#curvePoints
      buf[0] = x0
      buf[1] = y0
      const cursor = flattenQuadratic(x0, y0, cx, cy, x1, y1, localTol, buf, 2)
      this.#strokeOutlineUncached(buf, cursor / 2, false, style)
      return
    }
    // Flattening turns one curve into many collinear segments, so a translucent
    // quadratic beads at every one of them. Segment count is not known until
    // the flattener runs, and a curve always has more than one.
    if (!this.strokeNeedsStencil(style as SolidStrokeStyle, 2)) {
      this.#stroke.quadratic(
        this.#ctx,
        x0,
        y0,
        cx,
        cy,
        x1,
        y1,
        style as SolidStrokeStyle,
      )
      return
    }
    this.#ctx.beginStencilGroup()
    this.#stroke.quadratic(
      this.#ctx,
      x0,
      y0,
      cx,
      cy,
      x1,
      y1,
      style as SolidStrokeStyle,
    )
    this.#ctx.endStencilGroup()
  }

  /**
   * Whether a stroke of `segments` segments needs the deduplicating stencil
   * path.
   *
   * Only translucent strokes can bead: an opaque one composites to the same
   * result however many times it covers a pixel, so it stays on the plain,
   * fully batched path. A single segment has no interior join and so cannot
   * overlap itself either.
   */
  strokeNeedsStencil(style: SolidStrokeStyle, segments: number): boolean {
    if (this.pathGroup || segments < 2 || !this.#hasStencil()) {
      return false
    }
    const alpha = this.#ctx.stateStack.getAlpha() * parseColor(style.color).a
    return alpha < 1
  }

  /** Current transform's per-axis device scale, for the outline tessellator. */
  #outlineScale(): { scaleX: number; scaleY: number; scale: number } {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const scaleX = Math.hypot(t.a, t.b)
    const scaleY = Math.hypot(t.c, t.d)
    return { scaleX, scaleY, scale: Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) }
  }

  /**
   * Tessellate and draw a stroke outline with no caching: `strokePolyline`'s
   * `pts` has no stable identity to key by (the caller mutates its buffer every
   * frame), and `strokeLine`/`strokeQuadratic` are cheap one-or-few segment
   * shapes where a cache would cost more than it saves.
   */
  #strokeOutlineUncached(
    pts: ArrayLike<number>,
    count: number,
    closed: boolean,
    style: GfxStrokeStyle,
  ): void {
    if (count < 2 || style.width <= 0) return
    const align = style.align ?? 'center'
    if (wouldFallBackToCenter(pts, count, closed, align)) {
      this.#unimplemented.strokeAlignFallback++
    }
    const { scaleX, scaleY, scale } = this.#outlineScale()
    const buf = new StrokeOutlineBuffer()
    strokeOutline(
      pts,
      count,
      {
        width: style.width,
        align,
        join: style.join ?? 'miter',
        cap: style.cap ?? 'round',
        miterLimit: style.miterLimit ?? DEFAULT_MITER_LIMIT,
        closed,
        fringeScale: { x: scaleX, y: scaleY },
        scale,
      },
      buf,
    )
    this.#coloredTri.fillOutlineTessellation(this.#ctx, buf, style.color)
    if (this.#ctx.curDebugMode === 'polygons') {
      emitDebugOutlineMesh(this.#gfx, this.#ctx, buf)
    }
  }

  strokePolyline(
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void {
    if (this.needsOutline(style)) {
      this.#strokeOutlineUncached(pts, count, style.closed === true, style)
      return
    }
    // A closed polyline joins back to its first point, so it has one more
    // segment than an open one.
    const segments = style.closed === true ? count : count - 1
    const solidStyle = style as SolidStrokeStyle
    this.#strokeRetained(
      this.#replaySource,
      'polyline',
      segments,
      solidStyle,
      this.strokeNeedsStencil(solidStyle, segments),
      () => this.#stroke.polyline(this.#ctx, pts, count, solidStyle),
    )
  }

  /**
   * Tessellate (or reuse the cached tessellation of) one contour's stroke
   * outline. Keyed by the style signature, the half-octave scale and anisotropy
   * buckets, and the path's registration epoch, so a re-parse at a new
   * tolerance can't serve triangles built from stale contours. `dash` is not
   * supported on the outline path and is ignored here: no caller combines it
   * with a gradient color, a non-center alignment, or `exactJoins` today.
   */
  #strokeOutlineCached(
    path: Path2D,
    contourIndex: number,
    pts: Float32Array,
    closed: boolean,
    style: GfxStrokeStyle,
  ): void {
    if (pts.length < 4 || style.width <= 0) return
    const { scaleX, scaleY } = this.#outlineScale()
    const uniformScale = Math.sqrt(scaleX * scaleY)
    const anisotropy = scaleY > 0 ? scaleX / scaleY : 1
    const scaleBucket = scaleBucketIndex(uniformScale)
    const anisoBucket = scaleBucketIndex(anisotropy)
    const align = style.align ?? 'center'
    const join = style.join ?? 'miter'
    const cap = style.cap ?? 'round'
    const miterLimit = style.miterLimit ?? DEFAULT_MITER_LIMIT
    if (wouldFallBackToCenter(pts, pts.length / 2, closed, align)) {
      this.#unimplemented.strokeAlignFallback++
    }
    const key = `${style.width}|${align}|${join}|${cap}|${miterLimit}|${closed}|${scaleBucket}|${anisoBucket}|${getRegistrationEpoch(path)}|${contourIndex}`
    const cacheKey = this.outlines.keyFor(path, key)
    let buf = this.outlines.get(cacheKey)?.buffer
    if (buf) {
      this.#stats.outlineCacheHits++
    } else {
      this.#stats.outlineTessellations++
      const uniformCenter = scaleBucketCenter(scaleBucket)
      const anisoCenter = scaleBucketCenter(anisoBucket)
      const bucketScaleX = uniformCenter * Math.sqrt(anisoCenter)
      const bucketScaleY = uniformCenter / Math.sqrt(anisoCenter)
      buf = new StrokeOutlineBuffer()
      strokeOutline(
        pts,
        pts.length / 2,
        {
          width: style.width,
          align,
          join,
          cap,
          miterLimit,
          closed,
          fringeScale: { x: bucketScaleX, y: bucketScaleY },
          scale: uniformCenter,
        },
        buf,
      )
      this.outlines.add(cacheKey, {
        buffer: buf,
        bytes:
          (buf.positions.length + buf.coverage.length + buf.indices.length) * 8,
        release: () => {},
      })
    }
    this.#coloredTri.fillOutlineTessellation(this.#ctx, buf, style.color)
    if (this.#ctx.curDebugMode === 'polygons') {
      emitDebugOutlineMesh(this.#gfx, this.#ctx, buf)
    }
  }

  /**
   * Stroke through `emit`, from the stroke cache when the same stroke was drawn
   * the frame before. `source` is what the points belong to, and `kind` tells
   * apart several strokes made from one source. Strokes with no stable source,
   * too few segments to be worth a run of their own, or a dash are drawn
   * directly.
   */
  #strokeRetained(
    source: object | null,
    kind: string,
    segments: number,
    style: SolidStrokeStyle,
    stencil: boolean,
    emit: () => void,
  ): void {
    const cache = this.#stroke.cache
    let key: string | null = null
    if (
      source !== null &&
      segments >= RETAIN_STROKE_SEGMENTS &&
      style.dash === undefined
    ) {
      key = cache.keyFor(source, `${kind}|${this.#strokeSignature(style)}`)
      const hit = cache.get(key)
      if (hit) {
        this.#ctx.recordInstanced(hit.buffer, hit.words, hit.bounds, stencil)
        return
      }
      if (!cache.admit(key)) key = null
    }
    if (key !== null) this.#ctx.closeRun()
    const firstRun = this.#ctx.runCount
    if (stencil) this.#ctx.beginStencilGroup()
    emit()
    if (stencil) this.#ctx.endStencilGroup()
    if (key !== null) this.#keepStroke(key, firstRun)
  }

  /**
   * What packed stroke instances depend on besides their points: the transform,
   * the alpha, and the style that shapes them.
   */
  #strokeSignature(style: SolidStrokeStyle): string {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const alpha = this.#ctx.stateStack.getAlpha()
    return `${t.a},${t.b},${t.c},${t.d},${t.e},${t.f}|${alpha}|${style.color}|${style.width}|${style.join}|${style.cap}|${style.miterLimit}|${style.closed}`
  }

  /**
   * Move the instances the runs from `firstRun` on were just packed into out of
   * the ring and into a buffer the cache keeps, and draw from it from now on.
   */
  #keepStroke(key: string, firstRun: number): void {
    const ctx = this.#ctx
    ctx.closeRun()
    const end = ctx.runCount
    if (end === firstRun) return
    let start = Infinity
    let stop = -Infinity
    for (let i = firstRun; i < end; i++) {
      const run = ctx.runAt(i)
      if (run.kind !== 'stroke' || run.instances) return
      start = Math.min(start, run.startWord)
      stop = Math.max(stop, run.endWord)
    }
    if (!(stop > start)) return
    const bounds = new Float64Array(4)
    if (!this.#stroke.runBounds(ctx.runAt(firstRun), bounds)) return
    const entry = this.#stroke.keep(
      key,
      this.#stroke.stream.floatView.subarray(start, stop),
      bounds,
    )
    for (let i = firstRun; i < end; i++) {
      const run = ctx.runAt(i)
      run.startWord -= start
      run.endWord -= start
      run.instances = { buffer: entry.buffer, bounds }
    }
  }

  strokePath2D(path: Path2D, style: GfxStrokeStyle): void {
    const contours = getPathContours(path)
    if (!contours) {
      // No cached contours for this Path2D. Callers that construct
      // Path2Ds outside SvgPathMap must call `registerPathTessellation`,
      // which also stashes contours.
      this.#unimplemented.strokePath2D++
      return
    }
    if (this.needsOutline(style)) {
      for (let i = 0; i < contours.length; i++) {
        const c = contours[i]
        if (c.length / 2 < 2) continue
        this.#strokeOutlineCached(path, i, c, getContourClosed(path, i), style)
      }
      return
    }
    // Total across every contour, counted first: the whole path is one stroke
    // and so one stencil group, and a path holding a single segment needs no
    // group at all.
    let segments = 0
    for (let i = 0; i < contours.length; i++) {
      const count = contours[i].length / 2
      if (count < 2) continue
      segments += getContourClosed(path, i) ? count : count - 1
    }
    const solidStyle = style as SolidStrokeStyle
    const stencil = this.strokeNeedsStencil(solidStyle, segments)
    // A registered path's points change only with a new registration, so the
    // path and its epoch identify them.
    this.#strokeRetained(
      path,
      `path${getRegistrationEpoch(path)}`,
      segments,
      solidStyle,
      stencil,
      () => {
        for (let i = 0; i < contours.length; i++) {
          const c = contours[i]
          const count = c.length / 2
          if (count < 2) continue
          const closed = getContourClosed(path, i)
          const perContourStyle: SolidStrokeStyle = { ...solidStyle, closed }
          this.#stroke.polyline(this.#ctx, c, count, perContourStyle)
        }
      },
    )
  }
}
