// Post effects run over offscreen surfaces for `Gfx2D.beginOffscreen`, and the
// kept renders of cached layers.
//
// `GpuGfx` prepares a job when a surface opens, queues it when the surface
// ends, and runs it once the surface's pass has closed.

import type { GfxSurfaceCache, GfxSurfaceEffects } from './Gfx2D'
import type { ColorFormat, GfxDevice, RenderTarget } from './GfxDevice'
import type { Surface } from './OffscreenSurfaces'
import {
  RetainedCache,
  type RetainedCacheStats,
  type RetainedEntry,
} from './RetainedCache'
import { RenderTargetPool } from './RenderTargetPool'
import { copySignature, signaturesEqual } from '../layer/LayerSignature'
import { PostChain } from '../postfx/PostChain'
import {
  UNPLACED,
  type PostEffect,
  type PostPlacement,
} from '../postfx/PostEffect'
import {
  PASS_GPU_GRACE_FRAMES,
  PostProgramCache,
} from '../postfx/PostProgramCache'

/**
 * Effects to run over an offscreen surface, from `beginOffscreen` until the
 * surface's pass closes.
 */
export interface SurfaceEffectsJob {
  chain: PostChain
  effects: readonly PostEffect[]
  /** Where the chain writes, a target the composite then samples. */
  out: RenderTarget | null
  /**
   * The cache entry the result is kept in, for a cached layer. It is valid once
   * the chain has run, and then holds `signature` and the region.
   */
  entry: LayerCacheEntry | null
  signature: Float64Array | null
  signatureLength: number
  x: number
  y: number
  /** Where the surface sits, for the passes' context. */
  placement: PostPlacement
}

/**
 * Where a surface at (`x0`, `y0`) sits, given its owner's local space in device
 * pixels. Without `units`, one local unit is one device pixel and the origin is
 * the surface's own corner.
 */
export function placementOf(
  units: GfxSurfaceEffects['units'],
  x0: number,
  y0: number,
): PostPlacement {
  if (!units) return { ...UNPLACED, originX: x0, originY: y0 }
  return {
    originX: x0,
    originY: y0,
    pxPerUnit: Math.hypot(units.a, units.b),
    unitOriginX: units.e - x0,
    unitOriginY: units.f - y0,
  }
}

/**
 * The kept render of a cached layer: the processed result and what it was made
 * from. The target is the entry's own for as long as the region keeps its
 * size.
 */
export interface LayerCacheEntry extends RetainedEntry {
  out: RenderTarget
  /** Where the region sat in the target, and its size. */
  x: number
  y: number
  w: number
  h: number
  colorSpace: ColorFormat
  /** The signature of what was drawn, valid up to `signatureLength`. */
  signature: Float64Array
  signatureLength: number
  /** Whether `out` holds a finished render of `signature`. */
  valid: boolean
}

/**
 * The state surface effects need on one device: the compiled passes shared by
 * every chain, a pool for the chains' targets, and a chain per owner.
 */
interface EffectState {
  programs: PostProgramCache
  pool: RenderTargetPool
  chains: Map<object, { chain: PostChain; unseen: number }>
  /** The kept renders of cached layers, one per layer. */
  layers: RetainedCache<LayerCacheEntry>
  /** Cached layers drawn from their kept render this frame. */
  layerHits: number
}

/** Whether the first enabled effect removes fine detail from its input. */
export function firstEffectSmooths(effects: readonly PostEffect[]): boolean {
  for (const effect of effects) {
    if (effect.enabled) return effect.smoothsInput === true
  }
  return false
}

export class SurfaceEffects {
  readonly #device: GfxDevice
  /** Surface effects state, created on first use and dropped on a restore. */
  #state: EffectState | null = null
  /** Effects waiting for their surface's pass to close, by surface. */
  readonly #jobs = new Map<Surface, SurfaceEffectsJob>()

  constructor(device: GfxDevice) {
    this.#device = device
  }

  /** Whether a surface effect's pipeline is still compiling. */
  get compiling(): boolean {
    return this.#state?.programs.compiling ?? false
  }

  /** Resolves once the pipelines compiling now have finished. */
  whenCompiled(): Promise<void> {
    return this.#state?.programs.whenCompiled() ?? Promise.resolve()
  }

  /** Forget everything, after a context restore. */
  reset(): void {
    // Anything the effects held lived on the old context.
    this.#state?.layers.clear(false)
    this.#state = null
    this.#jobs.clear()
  }

  /** Start of frame: age the kept layer renders and reset the hit count. */
  beginFrame(frameNo: number): void {
    const state = this.#state
    if (!state) return
    state.layers.sweep(frameNo)
    state.layerHits = 0
  }

  /** The surface effects state, created on first use. */
  #effectState(): EffectState {
    return (this.#state ??= {
      programs: new PostProgramCache(this.#device),
      pool: new RenderTargetPool(this.#device),
      chains: new Map(),
      layers: new RetainedCache<LayerCacheEntry>({
        name: 'Layer renders',
        idleFrames: 240,
        budgetBytes: 64 * 1024 * 1024,
      }),
      layerHits: 0,
    })
  }

