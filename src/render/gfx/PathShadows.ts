// Drop shadows for arbitrary paths: blurred coverage masks baked ahead of the
// frame that draws them, and the queues that feed the bakes.
//
// `GpuGfx` hands each `shadowPath2D` here and drains the bakes before the next
// frame begins.

import type { Gfx2D, GfxShadowStyle } from './Gfx2D'
import type { GfxDevice } from './GfxDevice'
import type { GeometryHandle } from './GeometryHandle'
import type { GpuBatchContext, ResolvedMaskPaint } from './GpuBatchContext'
import {
  getPathTessellation,
  getRegistrationEpoch,
} from './PathTessellationRegistry'
import {
  PathShadowCache,
  HARD_SHADOW_BLUR_PX,
  insetMaskProjection,
  type PathShadowRequest,
} from './PathShadowCache'
import { packColor } from './packing'
import type { ColoredTriProgram } from './programs/coloredTri'
import type { PathShadowCompositeProgram } from './programs/pathShadowComposite'
import type { Rect } from '../../math/Rect'
import type { UnimplementedCounts } from './GpuGfx'

/**
 * Fewest indices a gradient or masked fill has before its tessellation is worth
 * keeping on the GPU between frames.
 */
export const RETAIN_FILL_INDICES = 64

/** What path shadows need from the `GpuGfx` that owns them. */
export interface PathShadowHost {
  ctx: GpuBatchContext
  coloredTri: ColoredTriProgram
  composite: PathShadowCompositeProgram
  unimplemented: UnimplementedCounts
  /** The `Gfx2D` calls a hard shadow is drawn with. */
  gfx: Pick<Gfx2D, 'save' | 'restore' | 'translate' | 'fillPath2D'>
  canDrawRetained(geo: GeometryHandle, ownRun: boolean): boolean
}

/**
 * Draws path shadows and queues the bakes they need.
 *
 * @remarks
 *   Maintainers: `shadowPath2D` runs inside the main render pass, and a device
 *   has one open pass per command encoder. It can only peek at the cache and
 *   queue a request on a miss. `processPendingShadowBakes` drains the queue
 *   before `Stage.render` calls `beginFrame`, which is why a bake lands one
 *   frame after the draw that asked for it. It runs on every rendered frame,
 *   because a pure 2D stage skips the 3D pre-passes that share that window.
 *
 *   While a mask is missing, a nearby mask stands in. With none, an outset shadow
 *   draws the hard silhouette and an inset shadow draws nothing. A blur at or
 *   below `HARD_SHADOW_BLUR_PX` skips the cache and takes the same path.
 */
export class PathShadows {
  readonly #ctx: GpuBatchContext
  readonly #coloredTri: ColoredTriProgram
  readonly #pathShadowComposite: PathShadowCompositeProgram
  readonly #unimplemented: UnimplementedCounts
  readonly #gfx: PathShadowHost['gfx']
  readonly #canDrawRetained: PathShadowHost['canDrawRetained']

  /**
   * Cached blurred-coverage masks for arbitrary-path drop shadows. Unlike the
   * other programs, not re-warmed on retarget: its raster/blur targets are its
   * own private r8/rg8 targets, independent of the screen target's format,
   * depth, stencil, or sample count.
   */
  #cache!: PathShadowCache
  readonly #pathBoundsCache = new WeakMap<
    Path2D,
    { epoch: number; bounds: Rect }
  >()
  /**
   * This frame's distinct (path, style, scale-bucket) requests that missed the
   * cache, drained by `processPendingShadowBakes` in next frame's
   * pre-`beginFrame` window.
   */
  readonly #pendingShadowBakes = new Map<string, PathShadowRequest>()
  /**
   * Multiples of its own device scale that the next drawn frame's path shadows
   * also bake a mask for, and the requests collecting them produced. See
   * `warmPathShadows`.
   */
  #shadowWarmFactors: readonly number[] = []
  readonly #shadowWarmups = new Map<string, PathShadowRequest>()

  constructor(host: PathShadowHost) {
    this.#ctx = host.ctx
    this.#coloredTri = host.coloredTri
    this.#pathShadowComposite = host.composite
    this.#unimplemented = host.unimplemented
    this.#gfx = host.gfx
    this.#canDrawRetained = (geo, ownRun) => host.canDrawRetained(geo, ownRun)
  }

