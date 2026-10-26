import { Stage, type StageOptions } from '../render/Stage'
import type { Engine } from './Engine'
import { StargazerError } from '../diagnostics/StargazerError'

/** Builds, tracks and disposes the secondary stages of an `Engine`. */
export class EngineStageManager {
  readonly #_stages = new Set<Stage>()
  readonly #_attachedCanvases = new WeakSet<HTMLCanvasElement>()
  // Unregister callbacks for secondary stages that own a physics world, so
  // `detachStage` can pull the world out of the engine's step loop.
  readonly #physicsUnregister = new Map<Stage, () => void>()

  constructor(primaryCanvas: HTMLCanvasElement) {
    this.#_attachedCanvases.add(primaryCanvas)
  }

  /** Read-only view of currently-attached secondary stages. */
  get stages(): ReadonlySet<Stage> {
    return this.#_stages
  }

  /**
   * Construct and register a secondary `Stage`. Throws if `canvas` is already
   * attached. The caller (`Engine.attachStage`) is responsible for the "engine
   * already destroyed" guard.
   */
  attachStage(
    engine: Engine,
    canvas: HTMLCanvasElement,
    opts: StageOptions,
  ): Stage {
    if (this.#_attachedCanvases.has(canvas)) {
      throw new StargazerError(
        'SG5007',
        'attachStage called with a canvas that is already attached',
      )
    }
    // Secondary stages default to transparent, the parent HTML card owns
    // the background.
    const stage = new Stage(canvas, engine, {
      ...opts,
      transparent: opts.transparent ?? true,
      msaaSamples: opts.msaaSamples ?? engine.msaaSamples,
    })
    this.#_stages.add(stage)
    this.#_attachedCanvases.add(canvas)
    if (stage.physics) {
      this.#physicsUnregister.set(
        stage,
        engine.registerPhysicsWorld(stage.physics, {
          // The tree root is identity, so physics space is scene space (null).
          spaceNode: null,
          label: stage.name ?? 'stage',
        }),
      )
    }
    return stage
  }

  /**
   * Detach and dispose a secondary stage. Cascades AbortErrors through its
   * scene. `onDetached` lets the caller notify the debug controller before
   * teardown. No-op if `stage` isn't currently attached.
   */
  detachStage(stage: Stage, onDetached?: (stage: Stage) => void): void {
    if (!this.#_stages.delete(stage)) return
    this.#physicsUnregister.get(stage)?.()
    this.#physicsUnregister.delete(stage)
    // Lets the same canvas be attached again.
    this.#_attachedCanvases.delete(stage.canvas)
    onDetached?.(stage)
    stage.dispose()
  }

  /** Dispose every attached secondary stage. Called from `Engine.destroy`. */
  disposeAll(): void {
    for (const off of this.#physicsUnregister.values()) off()
    this.#physicsUnregister.clear()
    for (const stage of this.#_stages) stage.dispose()
    this.#_stages.clear()
  }
}
