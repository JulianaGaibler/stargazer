import { createEmitter, type Emitter } from '../events/Emitter'
import type { Engine } from '../engine/Engine'
import type { CameraView2D } from '../camera/CameraView2D'
import type { Stage } from '../render/Stage'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { BitmapMask } from '../assets/BitmapMask'
import { DebugCamera } from './DebugCamera'
import { DebugCamera3D } from './DebugCamera3D'
import { FrameStats } from './FrameStats'
import type { CameraView3D } from '../camera/CameraView3D'
import type { Node3D } from '../scene/Node3D'
import type { DebugLine3DRenderer } from '../render/gfx/DebugLine3DRenderer'
import type { RenderQuality } from '../render/RenderQuality'
import { walkTree } from '../scene/traverse'
import {
  snapshotPhysics,
  snapshotStageChips,
  snapshotWorld3d,
  stageById,
  stageIdOf,
  worldsForStage,
  type ActivePointerReadout,
  type DebugGpuStatsReadout,
  type DebugStatsSnapshot,
  type PhysicsWorldReadout,
  type StageChip,
} from './DebugSnapshot'
import { drawGrid } from './DebugGridRenderer'
import { drawNodeOutlines } from './DebugOutlineRenderer'
import { drawLayoutOutlines } from './DebugLayoutRenderer'
import { viewFor } from '../scene/viewFor'
import { drawPointerOverlay } from './DebugPointerRenderer'
import {
  drawPhysicsOverlay,
  type PhysicsOverlayFlags,
} from './DebugPhysicsRenderer'
import type { Node } from '../scene/Node'
import type { Node2D } from '../scene/Node2D'
import { get, writable, type Readable } from 'svelte/store'
import type { Component } from 'svelte'
import {
  WorldAccents,
  drawClipMaskOverlay,
  drawGameCameraRect,
  drawNodeHighlight,
  pushMeshBounds,
  pushMeshWireframes,
  pushNodeHighlight3D,
} from './DebugOverlay'

/**
 * Which camera drives the debug view. `active` is the engine's normal cameras,
 * no override. `debug-2d` swaps in the free 2D pan/zoom camera. `debug-3d`
 * swaps in the free 3D fly camera. The grid, outlines, and camera pad follow
 * the selected mode's space.
 */
export type DebugCameraMode = 'active' | 'debug-2d' | 'debug-3d'

/**
 * Debug render view for the 3D mesh pass. `normal` is the shaded scene,
 * `wireframe` overlays triangle edges, `unshaded` shows flat albedo (no
 * lighting), and `normals` colors fragments by world normal.
 */
export type MeshRenderMode =
  'normal' | 'wireframe' | 'unshaded' | 'normals' | 'ao'

/** Current on/off state of every debug toggle, emitted on the `toggle` event. */
export interface DebugToggleState {
  hud: boolean
  camera: boolean
  /** Space the debug camera / grid / pad act on. */
  space: '2d' | '3d'
  /** The selected camera mode (drives the HUD dropdown). */
  cameraMode: DebugCameraMode
  /** The selected 3D render view (drives the HUD dropdown). */
  renderMode: MeshRenderMode
  outlines: boolean
  layoutOutlines: boolean
  follow: boolean
  grid: boolean
  paused: boolean
  pointerOverlay: boolean
  physics: PhysicsOverlayFlags
  /** Whether the fly camera currently holds the pointer lock (mouse-look on). */
  flyPointerLocked: boolean
}

/** The plain on/off switches of {@link DebugToggleState}. */
type DebugFlag =
  'outlines' | 'layoutOutlines' | 'follow' | 'grid' | 'pointerOverlay'

export type {
  ActivePointerReadout,
  DebugGpuStatsReadout,
  DebugStatsSnapshot,
  PhysicsWorldReadout,
  StageChip,
}

/** Event map for {@link DebugController.events}. */
export interface DebugEvents {
  toggle: DebugToggleState
  /**
   * Emitted when `setActiveStage` (or auto-cleanup on detach) changes
   * selection.
   */
  stageChanged: { activeStageId: string }
}

/**
 * Initial toggle state for a {@link DebugController}. Everything defaults to
 * off.
 */
export interface DebugControllerOptions {
  /** Show the HUD on construction. */
  showHud?: boolean
  /** Draw node outlines on construction. */
  showOutlines?: boolean
  /** Draw the world grid on construction. */
  showGrid?: boolean
}

/**
 * Consumer-supplied panel spec. Passed to `DebugController.registerPanel` to
 * append a section to the HUD without any stargazer -> game coupling.
 *
 * The `component` is instantiated by `DebugHud.svelte` inside a `DebugSection`
 * wrapper. It receives `debug: DebugController` as a prop plus anything the
 * caller spreads via `props`. Prop-type correctness is the caller's
 * responsibility, we deliberately widen `props` to `Record<string, unknown>`
 * here so the stargazer stays generic.
 */