  /** The mask cache, for stats and the debug inspector. */
  get cache(): PathShadowCache {
    return this.#cache
  }

  /** Build the mask cache on a fresh context. */
  reset(device: GfxDevice, onWarmupError: (err: unknown) => void): void {
    this.#cache = new PathShadowCache(device)
    this.#cache.warmup().catch(onWarmupError)
  }

  /** Stop collecting warm-ups, once the frame that asked for them has drawn. */
  endCollecting(): void {
    this.#shadowWarmFactors = []
  }

  /** Local-space AABB of `path`'s tessellation, cached per registration epoch. */
  #localBoundsFor(
    path: Path2D,
    geo: { vertices: Float32Array },
    epoch: number,
  ): Rect {
    const cached = this.#pathBoundsCache.get(path)
    if (cached && cached.epoch === epoch) return cached.bounds
    const v = geo.vertices
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (let i = 0; i < v.length; i += 2) {
      const x = v[i]
      const y = v[i + 1]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const bounds: Rect =
      v.length === 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    this.#pathBoundsCache.set(path, { epoch, bounds })
    return bounds
  }

  /** The path's own fill, translated by the shadow's offset, no blur. */
  #hardPathShadow(path: Path2D, style: GfxShadowStyle): void {
    this.#gfx.save()
    this.#gfx.translate(style.offsetX ?? 0, style.offsetY ?? 0)
    this.#gfx.fillPath2D(path, style.color)
    this.#gfx.restore()
  }

  shadowPath2D(path: Path2D, style: GfxShadowStyle): void {
    const geo = getPathTessellation(path)
    if (!geo) {
      this.#unimplemented.shadowPath2D++
      return
    }
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const scaleX = Math.hypot(t.a, t.b)
    const scaleY = Math.hypot(t.c, t.d)
    const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1e-4
    const blur = Math.max(0, style.blur ?? 0)
    const sigmaDevice = blur * 0.5 * scale
    const inset = style.inset === true

    if (sigmaDevice * 2 <= HARD_SHADOW_BLUR_PX) {
      if (!inset) this.#hardPathShadow(path, style)
      return
    }

    const epoch = getRegistrationEpoch(path)
    const req: PathShadowRequest = {
      path,
      geometry: geo,
      localBounds: this.#localBoundsFor(path, geo, epoch),
      registrationEpoch: epoch,
      blur,
      spread: style.spread ?? 0,
      scaleX,
      scaleY,
      scale,
      quality: this.#ctx.vectorQuality,
    }
    const mask = this.#cache.peek(req)
    // A substitute mask gets drawn but still queues the bake, otherwise a
    // stand-in is never replaced by the mask this request actually asked for.
    if (!mask || !mask.exact) {
      this.#pendingShadowBakes.set(this.#cache.requestKey(req), req)
    }
    if (this.#shadowWarmFactors.length > 0) this.#collectShadowWarmups(req)
    if (!mask) {
      if (!inset) {
        this.#unimplemented.pathShadowFallback++
        this.#hardPathShadow(path, style)
      }
      return
    }

    const alpha = this.#ctx.stateStack.getAlpha()
    const offsetX = style.offsetX ?? 0
    const offsetY = style.offsetY ?? 0
    const offDx = t.a * offsetX + t.c * offsetY
    const offDy = t.b * offsetX + t.d * offsetY

    if (inset) {
      const maskPaint: ResolvedMaskPaint = {
        ...insetMaskProjection(t, offDx, offDy, mask),
        kind: 'mask',
        maskTex: mask.texture,
      }
      // Each path's mask is its own texture, so an inset shadow is a run of
      // its own.
      if (
        this.#canDrawRetained(geo, geo.indices.length >= RETAIN_FILL_INDICES)
      ) {
        this.#coloredTri.fillTessellationInsetShadowRetained(
          this.#ctx,
          geo,
          style.color,
          alpha,
          maskPaint,
        )
      } else {
        this.#coloredTri.fillTessellationInsetShadow(
          this.#ctx,
          geo,
          style.color,
          alpha,
          maskPaint,
        )
      }
      return
    }

    const col0x = t.a * mask.localW
    const col0y = t.b * mask.localW
    const col1x = t.c * mask.localH
    const col1y = t.d * mask.localH
    const tx = t.a * mask.localX + t.c * mask.localY + t.e + offDx
    const ty = t.b * mask.localX + t.d * mask.localY + t.f + offDy
    const off = this.#pathShadowComposite.beginInstance(this.#ctx, mask.texture)
    if (off < 0) return
    const slot = this.#ctx.curSlot
    const f = this.#pathShadowComposite.floatView
    const u = this.#pathShadowComposite.uintView
    f[off + 0] = col0x
    f[off + 1] = col0y
    f[off + 2] = col1x
    f[off + 3] = col1y
    f[off + 4] = tx
    f[off + 5] = ty
    f[off + 6] = 0
    f[off + 7] = 0
    f[off + 8] = 1
    f[off + 9] = 1
    u[off + 10] = packColor(style.color, alpha)
    f[off + 11] =
      this.#ctx.stateStack.getBlend() !== 'lighter' &&
      this.#ctx.vectorQuality.dither
        ? 1
        : 0
    this.#pathShadowComposite.commitInstance(slot)
  }

  /**
   * Bake the masks the next drawn frame's path shadows would need at other
   * device scales, so a camera that reaches one of them finds them cached
   * instead of baking a few per frame as it arrives.
   *
   * `factors` are multiples of each shadow's own current device scale, which is
   * one number per target framing however each shadow's own transform differs:
   * pass `2` for a camera about to zoom to twice the scale it is at now. Only
   * the half-octave scale bucket of the product is keyed, so a factor landing
   * inside the current bucket warms nothing.
   *
   * Collection runs once, on the next frame that draws. Those requests then
   * bake behind that frame's own, as many per frame as the bake budget allows,
   * and `pendingPathShadowWarmups` reports what is left. Warming is best effort
   * in two ways: no draw has asked for a warmed mask, so it is also the first
   * entry evicted when live masks need the byte budget, and a shadow small
   * enough to draw as a hard silhouette at the current scale asks the cache for
   * nothing and so warms nothing.
   *
   * @example
   *   // A tap is about to zoom the map in. Bake what that framing needs now.
   *   stage.warmPathShadows([playScale / idleScale])
   */
  warmPathShadows(factors: readonly number[]): void {
    this.#shadowWarmFactors = factors.filter((f) => f > 0)
  }

  /** Warm-up bake requests still waiting on the per-frame bake budget. */
  get pendingPathShadowWarmups(): number {
    return this.#shadowWarmups.size
  }

  /**
   * Queue `req` again at each warm factor's device scale. Blur and spread stay
   * in local units, so a warm request differs from the live one only in its
   * scale bucket, which is exactly what a camera zoom changes.
   */
  #collectShadowWarmups(req: PathShadowRequest): void {
    const liveKey = this.#cache.requestKey(req)
    for (const factor of this.#shadowWarmFactors) {
      const warm: PathShadowRequest = {
        ...req,
        scaleX: req.scaleX * factor,
        scaleY: req.scaleY * factor,
        scale: req.scale * factor,
      }
      const key = this.#cache.requestKey(warm)
      if (key !== liveKey) this.#shadowWarmups.set(key, warm)
    }
  }

  /**
   * Drain this frame's queued path-shadow bake requests. Must run outside any
   * open render pass (the bake opens and closes its own), so callers run it in
   * the pre-`beginFrame` window, which `Stage` runs before
   * `screen.beginFrame()`. A request queued this way bakes at the earliest in
   * the FOLLOWING frame's draw, one frame behind the draw call that queued it.
   * `shadowPath2D` draws a substitute mask or the hard fallback in the
   * meantime.
   *
   * @remarks
   *   Maintainers: the cache also opens its frame here. That resets the bake work
   *   budget and the uniform rings, which the previous frame's submit has
   *   already consumed.
   */
  processPendingShadowBakes(): void {
    this.#cache.beginFrame()
    if (this.#pendingShadowBakes.size > 0) {
      for (const req of this.#pendingShadowBakes.values()) {
        this.#cache.getOrBake(req)
      }
      this.#pendingShadowBakes.clear()
    }
    // Warm-ups go after the live requests, so the frame on screen converges
    // before a framing nothing has reached yet. The first request the budget
    // turns down ends the drain, which keeps a starved frame from costing a
    // size and kernel estimate per queued request.
    for (const [key, req] of this.#shadowWarmups) {
      if (this.#cache.getOrBake(req)?.exact !== true) break
      this.#shadowWarmups.delete(key)
    }
    this.#cache.pool.endFrame()
  }
}