  /**
   * Get ready to run `fx` over a surface: find or create the owner's chain, add
   * the frame's time, and make sure the pipelines are compiled for
   * `colorSpace`. Reports whether they are, in `fx.applied`. Returns the job
   * for the surface, or `null` when a pipeline is still compiling and the
   * surface composites as it is.
   */
  prepare(
    fx: GfxSurfaceEffects,
    colorSpace: ColorFormat,
  ): SurfaceEffectsJob | null {
    const state = this.#effectState()
    let entry = state.chains.get(fx.owner)
    if (!entry) {
      entry = {
        chain: new PostChain(this.#device, state.programs, state.pool),
        unseen: 0,
      }
      state.chains.set(fx.owner, entry)
    }
    entry.unseen = 0
    entry.chain.advance(fx.dt)
    const ready = entry.chain.prepare(fx.effects, colorSpace)
    for (const effect of fx.effects) {
      for (const pass of effect.passes) state.programs.noteLive(pass)
    }
    fx.applied = ready
    return ready
      ? {
          chain: entry.chain,
          effects: fx.effects,
          out: null,
          entry: null,
          signature: null,
          signatureLength: 0,
          x: 0,
          y: 0,
          placement: { ...UNPLACED },
        }
      : null
  }

  /**
   * Decide whether the kept render of a cached layer still stands. Returns it
   * when it does, with `cache.hit` set. Otherwise gets the layer's entry ready
   * to be drawn into (a new target when the region changed size) and records
   * the signature to keep once the render has run, and returns `null`. Only
   * called with a job from {@link prepare}.
   */
  checkLayerCache(
    fx: GfxSurfaceEffects,
    cache: GfxSurfaceCache,
    job: SurfaceEffectsJob,
    colorSpace: ColorFormat,
    x: number,
    y: number,
    w: number,
    h: number,
  ): LayerCacheEntry | null {
    const state = this.#state!
    // Asked every frame, even when the answer is a hit, so the effects' own
    // record of what they last wrote stays current.
    const paramsChanged = job.chain.paramsChanged(
      { width: w, height: h, placement: job.placement },
      fx.effects,
    )
    const key = state.layers.keyFor(fx.owner, 'layer')
    let entry = state.layers.get(key)
    const forced = cache.invalidated
    cache.invalidated = false
    if (
      entry &&
      entry.valid &&
      !forced &&
      !paramsChanged &&
      entry.colorSpace === colorSpace &&
      entry.x === x &&
      entry.y === y &&
      entry.w === w &&
      entry.h === h &&
      signaturesEqual(
        entry.signature,
        entry.signatureLength,
        cache.signature,
        cache.length,
      )
    ) {
      cache.hit = true
      state.layerHits++
      return entry
    }
    if (
      !entry ||
      entry.w !== w ||
      entry.h !== h ||
      entry.colorSpace !== colorSpace
    ) {
      const pool = state.pool
      const out = pool.acquireRetained(w, h, colorSpace)
      entry = {
        out,
        x,
        y,
        w,
        h,
        colorSpace,
        signature: new Float64Array(0),
        signatureLength: 0,
        valid: false,
        bytes: w * h * 4,
        release: () => pool.release(out),
      }
      // Replaces, and frees, the entry of the old size.
      state.layers.add(key, entry)
    }
    entry.valid = false
    job.entry = entry
    job.signature = copySignature(
      cache.signature,
      cache.length,
      new Float64Array(cache.length),
    )
    job.signatureLength = cache.length
    return null
  }

  /**
   * Queue `job` to run when `surface`'s pass closes, and return the target it
   * will write. A cached layer writes the target it keeps.
   */
  queue(
    surface: Surface,
    job: SurfaceEffectsJob,
    colorSpace: ColorFormat,
  ): RenderTarget {
    const out =
      job.entry?.out ??
      this.#state!.pool.acquireTransient(surface.w, surface.h, colorSpace)
    job.out = out
    this.#jobs.set(surface, job)
    return out
  }

  /**
   * Run the effects queued for `surface`, now that its pass has closed and its
   * result texture is complete. They draw between that pass and the next one.
   * Returns the number of passes run.
   */
  run(surface: Surface, colorSpace: ColorFormat): number {
    const job = this.#jobs.get(surface)
    if (!job) return 0
    this.#jobs.delete(surface)
    job.chain.run(
      {
        texture: surface.tex,
        width: surface.w,
        height: surface.h,
        placement: job.placement,
      },
      job.effects,
      colorSpace,
      job.out,
    )
    const entry = job.entry
    if (entry && job.signature) {
      // The kept target now holds a finished render of this signature.
      entry.x = job.x
      entry.y = job.y
      entry.signature = copySignature(
        job.signature,
        job.signatureLength,
        entry.signature,
      )
      entry.signatureLength = job.signatureLength
      entry.valid = true
    }
    return PostChain.passCount(job.effects)
  }

  /** Compile the pipelines of `fx` ahead of time, for `colorSpace`. */
  warm(fx: GfxSurfaceEffects, colorSpace: ColorFormat): void {
    const state = this.#effectState()
    const passes = fx.effects.flatMap((e) => e.passes)
    state.programs.warm(passes, [colorSpace])
  }

  /**
   * End of frame: return the pooled targets, free the passes and chains no
   * layer has used for a while.
   */
  endFrame(): void {
    const state = this.#state
    if (!state) return
    state.pool.endFrame()
    state.programs.endFrame()
    for (const [owner, entry] of state.chains) {
      if (++entry.unseen <= PASS_GPU_GRACE_FRAMES) continue
      entry.chain.destroy()
      state.chains.delete(owner)
    }
  }

  /** What the kept layer renders hold, `null` before any layer used effects. */
  layerStats(): RetainedCacheStats | null {
    const state = this.#state
    // A lookup that ends in a re-render is not a hit, so the count is the
    // layers drawn from their kept render.
    return state ? { ...state.layers.stats, hits: state.layerHits } : null
  }
}