export interface DebugPanelSpec {
  /**
   * Stable id, used for keying + deregistration. Must be unique across
   * registered panels. A re-register with the same id replaces the previous
   * entry.
   */
  id: string
  /** Header text shown at the top of the panel's `DebugSection`. */
  title: string
  /**
   * Sort key. Panels sort ascending by `order` (default `Infinity` ->
   * registration-order append). Reserve values for stable ordering across
   * dynamic registers/unregisters.
   */
  order?: number
  /** Svelte component to instantiate inside the panel's section. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: Component<any>
  /** Optional prop bag spread alongside `debug` when instantiating. */
  props?: Record<string, unknown>
}

/**
 * Central controller for engine debug tooling. Every engine host has one, and
 * the `debug` option or URL flag only decides whether the HUD starts open.
 *
 * The `activeStage` concept scopes stage-per-stage UI: sections (Coordinates,
 * Camera, Scene, Scene tree, Camera pad) show data for the selected stage.
 * Global sections (Performance, Pause) are unaffected. Pointer sections follow
 * the active stage's `InputSystem`, when it has one, its pointers show up in
 * the readouts. When it doesn't, the section shows a hint.
 */
export class DebugController {
  readonly camera: DebugCamera
  /** CPU work-time per frame (headroom). Drives the frame graph + `CPU pXX`. */
  readonly frameStats: FrameStats
  /** Real (post-cap) frame interval per frame. Drives the actual FPS readout. */
  readonly #frameIntervalStats = new FrameStats(300)
  readonly events: Emitter<DebugEvents>
  /** Read-only handle for HUD components that need scene / input access. */
  readonly engine: Engine

