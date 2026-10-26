import type {
  GfxBlend,
  GfxMatteMode,
  GfxOffscreenHandle,
  GfxOffscreenOptions,
} from './Gfx2D'
import type { GfxDevice, RenderTarget } from './GfxDevice'
import type { GpuBatchContext, GpuGfxStats, PassHooks } from './GpuBatchContext'
import type { ClipPush, ClipState } from './ClipState'
import type { SurfacePool, Surface } from './OffscreenSurfaces'
import {
  firstEffectSmooths,
  placementOf,
  type SurfaceEffects,
  type SurfaceEffectsJob,
  type LayerCacheEntry,
} from './SurfaceEffects'
import { diagnostics } from '../../diagnostics/Diagnostics'
import { parseColor } from './parseColor'
import { rgbaTuple } from './packing'
import { PostChain } from '../postfx/PostChain'
import type {
  CompositeDraw,
  OffscreenCompositeProgram,
} from './programs/offscreenComposite'

/** The blend modes an offscreen composite supports. */
const COMPOSITE_BLENDS = new Set<string>([
  'source-over',
  'lighter',
  'screen',
  'multiply',
  'destination-out',
  'destination-in',
  'xor',
])

/** The rectangle of a texture a composite draws, a surface or an effects result. */
type CompositeSource = Pick<
  Surface,
  'tex' | 'texW' | 'texH' | 'x' | 'y' | 'w' | 'h'
>

/** An open `beginOffscreen`, kept until its `endOffscreen`. */
interface OffFrame {
  /**
   * The surface being drawn into, `null` for a cached layer drawn from its kept
   * render.
   */
  surface: Surface | null
  /** The kept render composited in place of drawing, for a cache hit. */
  hit: LayerCacheEntry | null
  /** The effects to run over the surface, `null` for a plain surface. */
  fx: SurfaceEffectsJob | null
  alpha: number
  blend: GfxBlend
  retain: boolean
  matte: GfxOffscreenHandle | null
  matteMode: GfxMatteMode
  clipDepth: number
  clipPushes: ClipPush[]
  saveLevel: number
  passSamples: number
}

/** What a `GfxOffscreenHandle` holds. */
interface OffscreenHandle {
  surface: Surface
}

/** What the offscreen stack needs from the `GpuGfx` that owns it. */
export interface OffscreenHost {
  device: GfxDevice
  ctx: GpuBatchContext
  stats: GpuGfxStats
  clip: ClipState
  pool: SurfacePool
  effects: SurfaceEffects
  composite: OffscreenCompositeProgram
  /** The main target, which a resize or retarget replaces. */
  target(): RenderTarget
  targetWidth(): number
  targetHeight(): number
  resolveDestination(): RenderTarget | undefined
  perfMarks(): boolean
}

/**
 * The record-time stack of open offscreen surfaces, the pass hooks that replay
 * them, and the composite that draws a finished surface into its parent.
 */
export class OffscreenStack {
  readonly #host: OffscreenHost
  readonly #device: GfxDevice
  readonly #ctx: GpuBatchContext
  readonly #stats: GpuGfxStats
  readonly #clip: ClipState
  readonly #pool: SurfacePool
  readonly #effects: SurfaceEffects
  readonly #composite: OffscreenCompositeProgram

  /** The main pass's clear colour, set by `beginFrame`. */
  clear: readonly [number, number, number, number] = [0, 0, 0, 0]
  #mainPrelude: (() => void) | null = null
  /** Record-time stack of open `beginOffscreen` calls. */
  readonly #offStack: OffFrame[] = []

  constructor(host: OffscreenHost) {
    this.#host = host
    this.#device = host.device
    this.#ctx = host.ctx
    this.#stats = host.stats
    this.#clip = host.clip
    this.#pool = host.pool
    this.#effects = host.effects
    this.#composite = host.composite
  }

  /**
   * Run `draw` at the start of the main pass, before the recorded layers. It
   * applies to the next submitted frame only.
   */
  setMainPrelude(draw: (() => void) | null): void {
    this.#mainPrelude = draw
  }

  /** Whether any `begin` is still open. */
  get open(): boolean {
    return this.#offStack.length > 0
  }

