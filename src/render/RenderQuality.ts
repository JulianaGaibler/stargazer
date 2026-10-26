import { VectorQuality, type VectorQualityOptions } from './VectorQuality'

/** Supported shadow-map edge sizes, in pixels. */
export const SHADOW_MAP_SIZES = [256, 512, 1024, 2048, 4096] as const
/** Supported PCF tap counts (shadow-edge softness). 1 is hard. */
export const SHADOW_SOFTNESS_TAPS = [1, 4, 9, 16] as const

/** Construction overrides for {@link RenderQuality}. */
export interface RenderQualityOptions {
  shadowMapSize?: number
  meshShadowsEnabled?: boolean
  anisotropy?: number
  shadowSoftness?: number
  adaptive?: boolean
  vector?: VectorQualityOptions
}

function nearestAllowed(value: number, allowed: readonly number[]): number {
  let best = allowed[0]
  for (const a of allowed) {
    if (Math.abs(a - value) < Math.abs(best - value)) best = a
  }
  return best
}

/**
 * Live rendering-quality settings for the 3D pass. One instance lives on the
 * engine, as `engine.quality`. The renderer reads it each frame, so changes
 * take effect immediately. Setters clamp to supported values.
 *
 * @example
 *   engine.quality.shadowMapSize = 2048 // sharper shadows
 *   engine.quality.meshShadowsEnabled = false // drop shadows on a weak GPU
 */
export class RenderQuality {
  #shadowMapSize = 1024
  #meshShadowsEnabled = true
  #anisotropy = 8
  #shadowSoftness = 4
  #revision = 0
  /**
   * Whether the engine lowers quality when the GPU cannot keep up, a tier at a
   * time: ambient occlusion resolution and preset, MSAA, shadow softness, the
   * render scale, and last ambient occlusion and shadows off. Default true. It
   * only steps down, so a caller that wants a fixed quality sets this to
   * false.
   *
   * @remarks
   *   The engine measures the frame interval and the CPU time of each frame over
   *   about 1.5 seconds. When the median interval is above 37 ms and the CPU
   *   time is under half of it, the GPU is the bottleneck and the engine takes
   *   one tier. A median above 74 ms takes half of the tiers left. It waits one
   *   second after each change before it measures again. With a frame cap, a
   *   frame is slow when it takes longer than 1.3 times the cap's interval.
   *
   *   The tiers run in this order: ambient occlusion at half resolution, MSAA 2x,
   *   ambient occlusion preset `low`, MSAA 1x, shadow softness 4 taps, render
   *   scale 0.85 and then 0.75, shadow softness 1 tap, render scale 0.6,
   *   ambient occlusion off, shadows off, render scale 0.5. A tier that would
   *   change nothing is skipped. A 2D scene only goes through MSAA and the
   *   render scale, WebGPU has no 2x MSAA, and a setting held with
   *   `QualityControl` stays where it is.
   */
  adaptive = true
  /** 2D vector-renderer quality: path drop shadows and gradient dithering. */
  readonly vector: VectorQuality

  constructor(opts: RenderQualityOptions = {}) {
    if (opts.shadowMapSize !== undefined)
      this.shadowMapSize = opts.shadowMapSize
    if (opts.meshShadowsEnabled !== undefined)
      this.meshShadowsEnabled = opts.meshShadowsEnabled
    if (opts.anisotropy !== undefined) this.anisotropy = opts.anisotropy
    if (opts.adaptive !== undefined) this.adaptive = opts.adaptive
    if (opts.shadowSoftness !== undefined)
      this.shadowSoftness = opts.shadowSoftness
    this.vector = new VectorQuality(opts.vector)
    this.#revision = 0
  }

  /**
   * Bumped whenever a setting changes. Nothing in the renderer reads this:
   * `MeshRenderer` rebuilds its shadow map by comparing the resolved size
   * against its own cached value instead. Kept for a consumer that wants to
   * detect "something changed" without diffing every field, not as a signal the
   * engine itself watches.
   */
  get revision(): number {
    return this.#revision
  }

  /** Shadow-map edge size in pixels (snapped to {@link SHADOW_MAP_SIZES}). */
  get shadowMapSize(): number {
    return this.#shadowMapSize
  }
  set shadowMapSize(v: number) {
    const snapped = nearestAllowed(v, SHADOW_MAP_SIZES)
    if (snapped !== this.#shadowMapSize) {
      this.#shadowMapSize = snapped
      this.#revision++
    }
  }

  /**
   * Master switch for the shadow passes (per-light `shadowEnabled` still gates
   * individually).
   */
  get meshShadowsEnabled(): boolean {
    return this.#meshShadowsEnabled
  }
  set meshShadowsEnabled(v: boolean) {
    if (v !== this.#meshShadowsEnabled) {
      this.#meshShadowsEnabled = v
      this.#revision++
    }
  }

  /** Anisotropic-filtering level for glTF textures (clamped to `1..16`). */
  get anisotropy(): number {
    return this.#anisotropy
  }
  set anisotropy(v: number) {
    const clamped = Math.max(1, Math.min(16, Math.round(v)))
    if (clamped !== this.#anisotropy) {
      this.#anisotropy = clamped
      this.#revision++
    }
  }

  /**
   * Shadow PCF tap count (snapped to {@link SHADOW_SOFTNESS_TAPS}). 1 is hard
   * edges.
   */
  get shadowSoftness(): number {
    return this.#shadowSoftness
  }
  set shadowSoftness(v: number) {
    const snapped = nearestAllowed(v, SHADOW_SOFTNESS_TAPS)
    if (snapped !== this.#shadowSoftness) {
      this.#shadowSoftness = snapped
      this.#revision++
    }
  }
}