  /**
   * HUD visibility, backed by a Svelte writable so external components (like a
   * settings menu) can subscribe to changes without wiring the `toggle` event
   * by hand. `toggleHud()` / `setHudVisible()` both write here, and the
   * `hudVisible` getter reads `get(store)` synchronously for plain-JS callers.
   */
  readonly #hudVisibleStore = writable<boolean>(false)
  /** Reactive HUD visibility, subscribe from Svelte with `$`. */
  readonly hudVisible$: Readable<boolean> = this.#hudVisibleStore
  #_cameraActive = false
  readonly #flags: Record<DebugFlag, boolean> = {
    outlines: false,
    layoutOutlines: false,
    follow: false,
    grid: false,
    pointerOverlay: false,
  }
  /**
   * Which space the debug camera, grid, and camera pad act on. One mode at a
   * time, so the 2D and 3D grids never draw together and the pad/keys drive the
   * matching debug camera.
   */
  #_debugSpace: '2d' | '3d' = '2d'
  /** 3D fly-camera, created lazily the first time 3D mode's camera activates. */
  #debugCamera3d: DebugCamera3D | null = null
  /** Whether the pointer is locked to the canvas for fly-camera mouse-look. */
  #_flyPointerLocked = false
  /** 3D node whose bounds the gizmo pass highlights, driven by the Scene panel. */
  #highlightedNode3d: Node3D | null = null
  #_physicsFlags: PhysicsOverlayFlags = {
    colliders: false,
    aabbs: false,
    contacts: false,
    velocities: false,
  }
  /** Cached OR of `_physicsFlags`, so `drawOverlay` is one test when all off. */
  #_physicsAny = false
  readonly #worldAccents = new WorldAccents()
  /** Node whose bounds the overlay highlights, driven by the Scene panel. */
  #highlightedNode: Node2D | null = null
  #_activeStage: Stage | null = null // null -> primary

  #_pointerScreen: { x: number; y: number } | null = null

  /**
   * Currently-inspected clip mask, surfaced in the HUD via the `'clip-mask'`
   * render mode as a translucent red overlay. Set by the game session (or any
   * consumer holding the same `BitmapMask` used by `GridOverlayNode`). Null
   * when nothing is registered.
   */
  #_inspectedMask: BitmapMask | null = null

  readonly #disposeCallbacks: Array<() => void> = []

  /**
   * Registered consumer panels, surfaced to `DebugHud.svelte` for
   * append-after-built-ins rendering. Backed by a Svelte writable so the HUD's
   * `#each` re-runs whenever a panel registers or unregisters. Sort-by-`order`
   * happens on read (see the `panels` getter).
   */
  readonly #panelsStore = writable<DebugPanelSpec[]>([])
  /**
   * Public readable view of the registered-panels list. Sorted ascending by
   * `order` (unset = `Infinity`, keeping ordered panels first and
   * registration-order for the rest).
   */
  readonly panels: Readable<DebugPanelSpec[]> = this.#panelsStore

  constructor(engine: Engine, opts: DebugControllerOptions = {}) {
    this.engine = engine
    this.camera = new DebugCamera(engine.currentCamera2D)
    this.frameStats = new FrameStats(300)
    this.events = createEmitter<DebugEvents>()

    this.#hudVisibleStore.set(opts.showHud ?? false)
    this.#flags.outlines = opts.showOutlines ?? false
    this.#flags.grid = opts.showGrid ?? false

    const onKeyDown = (e: KeyboardEvent): void => this.#onKeyDown(e)
    const onKeyUp = (e: KeyboardEvent): void => this.#onKeyUp(e)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    this.#disposeCallbacks.push(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    })

    // Pointer tracking, primary canvas only (secondaries have no input).
    const canvas = engine.canvas
    const onPointerMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect()
      this.#_pointerScreen = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }
    const onPointerLeave = (): void => {
      this.#_pointerScreen = null
    }
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('pointercancel', onPointerLeave)
    this.#disposeCallbacks.push(() => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('pointercancel', onPointerLeave)
    })

    // Fly-camera mouse-look via Pointer Lock. A mouse press on the canvas while
    // the 3D fly camera is active requests the lock (cursor hidden, unlimited
    // turning). We hook `pointerdown`, not `click`: the InputSystem calls
    // `preventDefault` + `setPointerCapture` on canvas `pointerdown`, which
    // suppresses the synthetic `click`. A separate bubble-phase listener still
    // fires (InputSystem does not stopPropagation), and `pointerdown` is a valid
    // user gesture for the lock request. Non-mouse pointers keep the touch pad.
    const onLockPointerDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return
      if (!this.camera3dActive || this.#_flyPointerLocked) return
      // May reject during the browser's brief post-Esc lock-out, or if the
      // gesture is stale. Swallow it rather than spamming the console.
      const p = canvas.requestPointerLock() as unknown as
        Promise<void> | undefined
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
    const onLockError = (): void => {
      this.#_flyPointerLocked = false
    }
    // While locked the browser reports raw motion through `movementX/Y`. The fly
    // camera is created lazily, so null-guard it.
    const onLockMove = (e: MouseEvent): void => {
      if (this.#_flyPointerLocked)
        this.#debugCamera3d?.look(e.movementX, e.movementY)
    }
    const onLockChange = (): void => {
      this.#_flyPointerLocked = document.pointerLockElement === canvas
      // Esc unlocks but stays in fly mode. Drop any held sprint so the camera
      // does not keep sprinting after the mouse releases.
      if (!this.#_flyPointerLocked) this.#debugCamera3d?.setSprint(false)
      this.#emitToggle()
    }
    // Scroll adjusts the persistent fly speed while the 3D fly camera is active.
    const onWheel = (e: WheelEvent): void => {
      if (!this.camera3dActive || !this.#debugCamera3d) return
      this.#debugCamera3d.adjustSpeedMultiplier(e.deltaY)
      e.preventDefault()
    }
    canvas.addEventListener('pointerdown', onLockPointerDown)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('mousemove', onLockMove)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onLockError)
    this.#disposeCallbacks.push(() => {
      canvas.removeEventListener('pointerdown', onLockPointerDown)
      canvas.removeEventListener('wheel', onWheel)
      document.removeEventListener('mousemove', onLockMove)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('pointerlockerror', onLockError)
    })

    // Releasing focus (tab switch, window blur) can strand held keys and the
    // pointer lock. Clear movement, sprint, and the lock so the camera does not
    // fly off on its own while the tab is hidden.
    const onDefocus = (): void => {
      this.#debugCamera3d?.clearKeys()
      this.#exitPointerLock()
    }
    document.addEventListener('visibilitychange', onDefocus)
    window.addEventListener('blur', onDefocus)
    this.#disposeCallbacks.push(() => {
      document.removeEventListener('visibilitychange', onDefocus)
      window.removeEventListener('blur', onDefocus)
    })

    // Camera step runs BEFORE input reprojection so a WASD-panning debug
    // camera doesn't drag pointer state behind by one frame. Sized against
    // the active stage so pan feel is consistent regardless of canvas.
    const offBefore = engine.onBeforeFrame((dt) => {
      if (!this.#_cameraActive) return
      if (this.#_debugSpace === '2d') {
        const active = this.activeStage
        this.camera.setPixelSize(
          active.renderer.cssSize.w,
          active.renderer.cssSize.h,
        )
        this.camera.step(dt)
      } else if (this.#debugCamera3d) {
        this.#debugCamera3d.step(dt)
      }
    })
    // Frame-time sample: push the CPU work-time recorded by
    // `Engine.frame`, NOT the rAF `dt` (which is locked to the vsync
    // interval ~16.67 ms at 60 Hz regardless of actual work). See
    // `engine.lastFrameWorkSec` for the derivation. This is the value
    // that answers "did this frame have headroom or is it right at
    // budget?", the vsync-locked dt can't distinguish the two.
    const offFrame = engine.ticker.onFrame(() => {
      this.frameStats.push(engine.lastFrameWorkSec)
      // Actual FPS comes from the true frame interval (`ticker.rawDt`):
      // unsmoothed and unclamped, so a genuinely slow frame reads as a low rate.
      // The callback's `dt` argument is the smoothed + `maxDt`-clamped
      // simulation delta and would floor the readout at `1 / maxDt` (30 FPS).
      this.#frameIntervalStats.push(engine.ticker.rawDt)
    })
    this.#disposeCallbacks.push(offBefore, offFrame)
  }

  /**
   * Register a consumer-supplied panel for the HUD to render below its built-in
   * sections. Returns an unregister function. Call it when the consumer
   * unmounts (usually from a `$effect` cleanup) so the panel doesn't outlive
   * its own state.
   *
   * Re-registering the same `id` replaces the previous spec, safe to call
   * inside a reactive effect whose deps change.
   */
  registerPanel(spec: DebugPanelSpec): () => void {
    this.#panelsStore.update((list) => {
      const without = list.filter((p) => p.id !== spec.id)
      const next = [...without, spec]
      // Sort by `order` (undefined = Infinity so unordered panels append
      // in registration order after any explicitly-ordered ones).
      next.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
      return next
    })
    return () => {
      this.#panelsStore.update((list) => list.filter((p) => p.id !== spec.id))
    }
  }

  /** Whether the HUD is open. */
  get hudVisible(): boolean {
    return get(this.#hudVisibleStore)
  }
  /** Whether the debug camera is the one drawing. */
  get cameraActive(): boolean {
    return this.#_cameraActive
  }
  /** Whether node bounds are outlined. */
  get outlinesVisible(): boolean {
    return this.#flags.outlines
  }
  /** Whether layout boxes are outlined. */
  get layoutOutlinesVisible(): boolean {
    return this.#flags.layoutOutlines
  }
  /** Whether the debug camera follows the game camera. */
  get followGameCamera(): boolean {
    return this.#flags.follow
  }
  /** Whether the world grid is drawn. */
  get gridVisible(): boolean {
    return this.#flags.grid
  }
  /** Whether active pointers are drawn on the canvas. */
  get pointerOverlayVisible(): boolean {
    return this.#flags.pointerOverlay
  }
  /** Whether the engine is paused. */
  get paused(): boolean {
    return this.engine.paused
  }
  /** Live 3D rendering-quality settings. The Rendering panel overrides these. */
  get quality(): RenderQuality {
    return this.engine.quality
  }
  /** The clip mask shown by the `clip-mask` render mode, or `null`. */
  get inspectedMask(): BitmapMask | null {
    return this.#_inspectedMask
  }
  /**
   * Register the clip mask to visualise under the `'clip-mask'` render mode.
   * Session-side wiring: call once with the same `BitmapMask` passed to
   * `GridOverlayNode`. Passing `null` clears.
   */
  setInspectedMask(mask: BitmapMask | null): void {
    this.#_inspectedMask = mask
  }
  /**
   * The stage currently being inspected. Defaults to the primary. The HUD's
   * chip strip drives it via `setActiveStage`.
   */
  get activeStage(): Stage {
    return this.#_activeStage ?? this.engine.primaryStage
  }
  /** Whether the stage the HUD acts on is the primary stage. */
  get activeIsPrimary(): boolean {
    return this.#_activeStage === null
  }

  /**
   * Point the HUD at a different stage. Pass `null` for the primary. Retargets
   * the debug camera so `follow` / `reset` behave against the new stage's game
   * camera.
   */
  setActiveStage(stage: Stage | null): void {
    if (this.#_activeStage === stage) return
    // Do not keep the mouse captured across a stage switch (the fly camera
    // retargets to the new stage).
    this.#exitPointerLock()
    // Passing the primary stage explicitly normalises to null.
    if (stage === this.engine.primaryStage) stage = null
    this.#_activeStage = stage
    const active = this.activeStage
    this.camera.setGameCamera(active.currentCamera2D)
    if (this.#_cameraActive) {
      this.camera.reset()
      this.camera.setPixelSize(
        active.renderer.cssSize.w,
        active.renderer.cssSize.h,
      )
    }
    this.events.emit('stageChanged', {
      activeStageId: stageIdOf(this.engine, active),
    })
  }

  /**
   * Notify the controller that a secondary stage was detached. If it was the
   * active one, snap back to the primary. Called by `Engine.detachStage`.
   */
  onStageDetached(stage: Stage): void {
    if (this.#_activeStage !== stage) return
    this.#exitPointerLock()
    this.#_activeStage = null
    this.camera.setGameCamera(this.engine.primaryStage.currentCamera2D)
    if (this.#_cameraActive) {
      this.camera.reset()
    }
    this.events.emit('stageChanged', { activeStageId: 'primary' })
  }

  /** Open the HUD when it is closed, close it when it is open. */
  toggleHud(): void {
    this.setHudVisible(!this.hudVisible)
  }

  /**
   * Set HUD visibility deterministically. No-op if already at the target value,
   * cheap to call from a `$effect` that mirrors a store.
   */
  setHudVisible(visible: boolean): void {
    if (visible === this.hudVisible) return
    this.#hudVisibleStore.set(visible)
    this.#emitToggle()
  }

  /**
   * Toggle the debug camera for the current {@link DebugController.debugSpace}.
   * In 2D mode it swaps in the pan/zoom `DebugCamera`. In 3D mode the fly
   * `DebugCamera3D`. Only one is ever active, matching the space.
   */
  toggleCamera(): void {
    this.#_cameraActive = !this.#_cameraActive
    if (this.#_cameraActive) this.#prepareDebugCamera()
    else this.#stopDebugCameras()
    this.#emitToggle()
  }

  /** The space the debug camera / grid / pad currently act on. */
  get debugSpace(): '2d' | '3d' {
    return this.#_debugSpace
  }

  /**
   * Switch the debug space (2D pan/zoom vs 3D fly). Carries an active debug
   * camera across: the old space's camera stops, the new space's camera engages
   * and snaps to its game camera.
   */
  setDebugSpace(space: '2d' | '3d'): void {
    if (this.#_debugSpace === space) return
    this.#_debugSpace = space
    if (this.#_cameraActive) {
      this.#stopDebugCameras()
      this.#prepareDebugCamera()
    }
    this.#emitToggle()
  }

  /** Switch the debug camera between 2D and 3D. */
  toggleDebugSpace(): void {
    this.setDebugSpace(this.#_debugSpace === '2d' ? '3d' : '2d')
  }

  #_renderMode: MeshRenderMode = 'normal'

  /** The selected 3D render view. See {@link MeshRenderMode}. */
  get renderMode(): MeshRenderMode {
    return this.#_renderMode
  }

  /** Select the 3D render view (the HUD dropdown's setter). */
  setRenderMode(mode: MeshRenderMode): void {
    if (mode === this.#_renderMode) return
    this.#_renderMode = mode
    this.#emitToggle()
  }

  /**
   * Mesh-shader debug mode uniform: 0 = normal/wireframe, 1 = unshaded, 2 =
   * normals.
   */
  get meshShaderMode(): number {
    return this.#_renderMode === 'unshaded'
      ? 1
      : this.#_renderMode === 'normals'
        ? 2
        : this.#_renderMode === 'ao'
          ? 3
          : 0
  }

  /** The camera driving the debug view. See `DebugCameraMode`. */
  get cameraMode(): DebugCameraMode {
    if (!this.#_cameraActive) return 'active'
    return this.#_debugSpace === '3d' ? 'debug-3d' : 'debug-2d'
  }

  /**
   * Select the debug view camera. `active` clears any debug camera. `debug-2d`
   * / `debug-3d` engage the free camera for that space (and set the space so
   * the grid + pad follow). This is the HUD dropdown's setter.
   */
  setCameraMode(mode: DebugCameraMode): void {
    if (mode === this.cameraMode) return
    if (mode === 'active') {
      this.#stopDebugCameras()
      this.#_cameraActive = false
    } else {
      const space = mode === 'debug-3d' ? '3d' : '2d'
      // Switching directly between 2D and 3D debug: drop the old camera's keys.
      if (this.#_cameraActive && this.#_debugSpace !== space)
        this.#stopDebugCameras()
      this.#_debugSpace = space
      this.#_cameraActive = true
      this.#prepareDebugCamera()
    }
    this.#emitToggle()
  }

  /** Engage the current-space debug camera against the active stage. */
  #prepareDebugCamera(): void {
    const active = this.activeStage
    if (this.#_debugSpace === '2d') {
      this.camera.setGameCamera(active.currentCamera2D)
      this.camera.reset()
      this.camera.setPixelSize(
        active.renderer.cssSize.w,
        active.renderer.cssSize.h,
      )
    } else {
      if (!this.#debugCamera3d)
        this.#debugCamera3d = new DebugCamera3D(active.currentCamera3D)
      else this.#debugCamera3d.setGameCamera(active.currentCamera3D)
      this.#debugCamera3d.reset()
    }
  }

  #stopDebugCameras(): void {
    this.camera.clearKeys()
    this.#debugCamera3d?.clearKeys()
    this.#exitPointerLock()
  }

  /** Release the fly-camera pointer lock if this canvas currently holds it. */
  #exitPointerLock(): void {
    if (document.pointerLockElement === this.engine.canvas)
      document.exitPointerLock()
  }

  /**
   * Route a camera-pad button to the current-space debug camera, auto-engaging
   * it on the first press so the pad works without first toggling the camera.
   * `code` is a `KeyW`/`KeyA`/… control key, `pressed` mirrors button down/up.
   */
  padKey(code: string, pressed: boolean): void {
    if (pressed && !this.#_cameraActive) this.toggleCamera()
    this.#routeCameraKey(code, pressed)
  }

  /** Feed a key to the current-space debug camera. Returns whether it took it. */
  #routeCameraKey(code: string, pressed: boolean): boolean {
    if (this.#_debugSpace === '2d') {
      if (!DebugCamera.isControlKey(code)) return false
      this.camera.setKey(code, pressed)
      return true
    }
    if (!this.#debugCamera3d || !DebugCamera3D.isControlKey(code)) return false
    this.#debugCamera3d.setKey(code, pressed)
    return true
  }

  /** Turn the node bounds outlines on or off. */
  toggleOutlines(): void {
    this.#toggleFlag('outlines')
  }

  /** Turn the layout box outlines on or off. */
  toggleLayoutOutlines(): void {
    this.#toggleFlag('layoutOutlines')
  }

  /** Turn following of the game camera on or off. */
  toggleFollow(): void {
    this.camera.setFollow(!this.#flags.follow)
    this.#toggleFlag('follow')
  }

  /** Turn the world grid on or off. */
  toggleGrid(): void {
    this.#toggleFlag('grid')
  }

  /** Pause the engine, or resume it when it is paused. */
  togglePause(): void {
    this.engine.setPaused(!this.engine.paused)
    this.#emitToggle()
  }

  /** Turn the active pointer overlay on or off. */
  togglePointerOverlay(): void {
    this.#toggleFlag('pointerOverlay')
  }

  /** Current physics overlay flags (read-only). */
  get physicsFlags(): Readonly<PhysicsOverlayFlags> {
    return this.#_physicsFlags
  }

  /**
   * Highlight a node's bounds in the overlay, or pass `null` to clear. The
   * Scene panel calls this as the selection changes.
   */
  setHighlightedNode(node: Node2D | null): void {
    this.#highlightedNode = node
  }

  /** The node currently highlighted in the overlay, or null. */
  get highlightedNode(): Node2D | null {
    return this.#highlightedNode
  }

  /**
   * Highlight any node from the unified scene tree, routing to the 2D overlay
   * or the 3D gizmo pass by the node's {@link Node.kind}. Selecting one clears
   * the other, so only the picked node outlines. The Scene panel calls this.
   */
  setHighlighted(node: Node | null): void {
    if (node && node.kind === '3d') {
      this.#highlightedNode3d = node as Node3D
      this.#highlightedNode = null
    } else if (node && node.kind === '2d') {
      this.#highlightedNode = node as Node2D
      this.#highlightedNode3d = null
    } else {
      this.#highlightedNode = null
      this.#highlightedNode3d = null
    }
  }

  /**
   * Overlay accent color of the world a node hosts (its
   * `PhysicsWorldBehavior`), or null when the node hosts none. The Scene panel
   * uses it to tint a world boundary the same color as the overlay.
   */
  overlayAccentForNode(node: Node2D): string | null {
    for (const entry of this.engine.physicsWorlds) {
      if (entry.spaceNode === node) return this.#worldAccents.get(entry.world)
    }
    return null
  }

  /** Flip one physics overlay layer on or off. */
  togglePhysics(key: keyof PhysicsOverlayFlags): void {
    this.#_physicsFlags[key] = !this.#_physicsFlags[key]
    const f = this.#_physicsFlags
    this.#_physicsAny = f.colliders || f.aabbs || f.contacts || f.velocities
    this.#emitToggle()
  }

  /** Put the debug cameras back to their starting view. */
  resetDebugCamera(): void {
    this.camera.reset()
    this.#debugCamera3d?.reset()
  }

  /**
   * Which camera renders `stage` this frame, the debug camera when the
   * active-debug-stage flag matches AND the debug camera is toggled on,
   * otherwise the stage's own game camera. Called by `Engine.frame()`.
   */
  activeCameraFor(stage: Stage): CameraView2D | null {
    return this.#_cameraActive &&
      this.#_debugSpace === '2d' &&
      stage === this.activeStage
      ? this.camera
      : stage.currentCamera2D
  }

  /** Whether the debug camera is engaged in 3D mode (fly-camera inspecting). */
  get camera3dActive(): boolean {
    return this.#_cameraActive && this.#_debugSpace === '3d'
  }

  /**
   * Which 3D camera renders `stage`'s world this frame: the 3D fly-camera when
   * the debug camera is active in 3D mode on the active stage, else the stage's
   * game `camera3d`. Mirrors {@link DebugController.activeCameraFor}.
   */
  activeCamera3dFor(stage: Stage): CameraView3D | null {
    return this.camera3dActive &&
      stage === this.activeStage &&
      this.#debugCamera3d
      ? this.#debugCamera3d
      : stage.currentCamera3D
  }

  /** Highlight a 3D node's bounds in the gizmo pass, or `null` to clear. */
  setHighlightedNode3d(node: Node3D | null): void {
    this.#highlightedNode3d = node
  }
  /** The 3D node the HUD is highlighting, or `null`. */
  get highlightedNode3d(): Node3D | null {
    return this.#highlightedNode3d
  }

  /** Read the frame times, counts and GPU numbers the HUD shows right now. */
  snapshotStats(): DebugStatsSnapshot {
    const p = this.frameStats.percentiles()
    const fi = this.#frameIntervalStats.percentiles()
    const active = this.activeStage
    let nodeCount = 0
    let aliveParticles = 0
    walkTree(active.tree.root, (node) => {
      if (node.kind !== '2d') return
      const n = node as Node2D
      nodeCount++
      aliveParticles += n.particleCount
    })
    // The active stage's "active" camera, debug or game depending on toggle.
    // Null when the stage has no current 2D camera (readouts fall back to zero).
    const cam = this.activeCameraFor(active)
    // Hover-pointer readout is primary-only (DebugController's own
    // pointermove listener is attached to engine.canvas). Active-pointer
    // sections follow the active stage's InputSystem instead.
    const ps = this.activeIsPrimary ? this.#_pointerScreen : null
    const pw = ps && cam ? cam.screenToWorld(ps.x, ps.y) : null
    const stageInput = active.input
    const activePointers: ActivePointerReadout[] = []
    if (stageInput) {
      for (const point of stageInput.pointers.values()) {
        activePointers.push({
          id: point.id,
          kind: point.kind,
          screen: { x: point.screen.x, y: point.screen.y },
          world: { x: point.world.x, y: point.world.y },
          capturedByNodeId: point.capturedBy?.id ?? null,
        })
      }
    }
    const gpu = { ...active.gpuStats }
    const physics = snapshotPhysics(
      worldsForStage(this.engine, active),
      this.#worldAccents,
    )
    const world3d = snapshotWorld3d(
      active,
      () => this.activeCamera3dFor(active),
      this.camera3dActive,
    )
    return {
      p50: p.p50,
      p95: p.p95,
      p99: p.p99,
      fps: fi.p50 > 0 ? 1 / fi.p50 : 0,
      max: p.max,
      count: p.count,
      nodeCount,
      compose: { ...active.composeStats },
      streamers: [...active.composeStreamers]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      caches: active.cacheStats(),
      composePainters: [...active.composePainters].sort((a, b) => b[1] - a[1]),
      composeTotals: { ...active.composeTotals },
      gpu,
      backend: active.backend,
      renderFailures: active.failures.list,
      cameraMode: this.#_cameraActive ? 'debug' : 'game',
      cameraFollowing: this.#flags.follow,
      viewport: cam ? { ...cam.viewport } : { x: 0, y: 0, width: 0, height: 0 },
      screenPxPerWorldUnit: cam?.screenPxPerWorldUnit() ?? 0,
      pointerScreen: ps ? { ...ps } : null,
      pointerWorld: pw,
      canvasCss: { ...active.renderer.cssSize },
      canvasDevice: { ...active.renderer.pixelSize },
      dpr: active.renderer.dpr,
      activePointers,
      touchSlopScreen: stageInput?.touchSlopScreen ?? 0,
      touchSlopWorld: stageInput?.touchSlopWorld ?? 0,
      aliveParticles,
      stages: snapshotStageChips(this.engine, this.#_activeStage),
      activeStageId: stageIdOf(this.engine, active),
      activeIsPrimary: this.activeIsPrimary,
      activeHasInput: stageInput !== null,
      physics,
      world3d,
      flyPointerLocked: this.#_flyPointerLocked,
      flySpeedMultiplier: this.#debugCamera3d?.speedMultiplier ?? 1,
    }
  }

  /**
   * Resolve a stage id (from `snapshotStats().stages[i].id`) back to the Stage
   * instance. Called by the HUD's chip strip on tap.
   */
  stageById(id: string): Stage | null {
    return stageById(this.engine, id)
  }

  /**
   * Draw the stage-scoped overlays (grid, outlines, game-camera pip) over
   * `stage`. Called by `Engine.frame()` on whichever stage is currently the
   * active-debug-stage. Baseline transform: CSS px for consistent line widths.
   */
  drawOverlay(stage: Stage, activeCamera: CameraView2D, gfx: Gfx2D): void {
    const { renderer } = stage
    const dpr = renderer.dpr

    // Clip-mask viz FIRST while we still have a clean state, we install
    // a world->device_pixel base transform for the fillRect + setClipMask
    // so the mask UVs computed inside `GpuGfx.fillRect` line up with the
    // mask's worldRect. Only active on GPU stages under `'clip-mask'`
    // render mode.
    if (stage.getDebugRenderMode() === 'clip-mask' && this.#_inspectedMask) {
      drawClipMaskOverlay(gfx, activeCamera, dpr, this.#_inspectedMask)
    }

    // Reset blend so a lingering `lighter` from the last dynamic-layer
    // particle draw doesn't leak into debug lines. Base transform puts us
    // in CSS-px space (× dpr -> device px in the actual draw call).
    gfx.setBlend('source-over')
    gfx.setAlpha(1)
    gfx.setBaseTransform(dpr, 0, 0, dpr, 0, 0)

    // The 2D screen grid draws only in 2D mode. 3D mode uses the ground grid in
    // `drawOverlay3D`, so the two never overlap.
    if (this.#flags.grid && this.#_debugSpace === '2d') {
      drawGrid(gfx, activeCamera, renderer.cssSize.w, renderer.cssSize.h)
    }

    if (this.#flags.outlines) {
      drawNodeOutlines(gfx, stage, activeCamera)
    }

    if (this.#flags.layoutOutlines) {
      drawLayoutOutlines(gfx, stage, activeCamera)
    }

    if (this.#_physicsAny) {
      const alpha = this.engine.ticker.fixedAlpha
      for (const entry of worldsForStage(this.engine, stage)) {
        const space = entry.spaceNode?.transform.world ?? null
        drawPhysicsOverlay(
          gfx,
          entry.world,
          activeCamera,
          this.#_physicsFlags,
          space,
          alpha,
          this.#worldAccents.get(entry.world),
          entry.label,
        )
      }
    }

    if (this.#highlightedNode && this.#highlightedNode.scene === stage.tree) {
      const highlighted = this.#highlightedNode
      const view =
        viewFor(highlighted, stage, { activeCameraFor: () => activeCamera }) ??
        activeCamera
      drawNodeHighlight(gfx, view, highlighted)
    }

    // Only meaningful when the debug camera is active, the pip shows the
    // stage's game camera rect in debug-camera space.
    const gameCam = stage.currentCamera2D
    if (this.#_cameraActive && gameCam) {
      drawGameCameraRect(gfx, activeCamera, gameCam)
    }
  }

  /**
   * Collect 3D gizmos into `lines` for the stage's world, viewed through
   * `cam3d`. Called by `Stage.render` in the depth-tested 3D pass (between the
   * mesh pass and `resetToBaseline`). Grid + world axes ride the grid toggle
   * (`X`), mesh/quad bounds ride the outlines toggle (`O`), the highlighted
   * node draws as an always-visible overlay, and the game camera frustum shows
   * while the 3D fly-camera is active.
   */
  drawOverlay3D(
    stage: Stage,
    cam3d: CameraView3D,
    lines: DebugLine3DRenderer,
  ): void {
    // The ground grid draws only in 3D mode, so it never coexists with the 2D
    // screen grid (which the 2D overlay draws in 2D mode). It follows the camera
    // (snapped to the grid) so it reads as infinite, and the three world axes
    // span far in both directions through the origin.
    if (this.#flags.grid && this.#_debugSpace === '3d') {
      const eye = cam3d.eyePosition()
      lines.groundGrid(eye.x, eye.z, 1, 40, [1, 1, 1, 0.12])
      lines.originAxes(1000)
    }
    if (this.#flags.outlines) pushMeshBounds(lines, stage)
    // Wireframe render view: triangle edges over the shaded fill, depth-tested
    // so hidden edges are occluded (a clean "mesh view").
    if (this.#_renderMode === 'wireframe') pushMeshWireframes(lines, stage)
    if (this.#highlightedNode3d)
      pushNodeHighlight3D(lines, this.#highlightedNode3d)
    if (this.camera3dActive && stage.currentCamera3D) {
      lines.frustum(stage.currentCamera3D.invViewProjection, [1, 0.8, 0.3, 0.8])
    }
  }

  /**
   * Draw the input overlay (pointer markers + ids) for a specific stage. Called
   * by `Stage.render()` for every stage that has an `InputSystem`, so
   * multi-touch is visible on whichever canvas the finger lands on. No-op if
   * the toggle is off or the stage has no input attached.
   */
  drawInputOverlay(stage: Stage, gfx: Gfx2D): void {
    if (!this.#flags.pointerOverlay) return
    const input = stage.input
    if (!input) return
    const dpr = stage.renderer.dpr
    gfx.setBlend('source-over')
    gfx.setAlpha(1)
    gfx.setBaseTransform(dpr, 0, 0, dpr, 0, 0)
    drawPointerOverlay(gfx, input)
  }

  /** Remove the HUD listeners and overlays. Call it when the engine goes away. */
  destroy(): void {
    this.#exitPointerLock()
    for (const fn of this.#disposeCallbacks) fn()
    this.#disposeCallbacks.length = 0
  }

  #toggleFlag(flag: DebugFlag): void {
    this.#flags[flag] = !this.#flags[flag]
    this.#emitToggle()
  }

  #emitToggle(): void {
    this.events.emit('toggle', {
      hud: this.hudVisible,
      camera: this.#_cameraActive,
      space: this.#_debugSpace,
      cameraMode: this.cameraMode,
      renderMode: this.#_renderMode,
      ...this.#flags,
      paused: this.engine.paused,
      physics: { ...this.#_physicsFlags },
      flyPointerLocked: this.#_flyPointerLocked,
    })
  }

  #onKeyDown(e: KeyboardEvent): void {
    const target = e.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return
    }
    // A focused <select> (e.g. the camera-mode dropdown that just engaged the
    // fly camera) would otherwise typeahead on WASD and change its own value.
    // While a debug camera is active, drop its focus so the key drives the
    // camera instead (the routing + preventDefault below then applies).
    if (target instanceof HTMLSelectElement) {
      if (!this.#_cameraActive) return
      target.blur()
    }
    // Hold-Shift sprints the 3D fly camera. Not routed as a control key and not
    // prevent-defaulted, so browser/OS Shift-combos are unaffected.
    if (
      this.camera3dActive &&
      (e.code === 'ShiftLeft' || e.code === 'ShiftRight')
    ) {
      this.#debugCamera3d?.setSprint(true)
      return
    }
    if (this.#_cameraActive && this.#routeCameraKey(e.code, true)) {
      e.preventDefault()
      return
    }
    switch (e.code) {
      case 'KeyV':
        // Toggle the 3D fly camera (from any mode back to active if already on).
        this.setCameraMode(
          this.cameraMode === 'debug-3d' ? 'active' : 'debug-3d',
        )
        e.preventDefault()
        return
      case 'KeyY':
        this.toggleHud()
        e.preventDefault()
        return
      case 'KeyC':
        // Toggle the 2D pan/zoom debug camera.
        this.setCameraMode(
          this.cameraMode === 'debug-2d' ? 'active' : 'debug-2d',
        )
        e.preventDefault()
        return
      case 'KeyO':
        this.toggleOutlines()
        e.preventDefault()
        return
      case 'KeyL':
        this.toggleLayoutOutlines()
        e.preventDefault()
        return
      case 'KeyG':
        this.toggleFollow()
        e.preventDefault()
        return
      case 'KeyX':
        this.toggleGrid()
        e.preventDefault()
        return
      case 'KeyP':
        this.togglePause()
        e.preventDefault()
        return
      case 'KeyT':
        this.togglePointerOverlay()
        e.preventDefault()
        return
      case 'KeyR':
        if (this.#_cameraActive) {
          this.resetDebugCamera()
          e.preventDefault()
        }
        return
      default:
        return
    }
  }

  #onKeyUp(e: KeyboardEvent): void {
    // Clear sprint before the active-guard so a Shift release that lands after
    // the camera toggled off is not swallowed (leaving sprint stuck on).
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.#debugCamera3d?.setSprint(false)
      return
    }
    if (this.#_cameraActive) this.#routeCameraKey(e.code, false)
  }
}