  /** The summed x origin of the open surfaces, in target pixels. */
  originX(): number {
    let ox = 0
    for (let i = 0; i < this.#offStack.length; i++) {
      ox += this.#offStack[i].surface?.x ?? 0
    }
    return ox
  }

  /** The summed y origin of the open surfaces, in target pixels. */
  originY(): number {
    let oy = 0
    for (let i = 0; i < this.#offStack.length; i++) {
      oy += this.#offStack[i].surface?.y ?? 0
    }
    return oy
  }

  readonly hooks: PassHooks = {
    open: (surface) => {
      if (surface) {
        if (this.#host.perfMarks()) performance.mark('gfx-surface:start')
        const slot = this.#ctx.acquireFrameSlot(surface.texW, surface.texH)
        this.#ctx.useFrameSlot(slot)
        this.#ctx.passSamples = surface.draw.samples
        this.#openSurface(surface)
      } else {
        this.#ctx.useFrameSlot(0)
        this.#ctx.passSamples = this.#host.target().samples
        this.#openMain()
        const prelude = this.#mainPrelude
        this.#mainPrelude = null
        prelude?.()
      }
    },
    close: (surface) => {
      this.#device.endRenderPass()
      if (surface) {
        this.#stats.passCount += this.#effects.run(
          surface,
          this.#host.target().colorSpace,
        )
      }
      if (this.#host.perfMarks() && surface) {
        performance.measure(
          `gfx offscreen surface ${surface.w}x${surface.h}`,
          'gfx-surface:start',
        )
      }
    },
  }

  /** The pixel size of the target currently being recorded into. */
  viewW(): number {
    return this.#topSurface()?.w ?? this.#host.targetWidth()
  }
  viewH(): number {
    return this.#topSurface()?.h ?? this.#host.targetHeight()
  }

