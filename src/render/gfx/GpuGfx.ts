/**
 * `Gfx2D` implementation that batches draws through a `GfxDevice`.
 *
 * Batch-break conditions: program change, texture bind, blend mode, analytic
 * clip change, ring-slot overflow, an explicit `flush()` at a layer boundary,
 * and `endFrame`. Alpha, color, and transform fold into the per-vertex or
 * per-instance record and never break a batch.
 *
 * Coordinator: this class holds the `Gfx2D` public surface and the frame
 * lifecycle. Each draw program (coloredTri, stroke, shape, gradientRadial,
 * maskedGradient, textQuad) lives in `./programs/*.ts` and owns its shader,
 * vertex layout, ring-buffered stream, and pipeline variants. Shared batch
 * state (transform/state stacks, the active-batch key, the texture manager)
 * lives on `GpuBatchContext`, so a program module never needs a `GpuGfx`
 * reference.
 */

import { diagnostics } from '../../diagnostics/Diagnostics'
import type {
  Gfx2D,
  GfxBlend,
  GfxClipShape,
  GfxMatteMode,
  GfxOffscreenHandle,
  GfxOffscreenOptions,
  GfxSurfaceEffects,
  GfxFill,
  GfxGradientStop,
  GfxImageOptions,
  GfxShadowStyle,
  GfxStrokeStyle,
  GfxTextStyle,
  SolidStrokeStyle,
} from './Gfx2D'
import type { RenderTarget, TargetFormat, Texture, VBuffer } from './GfxDevice'
import type { GfxDevice } from './GfxDevice'
import { depthStencilFormatOf } from './depthStencil'
import { parseColor } from './parseColor'
import { RenderFailures } from './RenderFailures'
import type { GeometryHandle } from './GeometryHandle'
import type { RetainedCacheStats } from './RetainedCache'
import {
  getContourClosed,
  getPathContours,
  getPathTessellation,
} from './PathTessellationRegistry'
import { tessellateContours } from '../../assets/SvgPathContours'
import { DEFAULT_MITER_LIMIT } from './strokeOutline'
import { GfxPath, type FlatPath } from './GfxPath'
import { appendStrokeFill } from './pathStroke'
import { DashBuffer } from './dash'
import { SurfacePool, type Surface } from './OffscreenSurfaces'
import {
  SurfaceEffects,
  firstEffectSmooths,
  placementOf,
  type SurfaceEffectsJob,
  type LayerCacheEntry,
} from './SurfaceEffects'
import { ImageDraw } from './ImageDraw'
import { TextDraw } from './TextDraw'
import { GradientFills } from './GradientFills'
import { StrokeDraw, solidStroke } from './StrokeDraw'
import { PathShadows, RETAIN_FILL_INDICES } from './PathShadows'
import { PostChain } from '../postfx/PostChain'
import {
  OffscreenCompositeProgram,
  type CompositeDraw,
} from './programs/offscreenComposite'
import type { PassHooks } from './GpuBatchContext'
import { MAX_CLIP_DEPTH } from './stencilRecipe'
import type { ClipBounds } from './programs/coloredTri'
import type { FillRule } from './stencilRecipe'
import { TextureManager, type TextureInspector } from './TextureManager'
import { VectorQuality } from '../VectorQuality'
import type { BitmapMask } from '../../assets/BitmapMask'
import { rgbaTuple } from './packing'
import { RING_SIZE } from './batchLayout'
import {
  GpuBatchContext,
  type DebugRenderMode,
  type GpuGfxStats,
} from './GpuBatchContext'
import type { GpuProgram } from './GpuProgram'
import { ColoredTriProgram } from './programs/coloredTri'
import { StrokeProgram } from './programs/stroke'
import { resolveRadii, type RoundRectRadii } from './roundRectRadii'
import { resolveClip } from './analyticClip'
import { emitDebugPolygonOutline } from './debugWireframe'

import { fitSquircleCorners, squircleShadowRadiusScale } from './squircle'
import { GradientRadialProgram } from './programs/gradientRadial'
import { MaskedGradientProgram } from './programs/maskedGradient'
import { ShaderQuadProgram } from './programs/shaderQuad'
import type { ShaderQuad } from './ShaderQuad'
import { TextQuadProgram } from './programs/textQuad'
import { ShapeProgram } from './programs/shape'
import { PathShadowCompositeProgram } from './programs/pathShadowComposite'

export type { DebugRenderMode, GpuGfxStats }

/**
 * Counters for `Gfx2D` calls that hit a no-op or fallback path, such as
 * `strokePath2D` on a Path2D without a registered tessellation.
 */
export interface UnimplementedCounts {
  fillPath2D: number
  strokePath2D: number
  shadowPath2D: number
  /**
   * An outset path shadow drew the hard (unblurred) silhouette because its mask
   * was cold (this frame's first request), starved (budget exhausted), or
   * disabled (`quality.vector.pathShadowsEnabled === false`), and the cache had
   * no nearby blur of the same path to stand in either. Does not cover an inset
   * shadow skipped for the same reason, since that has no silent-degradation
   * draw to count, it just doesn't draw.
   */
  pathShadowFallback: number
  /**
   * A non-center `align` (or an outline-routed stroke's alignment) was refused
   * on an open or zero-area contour and fell back to `'center'` (see
   * `strokeOutline.ts`'s `resolveAlign`). Ticked on every occurrence.
   */
  strokeAlignFallback: number
}

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

/** One clip path pushed by `clipPath`, undone by the `restore` of its level. */
interface ClipPush {
  level: number
  /** Device bounds to pop, `null` when the clip raised no pixels. */
  bounds: ClipBounds | null
  /** Whether the depth went up, `false` when the depth cap refused it. */
  raised: boolean
}

/** The segments a flattened path strokes, counting the closing one. */
function flatSegments(flat: FlatPath): number {
  let n = 0
  for (let c = 0; c < flat.contourCount; c++) {
    const len = flat.starts[c + 1] - flat.starts[c]
    if (len < 1) continue
    n += flat.closed[c] === 1 ? len : len - 1
  }
  return n
}

export class GpuGfx implements Gfx2D {
  readonly #device: GfxDevice
  readonly #canvas: HTMLCanvasElement

  // FBO target.
  #target: RenderTarget
  #targetWidth: number
  #targetHeight: number

  /**
   * Shared batch state: transform/state stacks, active-batch key, texture
   * manager.
   */
  readonly #ctx: GpuBatchContext

  readonly #coloredTri = new ColoredTriProgram()
  readonly #stroke = new StrokeProgram()
  readonly #gradientRadial = new GradientRadialProgram()
  readonly #maskedGradient = new MaskedGradientProgram()
  readonly #shaderQuad = new ShaderQuadProgram()
  readonly #textQuad = new TextQuadProgram()
  readonly #shape = new ShapeProgram()
  readonly #pathShadowComposite = new PathShadowCompositeProgram()
  readonly #composite = new OffscreenCompositeProgram()

  readonly #gradientFills: GradientFills
  readonly #strokeDraw: StrokeDraw
  readonly #pathShadows: PathShadows
  readonly #imageDraw: ImageDraw
  readonly #textDraw: TextDraw

  /**
   * Every texture the GPU backend uses: atlas, per-source, gradient LUTs, clip
   * masks. Mirrored onto `ctx.textureManager` so program modules can reach it.
   */
  #textureManager!: TextureManager

