// A device-scoped pool of render targets, reused by whichever feature needs
// scratch offscreen targets: `PostProcessPipeline`'s ping-pong buffers and
// `PathShadowCache`'s mask bake. Each owns its own instance; the pool class is
// shared code, not a shared pool, since the two have different lifetimes to
// manage (see the two acquire methods below).

import type {
  ColorFormat,
  GfxDevice,
  RenderTarget,
  TargetPixelFormat,
} from './GfxDevice'
import { StargazerError } from '../../diagnostics/StargazerError'

function poolKey(
  w: number,
  h: number,
  colorSpace: ColorFormat,
  pixelFormat: TargetPixelFormat,
  samples: number,
): string {
  return `${w}x${h}:${colorSpace}:${pixelFormat}:${samples}`
}

interface PoolEntry {
  key: string
  rt: RenderTarget
  /** Transient only: claimed by an `acquireTransient` not yet released. */
  inUse: boolean
  /** Lives until its single `release`, never reused by key. */
  retained: boolean
}

/**
 * A render-target pool with two lifetimes. `acquireTransient` targets are
 * reused across calls by (size, color space, pixel format, samples) and freed
 * automatically by {@link RenderTargetPool.endFrame} once a frame stops asking
 * for a given key, the shape `PostProcessPipeline`'s ping-pong buffers want.
 * `acquireRetained` targets live until explicitly
 * {@link RenderTargetPool.release}d, the shape a cache (a path-shadow mask)
 * wants: `endFrame` never touches them.
 *
 * A double release, or a release of a target this pool didn't hand out, throws
 * rather than silently no-opping: a silent no-op would hide the exact aliasing
 * bug this split exists to prevent (recycling a target a still-live reference
 * points at).
 *
 * @remarks
 *   Maintainers: the path-shadow bake takes its raster and its middle blur target
 *   as transient targets and releases them as soon as the bake ends. Those
 *   targets stay pooled until a frame passes with no request for their size.
 *   The final mask is retained and released by the cache when it evicts the
 *   entry. Pool keys include the pixel format, so mask targets never share an
 *   entry with color targets.
 */
export class RenderTargetPool {
  readonly #device: GfxDevice
  readonly #entries: PoolEntry[] = []
  readonly #usedKeysThisFrame = new Set<string>()
  /** Cumulative since startup, for the debug HUD. */
  #hits = 0
  #misses = 0

  constructor(device: GfxDevice) {
    this.#device = device
  }

  /** `acquireTransient` calls that reused an existing target, since startup. */
  get hits(): number {
    return this.#hits
  }
  /** `acquireTransient` calls that allocated a new target, since startup. */
  get misses(): number {
    return this.#misses
  }

  /**
   * A scratch target reused by key. Claimed until
   * {@link RenderTargetPool.release}, which returns it to the pool rather than
   * deleting it; {@link RenderTargetPool.endFrame} deletes a key's targets once
   * nothing asked for it in the frame just finished.
   */
  acquireTransient(
    w: number,
    h: number,
    colorSpace: ColorFormat = 'linear',
    pixelFormat: TargetPixelFormat = 'rgba8',
    samples = 1,
  ): RenderTarget {
    const key = poolKey(w, h, colorSpace, pixelFormat, samples)
    this.#usedKeysThisFrame.add(key)
    for (const e of this.#entries) {
      if (!e.retained && !e.inUse && e.key === key) {
        e.inUse = true
        this.#hits++
        return e.rt
      }
    }
    this.#misses++
    const rt = this.#device.createRenderTarget({
      width: w,
      height: h,
      samples,
      colorSpace,
      pixelFormat,
    })
    this.#entries.push({ key, rt, inUse: true, retained: false })
    return rt
  }

  /**
   * A target with its own lifetime, independent of any frame boundary. Always
   * allocates (never reused by key, since a retained target's content is what
   * makes it worth keeping). Release it when done.
   */
  acquireRetained(
    w: number,
    h: number,
    colorSpace: ColorFormat = 'linear',
    pixelFormat: TargetPixelFormat = 'rgba8',
    samples = 1,
  ): RenderTarget {
    const key = poolKey(w, h, colorSpace, pixelFormat, samples)
    const rt = this.#device.createRenderTarget({
      width: w,
      height: h,
      samples,
      colorSpace,
      pixelFormat,
    })
    this.#entries.push({ key, rt, inUse: true, retained: true })
    return rt
  }

  /**
   * Release a target. A transient target returns to the pool, available to the
   * next `acquireTransient` for the same key. A retained target is deleted.
   */
  release(rt: RenderTarget): void {
    const i = this.#entries.findIndex((e) => e.rt === rt)
    if (i < 0) {
      throw new StargazerError(
        'SG2024',

        'RenderTargetPool.release: target not tracked by this pool (double release, or a target from a different pool)',
      )
    }
    const e = this.#entries[i]
    if (e.retained) {
      this.#device.deleteRenderTarget(e.rt)
      this.#entries.splice(i, 1)
      return
    }
    if (!e.inUse) {
      throw new StargazerError(
        'SG5009',
        'RenderTargetPool.release: target already released',
      )
    }
    e.inUse = false
  }

  /**
   * Frame-end call, driven by the owner (`PostProcessPipeline`'s `run`, or
   * `Stage` for a `PathShadowCache`'s pool): deletes any transient target whose
   * key nothing asked for since the last call, and clears every transient
   * target's claim. Retained targets are untouched; they have no frame-scoped
   * lifetime.
   */
  endFrame(): void {
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      const e = this.#entries[i]
      if (e.retained) continue
      e.inUse = false
      if (!this.#usedKeysThisFrame.has(e.key)) {
        this.#device.deleteRenderTarget(e.rt)
        this.#entries.splice(i, 1)
      }
    }
    this.#usedKeysThisFrame.clear()
  }

  /** Delete every target the pool holds, transient or retained. */
  destroy(): void {
    for (const e of this.#entries) this.#device.deleteRenderTarget(e.rt)
    this.#entries.length = 0
    this.#usedKeysThisFrame.clear()
  }
}