  /** The innermost open surface, skipping layers drawn from a kept render. */
  #topSurface(): Surface | null {
    for (let i = this.#offStack.length - 1; i >= 0; i--) {
      const s = this.#offStack[i].surface
      if (s) return s
    }
    return null
  }

  /**
   * Open the main target's pass. It is the frame's only pass over the target,
   * so it resolves multisampled colour and drops everything the next frame does
   * not read.
   */
  #openMain(): void {
    const resolve = this.#host.resolveDestination()
    this.#stats.passCount++
    this.#device.beginRenderPass({
      color: {
        target: this.#host.target(),
        loadOp: 'clear',
        clearColor: this.clear,
        resolveTarget: resolve,
        // The resolve target holds the result, so the multisampled samples
        // never need to reach memory.
        storeOp: resolve ? 'discard' : 'store',
      },
      // Both aspects come off the live target rather than the requested flags,
      // so the pass can never describe an attachment the target does not have.
      depth: this.#host.target().hasDepth
        ? {
            target: { renderTarget: this.#host.target() },
            loadOp: 'clear',
            // Nothing samples the main depth: 2D never tests it and AO draws
            // its own G-buffer.
            storeOp: 'discard',
          }
        : undefined,
      // Only clips and stroke de-duplication read it, and only within the
      // frame.
      stencil: this.#host.target().hasStencil
        ? {
            target: this.#host.target(),
            loadOp: 'clear',
            clearValue: 0,
            storeOp: 'discard',
          }
        : undefined,
    })
  }

  /** Open a surface's pass. It resolves and drops its samples in the same pass. */
  #openSurface(surface: Surface): void {
    const resolve = surface.multisampled ? surface.resolve : undefined
    this.#stats.passCount++
    this.#device.beginRenderPass({
      color: {
        target: surface.draw,
        loadOp: 'clear',
        clearColor: surface.clear,
        resolveTarget: resolve,
        storeOp: resolve ? 'discard' : 'store',
      },
      depth: surface.draw.hasDepth
        ? {
            target: { renderTarget: surface.draw },
            loadOp: 'clear',
            storeOp: 'discard',
          }
        : undefined,
      stencil: surface.draw.hasStencil
        ? {
            target: surface.draw,
            loadOp: 'clear',
            clearValue: 0,
            storeOp: 'discard',
          }
        : undefined,
    })
  }

  begin(opts: GfxOffscreenOptions = {}): boolean {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    let x0 = 0
    let y0 = 0
    let x1 = this.viewW()
    let y1 = this.viewH()
    const b = opts.bounds
    if (b) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (let i = 0; i < 4; i++) {
        const lx = b.x + (i === 1 || i === 2 ? b.width : 0)
        const ly = b.y + (i >= 2 ? b.height : 0)
        const dx = t.a * lx + t.c * ly + t.e
        const dy = t.b * lx + t.d * ly + t.f
        if (dx < minX) minX = dx
        if (dx > maxX) maxX = dx
        if (dy < minY) minY = dy
        if (dy > maxY) maxY = dy
      }
      x0 = Math.max(x0, Math.floor(minX))
      y0 = Math.max(y0, Math.floor(minY))
      x1 = Math.min(x1, Math.ceil(maxX))
      y1 = Math.min(y1, Math.ceil(maxY))
    }
    const w = x1 - x0
    const h = y1 - y0
    if (w <= 0 || h <= 0) return false
    const requested = opts.retain === true ? null : opts.effects
    const fx =
      requested && PostChain.hasWork(requested.effects) ? requested : null
    if (requested?.cache) requested.cache.hit = false
    const job = fx
      ? this.#effects.prepare(fx, this.#host.target().colorSpace)
      : null
    if (job && fx) job.placement = placementOf(fx.units, x0, y0)
    if (opts.effects && !fx) opts.effects.applied = opts.retain !== true
    // A layer that must not show unprocessed is composited invisibly until its
    // pipelines are ready.
    const held = fx !== null && job === null && fx.hold === true
    const alpha = held
      ? 0
      : this.#ctx.stateStack.getAlpha() * (opts.opacity ?? 1)
    const blend = opts.blend ?? this.#ctx.stateStack.getBlend()
    if (job && fx?.cache) {
      const kept = this.#effects.checkLayerCache(
        fx,
        fx.cache,
        job,
        this.#host.target().colorSpace,
        x0,
        y0,
        w,
        h,
      )
      if (kept) {
        // The kept render stands, so nothing is drawn and the composite is the
        // whole cost. The frame only holds the alpha and blend for
        // `endOffscreen`.
        this.#offStack.push({
          surface: null,
          hit: kept,
          fx: null,
          alpha,
          blend,
          retain: false,
          matte: null,
          matteMode: 'alpha',
          clipDepth: this.#ctx.clipDepth,
          clipPushes: [],
          saveLevel: this.#clip.saveLevel,
          passSamples: this.#ctx.passSamples,
        })
        return true
      }
    }
    // Effects position by the size of the texture they read, so the surface is
    // exactly the captured size. A layer whose first effect smooths its input
    // draws single-sample, once every program has pipelines for it.
    let samples = this.#host.target().samples
    if (fx && samples > 1 && firstEffectSmooths(fx.effects)) {
      if (this.#ctx.singleSampleReady) samples = 1
      else this.#ctx.warmSingleSample()
    }
    const surface = this.#pool.acquire(
      w,
      h,
      {
        colorSpace: this.#host.target().colorSpace,
        samples,
        depth: this.#host.target().hasDepth,
        stencil: this.#host.target().hasStencil,
      },
      fx !== null,
    )
    if (opts.clearColor !== undefined) {
      // A surface holds premultiplied color, so a translucent clear is too.
      const c = rgbaTuple(parseColor(opts.clearColor))
      surface.clear = [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]]
    }
    if (job) {
      job.x = x0
      job.y = y0
    }
    surface.x = x0
    surface.y = y0
    surface.w = w
    surface.h = h
    this.#stats.surfaces++
    this.#ctx.pushPassMark('begin', surface)
    // The surface starts from a clean state, in its own pixel space.
    this.#ctx.txStack.push()
    this.#ctx.stateStack.push()
    this.#ctx.txStack.setTop(t.a, t.b, t.c, t.d, t.e - x0, t.f - y0)
    this.#ctx.stateStack.setAlpha(1)
    this.#ctx.stateStack.setBlend('source-over')
    this.#ctx.stateStack.setClip(null)
    this.#ctx.stateStack.setClipMask(null)
    this.#offStack.push({
      surface,
      hit: null,
      fx: job,
      alpha,
      blend,
      retain: opts.retain === true,
      matte: opts.matte ?? null,
      matteMode: opts.matteMode ?? 'alpha',
      clipDepth: this.#ctx.clipDepth,
      clipPushes: this.#clip.pushes.slice(),
      saveLevel: this.#clip.saveLevel,
      passSamples: this.#ctx.passSamples,
    })
    this.#ctx.clipDepth = 0
    this.#ctx.passSamples = samples
    this.#clip.pushes.length = 0
    return true
  }

  end(): GfxOffscreenHandle | null {
    const frame = this.#offStack.pop()
    if (!frame) return null
    const kept = frame.hit
    if (kept) {
      this.#compositeSurface(
        {
          tex: this.#device.colorTexture(kept.out),
          texW: kept.w,
          texH: kept.h,
          x: kept.x,
          y: kept.y,
          w: kept.w,
          h: kept.h,
        },
        frame.alpha,
        frame.blend,
        null,
        'alpha',
      )
      return null
    }
    const s = frame.surface!
    this.#ctx.pushPassMark('end', s)
    this.#ctx.txStack.pop()
    this.#ctx.stateStack.pop()
    this.#ctx.clipDepth = frame.clipDepth
    this.#clip.pushes.length = 0
    this.#clip.pushes.push(...frame.clipPushes)
    this.#clip.saveLevel = frame.saveLevel
    this.#ctx.passSamples = frame.passSamples
    const handle: OffscreenHandle = { surface: s }
    if (frame.retain) return handle as unknown as GfxOffscreenHandle
    const matteHandle = frame.matte as unknown as OffscreenHandle | null
    let source: CompositeSource = s
    const job = frame.fx
    if (job) {
      // The effects run when the surface's pass closes and write `out`, which
      // the composite then draws in place of the surface.
      const out = this.#effects.queue(s, job, this.#host.target().colorSpace)
      source = {
        tex: this.#device.colorTexture(out),
        texW: s.w,
        texH: s.h,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
      }
    }
    this.#compositeSurface(
      source,
      frame.alpha,
      frame.blend,
      matteHandle?.surface ?? null,
      frame.matteMode,
    )
    return null
  }

  draw(
    handle: GfxOffscreenHandle,
    opts: {
      opacity?: number
      blend?: GfxBlend
      matte?: GfxOffscreenHandle
      matteMode?: GfxMatteMode
    } = {},
  ): void {
    const surface = (handle as unknown as OffscreenHandle).surface
    const matte = opts.matte as unknown as OffscreenHandle | undefined
    this.#compositeSurface(
      surface,
      this.#ctx.stateStack.getAlpha() * (opts.opacity ?? 1),
      opts.blend ?? this.#ctx.stateStack.getBlend(),
      matte?.surface ?? null,
      opts.matteMode ?? 'alpha',
    )
  }

  /** Record a quad of `s` at its rectangle in the current target. */
  #compositeSurface(
    s: CompositeSource,
    alpha: number,
    blend: GfxBlend,
    matte: Surface | null,
    matteMode: GfxMatteMode,
  ): void {
    // A matte surface must cover the same rectangle, which is how the shader
    // addresses both with one UV.
    if (
      matte &&
      (matte.x !== s.x || matte.y !== s.y || matte.w !== s.w || matte.h !== s.h)
    ) {
      matte = null
    }
    if (!COMPOSITE_BLENDS.has(blend)) {
      diagnostics.report(
        'SG2001',
        `offscreen blend '${blend}' is not supported, compositing with 'source-over'`,
      )
      blend = 'source-over'
    }
    const draw: CompositeDraw = {
      tex: s.tex,
      matte: matte ? matte.tex : null,
      matteMode: matte ? matteMode : 'none',
      opacity: alpha,
    }
    // The rectangle in the target now being recorded into.
    const x = s.x
    const quad = [x, s.y, x + s.w, s.y, x + s.w, s.y + s.h, x, s.y + s.h]
    const u1 = s.w / s.texW
    const topDown = this.#device.ndc.textureTopDown
    const v0 = topDown ? 0 : 1
    const v1 = topDown ? s.h / s.texH : 1 - s.h / s.texH
    const uv = [0, v0, u1, v0, u1, v1, 0, v1]
    this.#ctx.stateStack.push()
    this.#ctx.stateStack.setBlend(blend)
    this.#composite.record(this.#ctx, draw, quad, uv)
    this.#ctx.stateStack.pop()
  }
}