  readonly stats: GpuGfxStats = {
    drawCalls: 0,
    programSwitches: 0,
    textureBinds: 0,
    blendSwitches: 0,
    uboSlices: 0,
    runsMerged: 0,
    primitives: 0,
    bytesUploaded: 0,
    streamedBytes: {},
    passCount: 0,
    framePasses: 0,
    frameSubmits: 0,
    frameBindGroupsCreated: 0,
    frameBindGroupSwitches: 0,
    frameUniformWrites: 0,
    surfaces: 0,
    offscreenBytes: 0,
    sdfInstances: 0,
    strokeInstances: 0,
    roundRectInstances: 0,
    shadowInstances: 0,
    msaaSamples: 1,
    outlineTessellations: 0,
    outlineCacheHits: 0,
    rampRowsWritten: 0,
    labelRasters: 0,
    labelUploadBytes: 0,
    labelDedicated: 0,
    labelHolds: 0,
    labelPageWipes: 0,
    labelEntries: 0,
    maskBakes: 0,
    maskBakeWork: 0,
    maskBytes: 0,
    poolHits: 0,
    poolMisses: 0,
  }
  /** Tripwire counters. Ticked when a Gfx2D call reaches a no-op path. */
  readonly unimplemented: UnimplementedCounts = {
    fillPath2D: 0,
    strokePath2D: 0,
    shadowPath2D: 0,
    pathShadowFallback: 0,
    strokeAlignFallback: 0,
  }

  /**
   * MSAA sample count. `1` = plain color texture. `>1` = multisample
   * renderbuffer resolved by `blitToDefault`. Persists across resize and
   * context restore.
   */
  #samples: number
  /**
   * Whether the offscreen target carries a depth attachment for the 3D pass.
   * Allocated once via {@link GpuGfx.enableDepth} and kept across resize and
   * context restore. A pure-2D stage never sets it.
   */
  #depthEnabled = false
  /**
   * Whether the offscreen target carries stencil bits, which the deduplicated
   * translucent-stroke path needs.
   *
   * Fixed at construction, and independent of depth: the attachment carries
   * both, so a 3D pass costs the stroke path nothing. Changing it later would
   * re-warm every pipeline, since each one bakes the format it draws into.
   */
  #stencilEnabled: boolean
  /**
   * Whether `endFrame` blits the target to the canvas. `false` when another
   * pass samples the resolved color texture instead.
   */
  #present: boolean
  /**
   * Single-sample resolve target, allocated only when the main target is MSAA.
   * The main pass resolves into it on `endRenderPass`. `present` blits it to
   * the canvas (single-sample, so scaling is allowed) and a post-process pass
   * samples it.
   */
  #resolveTarget: RenderTarget | null = null
  /**
   * Whether pipelines have finished their async pre-warm. The stage skips
   * rendering until this is true (WebGL2 resolves within a microtask, WebGPU
   * takes longer).
   */
  #ready = false
  /** Programs whose pipelines failed to build. They draw nothing. */
  readonly failures: RenderFailures
  #warmupSeq = 0
  /** Whether the target is drawn in the canvas's own format. */
  readonly #canvasFormat: boolean
  readonly #holdLabels: boolean
  /** Resolves when the current warm-up completes, awaited by tests. */
  #warmupPromise: Promise<void> = Promise.resolve()

  constructor(
    canvas: HTMLCanvasElement,
    device: GfxDevice,
    opts: {
      samples?: number
      present?: boolean
      /**
       * Draw in the canvas's own format, so the frame's last pass can resolve
       * straight into the canvas instead of into a target that is copied
       * there.
       */
      canvas?: boolean
      stencil?: boolean
      vectorQuality?: VectorQuality
      /** Where build failures are reported. Defaults to a private collector. */
      failures?: RenderFailures
      /** See {@link TextureManager.holdLabels}. Default `true`. */
      holdLabels?: boolean
    } = {},
  ) {
    this.failures = opts.failures ?? new RenderFailures()
    this.#canvas = canvas
    this.#device = device
    this.#samples = opts.samples ?? 4
    this.#present = opts.present ?? true
    this.#canvasFormat = opts.canvas ?? false
    this.#stencilEnabled = opts.stencil ?? false
    this.#holdLabels = opts.holdLabels ?? true
    this.#targetWidth = canvas.width || 1
    this.#targetHeight = canvas.height || 1
    this.#target = null as unknown as RenderTarget
    this.#textureManager = null as unknown as TextureManager
    this.#ctx = new GpuBatchContext(device, this.stats)
    this.#pool = new SurfacePool(device)
    this.#effects = new SurfaceEffects(device)
    this.#ctx.vectorQuality = opts.vectorQuality ?? new VectorQuality()
    this.#ctx.registerProgram(this.#coloredTri)
    this.#ctx.registerProgram(this.#coloredTri.fan)
    this.#ctx.registerProgram(this.#stroke)
    this.#ctx.registerProgram(this.#composite)
    this.#ctx.registerProgram(this.#shape)
    this.#ctx.registerProgram(this.#gradientRadial)
    this.#ctx.registerProgram(this.#maskedGradient)
    this.#ctx.registerProgram(this.#textQuad)
    this.#ctx.registerProgram(this.#pathShadowComposite)
    this.#ctx.registerProgram(this.#shaderQuad)
    this.#imageDraw = new ImageDraw(this.#ctx, this.#shape, this.#textQuad)
    this.#textDraw = new TextDraw(this.#ctx, this.#shape, this.#textQuad)
    this.#gradientFills = new GradientFills({
      ctx: this.#ctx,
      coloredTri: this.#coloredTri,
      radial: this.#gradientRadial,
      masked: this.#maskedGradient,
      shaderQuad: this.#shaderQuad,
      gfx: this,
    })
    this.#strokeDraw = new StrokeDraw({
      ctx: this.#ctx,
      stroke: this.#stroke,
      shape: this.#shape,
      coloredTri: this.#coloredTri,
      stats: this.stats,
      unimplemented: this.unimplemented,
      gfx: this,
      hasStencil: () => this.#target.hasStencil,
    })
    this.#pathShadows = new PathShadows({
      ctx: this.#ctx,
      coloredTri: this.#coloredTri,
      composite: this.#pathShadowComposite,
      unimplemented: this.unimplemented,
      gfx: this,
      canDrawRetained: (geo, ownRun) => this.#canDrawRetained(geo, ownRun),
    })
    this.#initGpuResources()
  }

  /** All draw programs, in construction/registration order. */
  get #programs(): GpuProgram[] {
    return [
      this.#coloredTri,
      this.#coloredTri.fan,
      this.#stroke,
      this.#shape,
      this.#gradientRadial,
      this.#maskedGradient,
      this.#textQuad,
      this.#pathShadowComposite,
      this.#shaderQuad,
      this.#composite,
    ]
  }

  /** Whether pipelines are warm and the surface can render this frame. */
  get ready(): boolean {
    return this.#ready
  }

  /** Resolves once pipelines have warmed, when {@link ready} turns true. */
  get whenReady(): Promise<void> {
    return this.#warmupPromise
  }

  /**
   * Whether a surface effect's pipeline is still compiling. A surface whose
   * effects are not compiled yet composites unprocessed.
   */
  get effectsCompiling(): boolean {
    return this.#effects.compiling
  }

  /** Resolves once the surface effect pipelines compiling now have finished. */
  whenEffectsCompiled(): Promise<void> {
    return this.#effects.whenCompiled()
  }

  /**
   * (Re)create every backend resource. Called from the constructor and from
   * `rebuildResources` on context restore. Kicks off the async pipeline
   * warm-up.
   */
  #initGpuResources(): void {
    const device = this.#device
    const unitQuadBuffer: VBuffer = device.createVertexBuffer(6 * 2 * 4)
    const unit = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])
    device.updateBufferSubData(unitQuadBuffer, 0, unit)
    this.#ctx.unitQuadBuffer = unitQuadBuffer
    // 1×1 placeholder, bound to sampler slots a shader declares but doesn't
    // sample this draw. The contents are never read, but a texture bound while
    // still uninitialised makes the driver clear it on first use and warn, so
    // it gets one white texel.
    this.#ctx.placeholderTexture = device.createTexture2D({
      width: 1,
      height: 1,
      filter: 'nearest',
      wrap: 'clamp',
    })
    if (typeof ImageData !== 'undefined') {
      device.updateTexture2D(
        this.#ctx.placeholderTexture,
        new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1),
      )
    }
    // Shared per-frame projection UBO and its bind group. Every 2D pipeline's
    // group 0 reads it.
    this.#ctx.initFrameUbo()

    for (const p of this.#programs) p.init(device, this.#ctx)

    this.#target = device.createRenderTarget({
      width: this.#targetWidth,
      height: this.#targetHeight,
      samples: this.#samples,
      depth: this.#depthEnabled,
      stencil: this.#stencilEnabled,
      colorSpace: this.#canvasFormat ? 'canvas' : undefined,
    })
    this.stats.msaaSamples = this.#target.samples
    this.#publishTargetFormat()
    this.#ensureResolveTarget()

    if (this.#textureManager) {
      this.#textureManager.rebuild(device)
    } else {
      this.#textureManager = new TextureManager(device)
      this.#textureManager.holdLabels = this.#holdLabels
    }
    this.#ctx.textureManager = this.#textureManager

    // Old handles (if any) died with the previous context; no explicit
    // teardown call reaches them, same as every other GPU resource rebuilt
    // here. Its own pipelines are independent of the screen target's format,
    // so this is the only place it's (re)built, unlike `#programs`.
    this.#pathShadows.reset(device, (err) =>
      this.failures.report('path shadows', err),
    )
    this.#pool.dispose()
    this.#effects.reset()

    this.#warmupPromise = this.#warmupPipelines()
  }

  /**
   * Create every program's pipeline variants for the current target color
   * format + sample count. Async, since WebGPU compiles pipelines
   * asynchronously. `#ready` gates rendering until it resolves. A `#warmupSeq`
   * guard drops a stale warm-up if the target changed again mid-flight (MSAA
   * swap, resize).
   */
  async #warmupPipelines(): Promise<void> {
    this.#ready = false
    const seq = ++this.#warmupSeq
    this.#publishTargetFormat()
    this.#ctx.resetPipelineSets()
    for (const p of this.#programs) {
      try {
        await p.warmup(this.#device, this.#ctx)
      } catch (err) {
        // The program draws nothing. Everything else still renders.
        this.failures.report(`2D program '${p.kind}'`, err)
      }
      if (seq !== this.#warmupSeq) return
    }
    // The first frame waits for the smooth-corner field, so a smoothed shape
    // never draws with circular corners first.
    await this.#textureManager.loadSquircleField()
    if (seq === this.#warmupSeq) this.#ready = true
  }

  /**
   * Whether the frame resolves straight into the canvas: a canvas-format target
   * that presents, with samples to resolve.
   */
  get #resolvesToCanvas(): boolean {
    return this.#canvasFormat && this.#present && this.#target.samples > 1
  }

  /** Where the main pass resolves its samples, if anywhere. */
  #resolveDestination(): RenderTarget | undefined {
    if (this.#resolvesToCanvas) return this.#device.canvasTarget()
    return this.#resolveTarget ?? undefined
  }

  /**
   * Allocate (or reallocate) the single-sample resolve target when the main
   * target is MSAA and something samples the result. Drops it when not. Matches
   * the main target's size + color space so the MSAA resolve is format- and
   * bounds-compatible. A frame that resolves into the canvas has no use for
   * it.
   */
  #ensureResolveTarget(): void {
    if (this.#target.samples > 1 && !this.#resolvesToCanvas) {
      if (this.#resolveTarget)
        this.#device.deleteRenderTarget(this.#resolveTarget)
      this.#resolveTarget = this.#device.createRenderTarget({
        width: this.#targetWidth,
        height: this.#targetHeight,
        samples: 1,
        colorSpace: this.#target.colorSpace,
      })
    } else if (this.#resolveTarget) {
      this.#device.deleteRenderTarget(this.#resolveTarget)
      this.#resolveTarget = null
    }
  }

  /**
   * The sampleable / presentable target: the resolved one under MSAA, else the
   * target.
   */
  get #presentSource(): RenderTarget {
    return this.#resolveTarget ?? this.#target
  }

  /**
   * Read-only view of the texture caches for the debug inspector. Building the
   * snapshot has no standing cost, the debug panel calls it on demand.
   * `TextureManager`'s own snapshot carries an always-empty `shadowMasks` (it
   * has no reference to `PathShadowCache`), filled in here since this is the
   * one place both are reachable together.
   */
  get textureInspector(): TextureInspector {
    const textureManager = this.#textureManager
    const pathShadowCache = this.#pathShadows.cache
    return {
      snapshot: () => ({
        ...textureManager.snapshot(),
        shadowMasks: pathShadowCache.listMasks(),
      }),
      renderLabelPreview: (key) => textureManager.renderLabelPreview(key),
    }
  }

  /**
   * Drop every cached label raster, so the next frame re-rasterizes text. Used
   * after a webfont arrives late. See `TextureManager.clearLabelCache`.
   */
  clearLabelCache(): void {
    this.#textureManager.clearLabelCache()
  }

  /** The backend device, for the 3D pass to draw through the same frame/target. */
  get device(): GfxDevice {
    return this.#device
  }

  /**
   * The attachment signature of the offscreen target, so the 3D pass
   * (`MeshRenderer`, `DebugLine3DRenderer`) can build pipelines matching the
   * shared target it draws into.
   */
  get targetFormat(): TargetFormat {
    return { ...this.#ctx.targetFormat }
  }

  /**
   * Republish the live target's signature onto the batch context. Every path
   * that swaps `#target` calls this, so the format the programs build against
   * is the one the pass will actually open with.
   */
  #publishTargetFormat(): void {
    this.#ctx.targetFormat = {
      format: this.#target.colorSpace,
      samples: this.#target.samples,
      depthStencil: depthStencilFormatOf(this.#target),
    }
    this.#ctx.passSamples = this.#target.samples
  }

  /**
   * Add a depth attachment to the offscreen target so a depth-tested 3D pass
   * can run before the 2D layers, and clear it each frame from then on.
   * Idempotent, and reversible through {@link GpuGfx.disableDepth}. The
   * attachment survives resize and context restore. No-op if already enabled.
   */
  enableDepth(): void {
    if (this.#depthEnabled) return
    this.#depthEnabled = true
    this.#retarget()
  }

  /**
   * Drop the depth attachment. No-op if depth is already off. Stencil bits the
   * stage was built with are unaffected either way.
   *
   * A host that shares one stage across several scenes calls this when a
   * depth-using scene goes away. A stage outlives the scenes drawn on it, so
   * without this the attachment stays allocated for the rest of the stage's
   * life.
   */
  disableDepth(): void {
    if (!this.#depthEnabled) return
    this.#depthEnabled = false
    this.#retarget()
  }

  /** Rebuild the offscreen target for the current depth and stencil flags. */
  #retarget(): void {
    const had = depthStencilFormatOf(this.#target)
    this.#ctx.flushActive()
    this.#pool.dispose()
    this.#device.deleteRenderTarget(this.#target)
    this.#target = this.#device.createRenderTarget({
      width: this.#targetWidth,
      height: this.#targetHeight,
      samples: this.#samples,
      depth: this.#depthEnabled,
      stencil: this.#stencilEnabled,
      colorSpace: this.#canvasFormat ? 'canvas' : undefined,
    })
    this.stats.msaaSamples = this.#target.samples
    this.#publishTargetFormat()
    this.#ensureResolveTarget()

    // Every pipeline bakes the depth-stencil format of the attachment it draws
    // into, so changing which aspects the target carries invalidates all of
    // them, not just the stroke path. A stage that kept drawing with them would
    // render nothing at all.
    if (depthStencilFormatOf(this.#target) !== had) {
      this.#warmupPromise = this.#warmupPipelines()
    }
  }

  // --- frame lifecycle ------------------------------------------------------

  /**
   * Rotate ring slot, bind FBO, clear. `pixelW`/`pixelH` are ignored (FBO clear
   * covers the target), only present so backend implementations share a
   * `beginFrame` shape.
   */
  beginFrame(opts: {
    clearColor: string
    transparent: boolean
    pixelW: number
    pixelH: number
  }): void {
    void opts.pixelW
    void opts.pixelH
    // Rotate ring slot.
    this.#ctx.curSlot = (this.#ctx.curSlot + 1) % RING_SIZE
    this.#ctx.resetSlot(this.#ctx.curSlot)
    this.#textureManager.resetLabelBudget()
    this.#ctx.resetBatchMarkers()
    this.#frameNo++
    this.#gradientFills.beginFrame()
    this.#stroke.cache.sweep(this.#frameNo)
    this.#coloredTri.geometryCache.sweep(this.#frameNo)
    this.#strokeDraw.strokePieces.sweep(this.#frameNo)
    this.#strokeDraw.outlines.sweep(this.#frameNo)
    this.#effects.beginFrame(this.#frameNo)
    this.#clipPushes.length = 0
    this.#saveLevel = 0
    // Reset per-frame stats so the HUD reflects the frame just rendered.
    this.stats.drawCalls = 0
    this.stats.programSwitches = 0
    this.stats.textureBinds = 0
    this.stats.blendSwitches = 0
    this.stats.uboSlices = 0
    this.stats.bytesUploaded = 0
    this.stats.passCount = 0
    this.stats.surfaces = 0
    this.stats.sdfInstances = 0
    this.stats.primitives = 0
    this.stats.strokeInstances = 0
    this.stats.roundRectInstances = 0
    this.stats.shadowInstances = 0
    this.#updateProjection(this.#targetWidth, this.#targetHeight)
    this.#ctx.stateStack.resetBase()
    this.#ctx.txStack.setBase(1, 0, 0, 1, 0, 0)
    // Parse the CSS clear once. Fully transparent under `transparent: true`.
    const clear: readonly [number, number, number, number] = opts.transparent
      ? [0, 0, 0, 0]
      : rgbaTuple(parseColor(opts.clearColor))
    this.#device.beginFrame()
    this.#clear = clear
    this.#ctx.curBlend = 'source-over'
  }

  // --- offscreen surfaces and pass control ----------------------------------

  /**
   * Emit `performance.measure` spans around the frame's submit phases. The
   * stage mirrors `engine.perfMarks` into it.
   *
   * @internal
   */
  perfMarks = false
  #pool: SurfacePool
  /** The main pass's clear colour, set by `beginFrame`. */
  #clear: readonly [number, number, number, number] = [0, 0, 0, 0]
  #mainPrelude: (() => void) | null = null
  /** Record-time stack of open `beginOffscreen` calls. */
  readonly #offStack: OffFrame[] = []
  readonly #effects: SurfaceEffects

  /**
   * Run `draw` at the start of the main pass, before the recorded layers. The
   * callback issues draws straight to the device, so it runs while that pass is
   * open. It applies to the next submitted frame only.
   *
   * @internal
   */
  setMainPrelude(draw: (() => void) | null): void {
    this.#mainPrelude = draw
  }

  readonly #hooks: PassHooks = {
    open: (surface) => {
      if (surface) {
        if (this.perfMarks) performance.mark('gfx-surface:start')
        const slot = this.#ctx.acquireFrameSlot(surface.texW, surface.texH)
        this.#ctx.useFrameSlot(slot)
        this.#ctx.passSamples = surface.draw.samples
        this.#openSurface(surface)
      } else {
        this.#ctx.useFrameSlot(0)
        this.#ctx.passSamples = this.#target.samples
        this.#openMain()
        const prelude = this.#mainPrelude
        this.#mainPrelude = null
        prelude?.()
      }
    },
    close: (surface) => {
      this.#device.endRenderPass()
      if (surface) {
        this.stats.passCount += this.#effects.run(
          surface,
          this.#target.colorSpace,
        )
      }
      if (this.perfMarks && surface) {
        performance.measure(
          `gfx offscreen surface ${surface.w}x${surface.h}`,
          'gfx-surface:start',
        )
      }
    },
  }

  /** The pixel size of the target currently being recorded into. */
  #viewW(): number {
    return this.#topSurface()?.w ?? this.#targetWidth
  }
  #viewH(): number {
    return this.#topSurface()?.h ?? this.#targetHeight
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
    const resolve = this.#resolveDestination()
    this.stats.passCount++
    this.#device.beginRenderPass({
      color: {
        target: this.#target,
        loadOp: 'clear',
        clearColor: this.#clear,
        resolveTarget: resolve,
        // The resolve target holds the result, so the multisampled samples
        // never need to reach memory.
        storeOp: resolve ? 'discard' : 'store',
      },
      // Both aspects come off the live target rather than the requested flags,
      // so the pass can never describe an attachment the target does not have.
      depth: this.#target.hasDepth
        ? {
            target: { renderTarget: this.#target },
            loadOp: 'clear',
            // Nothing samples the main depth: 2D never tests it and AO draws
            // its own G-buffer.
            storeOp: 'discard',
          }
        : undefined,
      // Only clips and stroke de-duplication read it, and only within the
      // frame.
      stencil: this.#target.hasStencil
        ? {
            target: this.#target,
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
    this.stats.passCount++
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

  beginOffscreen(opts: GfxOffscreenOptions = {}): boolean {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    let x0 = 0
    let y0 = 0
    let x1 = this.#viewW()
    let y1 = this.#viewH()
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
    const job = fx ? this.#effects.prepare(fx, this.#target.colorSpace) : null
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
        this.#target.colorSpace,
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
          saveLevel: this.#saveLevel,
          passSamples: this.#ctx.passSamples,
        })
        return true
      }
    }
    // Effects position by the size of the texture they read, so the surface is
    // exactly the captured size. A layer whose first effect smooths its input
    // draws single-sample, once every program has pipelines for it.
    let samples = this.#target.samples
    if (fx && samples > 1 && firstEffectSmooths(fx.effects)) {
      if (this.#ctx.singleSampleReady) samples = 1
      else this.#ctx.warmSingleSample()
    }
    const surface = this.#pool.acquire(
      w,
      h,
      {
        colorSpace: this.#target.colorSpace,
        samples,
        depth: this.#target.hasDepth,
        stencil: this.#target.hasStencil,
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
    this.stats.surfaces++
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
      clipPushes: this.#clipPushes.slice(),
      saveLevel: this.#saveLevel,
      passSamples: this.#ctx.passSamples,
    })
    this.#ctx.clipDepth = 0
    this.#ctx.passSamples = samples
    this.#clipPushes.length = 0
    return true
  }

  endOffscreen(): GfxOffscreenHandle | null {
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
    this.#clipPushes.length = 0
    this.#clipPushes.push(...frame.clipPushes)
    this.#saveLevel = frame.saveLevel
    this.#ctx.passSamples = frame.passSamples
    const handle: OffscreenHandle = { surface: s }
    if (frame.retain) return handle as unknown as GfxOffscreenHandle
    const matteHandle = frame.matte as unknown as OffscreenHandle | null
    let source: CompositeSource = s
    const job = frame.fx
    if (job) {
      // The effects run when the surface's pass closes and write `out`, which
      // the composite then draws in place of the surface.
      const out = this.#effects.queue(s, job, this.#target.colorSpace)
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

  drawOffscreen(
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

  /**
   * Compile the pipelines of `fx` ahead of time, for the target's color space,
   * so the first frame that uses them is not drawn unprocessed. Safe to call
   * every frame, an already compiled pass is skipped.
   */
  warmEffects(fx: GfxSurfaceEffects): void {
    this.#effects.warm(fx, this.#target.colorSpace)
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

  /**
   * End of a draw pass (Stage calls this after the 2D walk). Under
   * record/submit this only records the pending batch as a draw-run. The GPU
   * work is deferred to `submitFrame` in `endFrame`. Doesn't advance the slot.
   */
  flush(): void {
    this.#ctx.flushActive()
  }

  /**
   * End of frame: record the last pending run, upload each stream once, replay
   * the command list, then blit the FBO to the canvas. If the context was lost
   * mid-frame, skip it all. `beginFrame` resets state next frame.
   */
  endFrame(): void {
    if (this.#device.isContextLost()) {
      return
    }
    // One frame of collection per `warmPathShadows` call: every shadow this
    // frame drew has queued its warm requests by now, and leaving the factors
    // set would re-queue them for every frame after.
    this.#pathShadows.endCollecting()
    // Replay the recorded 2D command list: every surface in a pass of its own,
    // then the main pass, which resolves MSAA into the resolve target.
    const marks = this.perfMarks
    if (marks) performance.mark('gfx-submit:start')
    this.#ctx.submitFrame(this.#hooks)
    this.#ctx.passSamples = this.#target.samples
    if (marks) {
      // The profiler drops a measure's `detail`, so the counters go in the name.
      const st = this.stats
      performance.measure(
        `gfx submit draws=${st.drawCalls} passes=${st.passCount} surfaces=${st.surfaces} uboSlices=${st.uboSlices} bytes=${st.bytesUploaded} target=${this.#targetWidth}x${this.#targetHeight}x${this.#samples}`,
        'gfx-submit:start',
      )
    }
    this.#pool.endFrame()
    this.#effects.endFrame()
    this.stats.offscreenBytes = this.#pool.bytes
    // Real GPU state-change counts come from the device (post-elision).
    // `blendSwitches` is derived from the run blend transitions in submitFrame
    // (blend is baked into pipeline variants now, not a standalone device call).
    const dc = this.#device.deviceStats
    this.stats.programSwitches = dc.pipelineSwitches
    this.stats.textureBinds = dc.textureBinds
    // Cumulative counters, copied from their owning cache/pool so a plain
    // `{...stats}` spread (the HUD's own read) picks them up: see
    // `GpuGfxStats`'s own fields for why these are cumulative, not per-frame.
    this.stats.rampRowsWritten = this.#textureManager.rampRowsWritten
    const labels = this.#textureManager.labelCounters
    this.stats.labelRasters = labels.rasters
    this.stats.labelUploadBytes = labels.uploadBytes
    this.stats.labelDedicated = labels.dedicated
    this.stats.labelHolds = labels.holds
    this.stats.labelPageWipes = labels.pageWipes
    this.stats.labelEntries = labels.entries
    this.stats.maskBakes = this.#pathShadows.cache.maskBakes
    this.stats.maskBakeWork = this.#pathShadows.cache.maskBakeWork
    this.stats.maskBytes = this.#pathShadows.cache.maskBytes
    this.stats.poolHits = this.#pathShadows.cache.pool.hits
    this.stats.poolMisses = this.#pathShadows.cache.pool.misses
    if (this.#present && !this.#resolvesToCanvas) {
      if (marks) performance.mark('gfx-present:start')
      this.#device.present(
        this.#presentSource,
        this.#canvas.width,
        this.#canvas.height,
        { filter: 'linear' },
      )
      if (marks) performance.measure('gfx present', 'gfx-present:start')
    }
    // A frame handed to post-processing is submitted once that has run.
    if (this.#present) this.#device.endFrame()
  }

  #counted = { passes: 0, submits: 0, groups: 0, switches: 0, writes: 0 }

  /**
   * Publish the device work done since the last call as the frame's counters.
   * The stage calls it once its frame is complete, so passes that run before
   * `beginFrame` and after `endFrame` (shadows, AO, post-processing) count.
   */
  captureFrameCounters(): void {
    const d = this.#device.deviceStats
    const c = this.#counted
    const s = this.stats
    s.framePasses = d.passes - c.passes
    s.frameSubmits = d.submits - c.submits
    s.frameBindGroupsCreated = d.bindGroupsCreated - c.groups
    s.frameBindGroupSwitches = d.bindGroupSwitches - c.switches
    s.frameUniformWrites = d.uniformWrites - c.writes
    c.passes = d.passes
    c.submits = d.submits
    c.groups = d.bindGroupsCreated
    c.switches = d.bindGroupSwitches
    c.writes = d.uniformWrites
  }

  /**
   * Color texture backing this surface's target, for sampling elsewhere (a
   * non-presenting offscreen surface). `null` when the target is a multisample
   * renderbuffer (`samples > 1`), which cannot be sampled. Use `samples: 1`.
   */
  get colorTexture(): Texture | null {
    // The present source is single-sample unless the frame resolves straight
    // into the canvas, which leaves nothing to sample.
    const source = this.#presentSource
    return source.samples > 1 ? null : this.#device.colorTexture(source)
  }

  /**
   * The resolved, sampleable target a post-process pipeline reads (after
   * `setPresent(false)` + `endFrame` have submitted + resolved the frame).
   * Under MSAA this is the single-sample resolve target. Otherwise it is the
   * target itself.
   */
  get target(): RenderTarget {
    return this.#presentSource
  }

  /** Current target size in device pixels, for sizing downstream targets. */
  get targetSize(): { w: number; h: number } {
    return { w: this.#targetWidth, h: this.#targetHeight }
  }

  /**
   * Toggle whether `endFrame` blits the target to the canvas. A `Stage` sets
   * this false for the frames a post-process pipeline will present instead, and
   * true again when no effects are active. Pure state flag, touches no GL.
   */
  setPresent(present: boolean): void {
    if (present === this.#present) return
    this.#present = present
    this.#ensureResolveTarget()
  }

  /**
   * Resize the offscreen render target and its resolve target. Idempotent, so a
   * `ResizeObserver` can call it on every observation.
   */
  setInternalSize(pixelW: number, pixelH: number): void {
    if (pixelW === this.#targetWidth && pixelH === this.#targetHeight) return
    this.#targetWidth = pixelW
    this.#targetHeight = pixelH
    this.#device.resizeRenderTarget(this.#target, pixelW, pixelH)
    if (this.#resolveTarget)
      this.#device.resizeRenderTarget(this.#resolveTarget, pixelW, pixelH)
  }

  /**
   * Rebuild every GL resource after `webglcontextrestored`. Programs, buffers,
   * VAOs, FBO, atlas texture. CPU-side state (batch flags, transform/state
   * stacks, stats, texture manager's backing canvases) survives the loss.
   */
  rebuildResources(): void {
    if (this.#device.isContextLost()) {
      diagnostics.report(
        'SG1003',
        'GpuGfx.rebuildResources: called while context is still lost; skipping. Stage will retry on the next contextrestored event.',
      )
      return
    }
    // Clear batch state, old handles are dead.
    this.#ctx.resetBatchMarkers()
    // Reset ring cursors so the first new frame starts from a clean slot.
    this.#ctx.curSlot = 0
    this.#initGpuResources()
  }

  // --- Gfx2D: transform ----------------------------------------------------

  setBaseTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    const stack = this.#offStack
    if (stack.length === 0) {
      this.#ctx.txStack.setBase(a, b, c, d, e, f)
      return
    }
    // Inside a surface the matrix is still given in target pixels. A surface's
    // origin is in the pixels of the one around it, so the matrix moves by the
    // origins of every open surface, and keeps the stack's depth.
    let ox = 0
    let oy = 0
    for (let i = 0; i < stack.length; i++) {
      ox += stack[i].surface?.x ?? 0
      oy += stack[i].surface?.y ?? 0
    }
    this.#ctx.txStack.setTop(a, b, c, d, e - ox, f - oy)
  }

  save(): void {
    this.#ctx.txStack.push()
    this.#ctx.stateStack.push()
    this.#saveLevel++
  }

  restore(): void {
    // Undo the clip paths pushed at this level before the matrix goes.
    const pushes = this.#clipPushes
    while (
      pushes.length > 0 &&
      pushes[pushes.length - 1].level >= this.#saveLevel
    ) {
      const push = pushes.pop() as ClipPush
      if (!push.raised) continue
      if (push.bounds) this.#coloredTri.clipPop(this.#ctx, push.bounds)
      this.#ctx.clipDepth--
    }
    if (this.#saveLevel > 0) this.#saveLevel--
    this.#ctx.txStack.pop()
    this.#ctx.stateStack.pop()
  }

  clipPath(path: GfxPath, rule: FillRule = 'nonzero'): void {
    if (path.released || path.isEmpty) return
    if (!this.#stencilEnabled) {
      diagnostics.report(
        'SG2002',
        'this surface has no stencil buffer, so clipPath is ignored',
      )
      return
    }
    if (this.#ctx.clipDepth >= MAX_CLIP_DEPTH) {
      diagnostics.report(
        'SG2003',
        `clip paths nest at most ${MAX_CLIP_DEPTH} deep, extra clips are ignored`,
      )
      // Keep restore balanced.
      this.#clipPushes.push({
        level: this.#saveLevel,
        bounds: null,
        raised: false,
      })
      return
    }
    const flat = path.flatten(this.#flattenTolerance())
    const bounds = this.#coloredTri.clipPush(
      this.#ctx,
      flat,
      rule,
      this.#viewW(),
      this.#viewH(),
    )
    // An empty or off-screen clip still raises the depth, over no pixels, so
    // nothing drawn inside it passes the test.
    this.#clipPushes.push({ level: this.#saveLevel, bounds, raised: true })
    this.#ctx.clipDepth++
  }

  translate(x: number, y: number): void {
    this.#ctx.txStack.translate(x, y)
  }

  rotate(rad: number): void {
    this.#ctx.txStack.rotate(rad)
  }

  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.#ctx.txStack.postMultiply(a, b, c, d, e, f)
  }
  scale(sx: number, sy: number): void {
    this.#ctx.txStack.scale(sx, sy)
  }

  // --- Gfx2D: alpha + blend ------------------------------------------------

  getAlpha(): number {
    return this.#ctx.stateStack.getAlpha()
  }

  setAlpha(alpha: number): void {
    // Absolute, matching Canvas globalAlpha (see Gfx2D docstring).
    this.#ctx.stateStack.setAlpha(alpha)
  }

  readonly #dashBuffer = new DashBuffer()
  /** Scratch for the filled form of a stroke. */
  readonly #strokeFill = new GfxPath()
  #saveLevel = 0
  readonly #clipPushes: ClipPush[] = []

  setBlend(mode: import('./Gfx2D').GfxBlend): void {
    if (mode !== 'source-over' && mode !== 'lighter') {
      diagnostics.report(
        'SG2001',
        `blend '${mode}' is not supported, drawing with 'source-over'`,
      )
      mode = 'source-over'
    }
    this.#ctx.stateStack.setBlend(mode)
  }

  setClipMask(mask: BitmapMask | null): void {
    // Just stores on the state stack. The actual GPU state change (uniform
    // set + texture bind) happens lazily inside `ColoredTriProgram.begin` /
    // `flush` when the effective mask differs from the batch's baked-in
    // mask, matches how blend + texture flips force a flush.
    this.#ctx.stateStack.setClipMask(mask)
  }

  /**
   * The geometric mean of the transform's two axis scales, which is the
   * rotation-safe reading: exactly the scale factor when uniform, and the
   * area-preserving average when not.
   */
  deviceScale(): number {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const s = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c))
    return s > 0 ? s : 1
  }

  snapSize(v: number): number {
    const s = this.deviceScale()
    if (!(s > 0) || !Number.isFinite(v)) return v
    return Math.max(1, Math.round(v * s)) / s
  }

  setClip(shape: GfxClipShape | null): void {
    if (!shape) {
      this.#ctx.stateStack.setClip(null)
      return
    }
    // The snapshot is taken now, so later transform changes don't move the clip.
    this.#ctx.txStack.read(this.#ctx.txOut)
    this.#ctx.stateStack.setClip(resolveClip(this.#ctx.txOut, shape))
  }

  /**
   * Switch the debug render mode. Global state (not stack-scoped), the debug
   * HUD is the sole caller and it wants ALL draws affected until toggled off.
   * Flushes the current batch so old-mode pixels finish out before the new-mode
   * uniforms take effect.
   */
  setDebugRenderMode(mode: DebugRenderMode): void {
    if (this.#ctx.curDebugMode === mode) return
    this.#ctx.flushActive()
    this.#ctx.curDebugMode = mode
  }

  /** Current debug render mode. Read by the HUD to reflect state. */
  getDebugRenderMode(): DebugRenderMode {
    return this.#ctx.curDebugMode
  }

  /**
   * Live-swap MSAA sample count. Flushes, deletes the FBO, allocates a fresh
   * one. The device clamps to `[1, MAX_SAMPLES]`, `stats.msaaSamples` mirrors
   * the effective post-clamp count for the HUD.
   */
  setSamples(samples: number): void {
    const requested = Math.max(0, Math.floor(samples))
    // Store the request so a subsequent context-loss rebuild picks it up.
    // Actual clamp/effective count read from `this.target.samples`.
    if (this.#samples === requested) return
    this.#ctx.flushActive()
    this.#samples = requested
    this.#device.deleteRenderTarget(this.#target)
    this.#target = this.#device.createRenderTarget({
      width: this.#targetWidth,
      height: this.#targetHeight,
      samples: this.#samples,
      depth: this.#depthEnabled,
      stencil: this.#stencilEnabled,
      colorSpace: this.#canvasFormat ? 'canvas' : undefined,
    })
    this.stats.msaaSamples = this.#target.samples
    this.#ensureResolveTarget()
    // Sample count changed, so pipelines must be rebuilt for the new count.
    this.#warmupPromise = this.#warmupPipelines()
  }

  /**
   * Whether draws that can be drawn together are joined, even across draws that
   * share no pixels. On by default. Turn it off to compare against one draw per
   * run.
   */
  get mergeRuns(): boolean {
    return this.#ctx.mergeRuns
  }
  set mergeRuns(on: boolean) {
    this.#ctx.mergeRuns = on
  }

  /** Current effective MSAA sample count (post-clamp). */
  getSamples(): number {
    return this.#target.samples
  }

  // --- Gfx2D: fills --------------------------------------------------------

  fillRect(x: number, y: number, w: number, h: number, fill: GfxFill): void {
    this.#coloredTri.fillRect(this.#ctx, x, y, w, h, fill)
    if (this.#ctx.curDebugMode === 'polygons') {
      // Rect corners CCW starting from A. `emitDebugPolygonOutline`
      // handles the closing edge.
      const rectPts = [x, y, x + w, y, x + w, y + h, x, y + h]
      emitDebugPolygonOutline(this, this.#ctx, rectPts, 4, true)
    }
  }

  fillCircle(cx: number, cy: number, r: number, fill: GfxFill): void {
    this.#shape.fillCircle(this.#ctx, cx, cy, r, fill)
  }

  fillRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    fill: GfxFill,
    smoothing = 0,
  ): void {
    this.#resolveCorners(radii, w, h, smoothing)
    this.#shape.fillRoundRect(
      this.#ctx,
      x,
      y,
      w,
      h,
      this.#radii,
      fill,
      this.#cornerSmoothing,
    )
  }

  strokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    style: GfxStrokeStyle,
    smoothing = 0,
  ): void {
    this.#resolveCorners(radii, w, h, smoothing)
    this.#shape.strokeRoundRect(
      this.#ctx,
      x,
      y,
      w,
      h,
      this.#radii,
      solidStroke(style),
      this.#cornerSmoothing,
    )
  }

  fillAndStrokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    fill: GfxFill,
    style: GfxStrokeStyle,
    smoothing = 0,
  ): void {
    this.#resolveCorners(radii, w, h, smoothing)
    this.#shape.fillAndStrokeRoundRect(
      this.#ctx,
      x,
      y,
      w,
      h,
      this.#radii,
      fill,
      solidStroke(style),
      this.#cornerSmoothing,
    )
  }

  /**
   * Resolve a round rect's corners into `#radii` and `#cornerSmoothing`. With
   * smoothing they are fitted as Figma does (see `fitSquircleCorners`). Without
   * it, or before the smooth-corner field has loaded, they follow the CSS
   * radius rules and are circular.
   */
  #resolveCorners(
    radii: RoundRectRadii,
    w: number,
    h: number,
    smoothing: number,
  ): void {
    if (smoothing > 0 && this.#textureManager.getSquircleFieldTexture()) {
      fitSquircleCorners(
        w,
        h,
        radii,
        smoothing,
        this.#radii,
        this.#cornerSmoothing,
      )
    } else {
      resolveRadii(radii, w, h, this.#radii)
      this.#cornerSmoothing.fill(0)
    }
  }

  fillAndStrokeCircle(
    cx: number,
    cy: number,
    r: number,
    fill: GfxFill,
    style: GfxStrokeStyle,
  ): void {
    this.#shape.fillAndStrokeCircle(
      this.#ctx,
      cx,
      cy,
      r,
      fill,
      solidStroke(style),
    )
  }

  fillEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: GfxFill,
  ): void {
    this.#shape.fillEllipse(this.#ctx, cx, cy, rx, ry, fill)
  }

  strokeEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    style: GfxStrokeStyle,
  ): void {
    this.#shape.strokeEllipse(this.#ctx, cx, cy, rx, ry, solidStroke(style))
  }

  fillAndStrokeEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: GfxFill,
    style: GfxStrokeStyle,
  ): void {
    this.#shape.fillAndStrokeEllipse(
      this.#ctx,
      cx,
      cy,
      rx,
      ry,
      fill,
      solidStroke(style),
    )
  }

  fillConvexPoly(pts: ArrayLike<number>, count: number, fill: GfxFill): void {
    this.#coloredTri.fillConvexPoly(this.#ctx, pts, count, fill)
    if (this.#ctx.curDebugMode === 'polygons') {
      emitDebugPolygonOutline(this, this.#ctx, pts, count, true)
    }
  }

  /**
   * Whether `geo` can draw through the retained `coloredTri` pipeline right
   * now: the geometry opted into a static GPU upload, no bitmap clip mask is
   * active (the retained shader has no mask sampler), and the debug mode is
   * normal (the retained shader has no debug recolor). Shared by `fillPath2D`
   * and `shadowPath2D`'s inset branch, the two callers that have both a
   * retained and a streamed `coloredTri` path to choose between.
   */
  #canDrawRetained(geo: GeometryHandle, ownRun: boolean): boolean {
    if (
      this.#ctx.stateStack.getClipMask() !== null ||
      this.#ctx.curDebugMode !== 'normal'
    ) {
      return false
    }
    // Geometry not registered to be kept is kept only where its draw is a run
    // of its own anyway, so keeping it costs no extra draw call.
    if (geo.retained !== true && !ownRun) return false
    return this.#coloredTri.retains(geo)
  }

  fillPath2D(path: Path2D, fill: GfxFill): void {
    const geo = getPathTessellation(path)
    if (!geo) {
      // Direct-Path2D fallback. The triangulator needs the `d` string which
      // isn't recoverable from a Path2D at runtime, so nodes that construct
      // Path2Ds outside `SvgPathMap` must call `registerPathTessellation`
      // explicitly.
      this.unimplemented.fillPath2D++
      return
    }
    // Retained geometry GPU-transforms a once-uploaded static buffer, saving
    // the per-vertex CPU transform, for a flat fill, a linear gradient, or an
    // inset path-shadow mask alike. The retained shader carries neither the
    // bitmap clip mask's sampler nor the debug recolor, so a bitmap clip or a
    // non-normal debug mode falls back to the streamed path (identical pixels
    // either way, just a repeated per-vertex CPU transform). The analytic
    // clip is not one of them: the retained shader reads the same group-0
    // clip block, so `setClip` composes without giving up the fast path.
    // The retained shader has no radial mode.
    const radial = typeof fill !== 'string' && fill.kind === 'radial'
    // A flat fill joins its neighbours, and so does a gradient fill another
    // fill drew with the frame before, so only an unshared gradient is a run of
    // its own.
    const ownRun =
      typeof fill !== 'string' &&
      fill.kind === 'linear' &&
      geo.indices.length >= RETAIN_FILL_INDICES &&
      !this.#gradientFills.shared(fill)
    if (!radial && this.#canDrawRetained(geo, ownRun)) {
      this.#coloredTri.fillTessellationRetained(this.#ctx, geo, fill)
    } else {
      this.#coloredTri.fillTessellation(this.#ctx, geo, fill)
    }
    if (this.#ctx.curDebugMode === 'polygons') {
      // fillPath2D can render multiple sub-paths, walk the contour list
      // registered with the tessellation so the outline matches the fill.
      const contours = getPathContours(path)
      if (contours) {
        for (let i = 0; i < contours.length; i++) {
          const c = contours[i]
          emitDebugPolygonOutline(
            this,
            this.#ctx,
            c,
            c.length / 2,
            getContourClosed(path, i),
          )
        }
      }
    }
  }

  fillPath(path: GfxPath, fill: GfxFill, rule: FillRule = 'nonzero'): void {
    if (path.released || path.isEmpty) return
    const flat = path.flatten(this.#flattenTolerance())
    if (flat.pointCount < 3) return
    // A convex outline has no overlap to resolve, so it skips the stencil.
    if (flat.convex) {
      this.fillConvexPoly(flat.points, flat.pointCount, fill)
      return
    }
    if (!this.#stencilEnabled) {
      this.#fillPathWithoutStencil(flat, fill)
      return
    }
    if (rule === 'nonzero' && flat.contourCount >= 16) {
      diagnostics.report(
        'SG2004',
        'a nonzero fill with 16 or more contours can lose coverage where 16 contours wind the same way over one point',
      )
    }
    this.#coloredTri.fillStencilPath(
      this.#ctx,
      flat,
      rule,
      fill,
      this.#viewW(),
      this.#viewH(),
    )
  }

  strokePath(path: GfxPath, style: GfxStrokeStyle): void {
    if (path.released || path.isEmpty) return
    const tol = this.#flattenTolerance()
    const dash = style.dash
    const dashed = dash !== undefined && dash.length > 0
    // A gradient, or caps and joins the default stroker cannot draw, are drawn
    // as the filled union of the stroke's pieces.
    const geometric =
      (style.align === undefined || style.align === 'center') &&
      (typeof style.color !== 'string' || style.exactJoins === true)
    // The pieces depend on the path and the stroke's shape, not on its paint or
    // transform, so a path stroked the same way frame after frame builds them
    // once.
    let pieceKey: string | null = null
    if (geometric) {
      pieceKey = this.#strokeDraw.strokePieces.keyFor(
        path,
        `${path.version}|${Math.round(-2 * Math.log2(tol))}|${style.width}|${style.cap}|${style.join}|${style.miterLimit}|${style.dash?.join(',')}|${style.dashOffset}`,
      )
      const hit = this.#strokeDraw.strokePieces.get(pieceKey)
      if (hit) {
        this.fillPath(hit.path, style.color, 'nonzero')
        return
      }
      if (!this.#strokeDraw.strokePieces.admit(pieceKey)) pieceKey = null
    }
    const flat = path.flatten(tol)
    const fillPieces = pieceKey !== null ? new GfxPath() : this.#strokeFill
    if (geometric) fillPieces.clear()
    let closedStyle: GfxStrokeStyle | null = null
    const openStyle: GfxStrokeStyle = dashed
      ? { ...style, dash: undefined, closed: false }
      : style
    const emit = (
      pts: Float32Array,
      first: number,
      len: number,
      closed: boolean,
    ): void => {
      if (geometric) {
        appendStrokeFill(
          fillPieces,
          pts,
          first,
          len,
          closed,
          style.width,
          style.cap ?? 'butt',
          style.join ?? 'miter',
          style.miterLimit ?? DEFAULT_MITER_LIMIT,
          tol,
        )
      } else {
        const sub = pts.subarray(first * 2, (first + len) * 2)
        this.strokePolyline(
          sub,
          len,
          closed ? (closedStyle ??= { ...style, closed: true }) : openStyle,
        )
      }
    }
    // One group for the whole path, so contours that cross each other do not
    // blend twice where they overlap.
    let grouped = false
    if (
      !geometric &&
      !this.#strokeDraw.needsOutline(style) &&
      this.#strokeDraw.strokeNeedsStencil(
        style as SolidStrokeStyle,
        dashed ? 2 : flatSegments(flat),
      )
    ) {
      grouped = true
      this.#strokeDraw.pathGroup = true
      this.#ctx.beginStencilGroup()
    }
    for (let c = 0; c < flat.contourCount; c++) {
      const s0 = flat.starts[c]
      const len = flat.starts[c + 1] - s0
      if (len < 1) continue
      const closed = flat.closed[c] === 1
      if (dashed) {
        const buf = this.#dashBuffer
        buf.clear()
        buf.cut(flat.points, s0, len, closed, dash, style.dashOffset ?? 0)
        for (let d = 0; d < buf.dashCount; d++) {
          const a = buf.starts[d]
          const n = buf.starts[d + 1] - a
          if (n >= 1) emit(buf.points, a, n, false)
        }
        continue
      }
      emit(flat.points, s0, len, closed)
    }
    if (grouped) {
      this.#ctx.endStencilGroup()
      this.#strokeDraw.pathGroup = false
    }
    if (geometric && !fillPieces.isEmpty) {
      this.fillPath(fillPieces, style.color, 'nonzero')
      if (pieceKey !== null) {
        this.#strokeDraw.strokePieces.add(pieceKey, {
          path: fillPieces,
          bytes: fillPieces.flatten(tol).pointCount * 8,
          release: () => fillPieces.release(),
        })
      }
    }
  }

  /** Curve flattening tolerance in path units: a quarter device pixel. */
  #flattenTolerance(): number {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    // The larger axis scale, so a curve stretched along one axis still stays
    // within a quarter pixel there.
    const scale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d))
    return 0.25 / Math.max(scale, 1e-4)
  }

  /**
   * Fill for a target without stencil bits: earcut, which fills even-odd and
   * cannot honor the nonzero rule.
   */
  #fillPathWithoutStencil(flat: FlatPath, fill: GfxFill): void {
    diagnostics.report(
      'SG2005',
      'this surface has no stencil buffer, so fillPath fills even-odd and ignores the nonzero rule',
    )
    const contours: Float32Array[] = []
    for (let c = 0; c < flat.contourCount; c++) {
      const s0 = flat.starts[c]
      const len = flat.starts[c + 1] - s0
      if (len >= 3) contours.push(flat.points.slice(s0 * 2, (s0 + len) * 2))
    }
    if (contours.length === 0) return
    this.#coloredTri.fillTessellation(
      this.#ctx,
      tessellateContours(contours),
      fill,
    )
  }

  fillCircleRadialGradient(
    cx: number,
    cy: number,
    r: number,
    stops: readonly GfxGradientStop[],
  ): void {
    this.#gradientFills.fillCircleRadialGradient(cx, cy, r, stops)
  }

  drawShaderQuad(
    quad: ShaderQuad,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    this.#gradientFills.drawShaderQuad(quad, x, y, w, h)
  }

  fillMaskedRadialGradient(
    mask: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    gcx: number,
    gcy: number,
    gr: number,
    stops: readonly GfxGradientStop[],
  ): void {
    this.#gradientFills.fillMaskedRadialGradient(
      mask,
      dx,
      dy,
      dw,
      dh,
      gcx,
      gcy,
      gr,
      stops,
    )
  }

  fillPolyLinearGradient(
    pts: ArrayLike<number>,
    count: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colorStart: string,
    colorEnd: string,
  ): void {
    this.#gradientFills.fillPolyLinearGradient(
      pts,
      count,
      x0,
      y0,
      x1,
      y1,
      colorStart,
      colorEnd,
    )
  }

  // --- Gfx2D: shadows --------------------------------------------------------

  shadowRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    style: GfxShadowStyle,
    smoothing = 0,
  ): void {
    this.#resolveCorners(radii, w, h, smoothing)
    // The analytic shadow has circular corners. A smoothed corner's shadow
    // uses the circular radius that cuts the same area off the corner.
    for (let i = 0; i < 4; i++) {
      if (this.#cornerSmoothing[i] > 0) {
        this.#radii[i] *= squircleShadowRadiusScale(this.#cornerSmoothing[i])
      }
    }
    this.#shape.shadowRoundRect(this.#ctx, x, y, w, h, this.#radii, style)
  }

  shadowCircle(cx: number, cy: number, r: number, style: GfxShadowStyle): void {
    this.#shape.shadowCircle(this.#ctx, cx, cy, r, style)
  }

  shadowPath2D(path: Path2D, style: GfxShadowStyle): void {
    this.#pathShadows.shadowPath2D(path, style)
  }

  warmPathShadows(factors: readonly number[]): void {
    this.#pathShadows.warmPathShadows(factors)
  }

  get pendingPathShadowWarmups(): number {
    return this.#pathShadows.pendingPathShadowWarmups
  }

  processPendingShadowBakes(): void {
    this.#pathShadows.processPendingShadowBakes()
  }

  // --- Gfx2D: strokes ------------------------------------------------------

  strokeCircle(cx: number, cy: number, r: number, style: GfxStrokeStyle): void {
    this.#strokeDraw.strokeCircle(cx, cy, r, style)
  }

  strokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    this.#strokeDraw.strokeLine(x0, y0, x1, y1, style)
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
    this.#strokeDraw.strokeQuadratic(x0, y0, cx, cy, x1, y1, style)
  }

  strokePolyline(
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void {
    this.#strokeDraw.strokePolyline(pts, count, style)
  }

  strokePath2D(path: Path2D, style: GfxStrokeStyle): void {
    this.#strokeDraw.strokePath2D(path, style)
  }

  replaySource(token: object | null): void {
    this.#strokeDraw.replaySource(token)
  }

  /** What the caches that keep drawing work between frames hold and did. */
  cacheStats(): RetainedCacheStats[] {
    const stats = [
      this.#stroke.cache.stats,
      this.#coloredTri.geometryCache.stats,
      this.#strokeDraw.strokePieces.stats,
      this.#strokeDraw.outlines.stats,
    ]
    const layers = this.#effects.layerStats()
    if (layers) stats.push(layers)
    return stats
  }

  /** Frames begun so far, for the retained caches. */
  #frameNo = 0

  streamedBytes(): number {
    return this.#ctx.streamedWords() * 4
  }

  /** Resolved corner radii of the round rect being drawn, reused across calls. */
  readonly #radii: [number, number, number, number] = [0, 0, 0, 0]
  /** Each corner's fitted smoothing for the round rect being drawn. */
  readonly #cornerSmoothing: [number, number, number, number] = [0, 0, 0, 0]

  // --- Gfx2D: images and text ----------------------------------------------

  drawImage(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    opts?: GfxImageOptions,
  ): void {
    this.#imageDraw.drawImage(img, dx, dy, dw, dh, opts)
  }

  warmText(text: string, style?: GfxTextStyle): void {
    this.#textDraw.warmText(text, style)
  }

  fillText(text: string, x: number, y: number, style?: GfxTextStyle): void {
    this.#textDraw.fillText(text, x, y, style)
  }

  #updateProjection(w: number, h: number): void {
    // Device-px -> clip with Y-flip.
    // clip.x = 2 * x / w - 1
    // clip.y = 1 - 2 * y / h
    // As a column-major mat3:
    //   col 0: [2/w, 0, 0]
    //   col 1: [0, -2/h, 0]
    //   col 2: [-1, 1, 1]
    const p = this.#ctx.projMat
    p[0] = 2 / w
    p[1] = 0
    p[2] = 0
    p[3] = 0
    p[4] = -2 / h
    p[5] = 0
    p[6] = -1
    p[7] = 1
    p[8] = 1
  }
}
