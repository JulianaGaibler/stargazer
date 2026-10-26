import type { CameraNode2D } from './CameraNode2D'
import type { CameraNode3D } from './CameraNode3D'
import { StargazerError } from '../diagnostics/StargazerError'

/**
 * The per-stage camera registries a camera node talks to. A `Stage` implements
 * this and exposes itself through {@link SceneTree.stage}, so camera nodes
 * attached under the tree can register themselves, become the current camera,
 * and query current-ness. One camera per dimension is current at a time.
 */
export interface CameraHost {
  /** @internal */
  readonly _cameras2D: CameraRegistry<CameraNode2D>
  /** @internal */
  readonly _cameras3D: CameraRegistry<CameraNode3D>
}

/** What a {@link CameraRegistry} reads from the cameras it holds. */
export interface RegisteredCamera {
  readonly enabled: boolean
  readonly priority: number
  readonly wantsCurrent: boolean
  consumeWantsCurrent(): void
}

/**
 * The cameras of one dimension on a stage, in attachment order, and the one
 * that is current.
 *
 * @internal
 */
export class CameraRegistry<C extends RegisteredCamera> {
  readonly cameras: C[] = []
  current: C | null = null

  /** The first camera registered wins, or one that asked to be current. */
  register(cam: C): void {
    if (this.cameras.indexOf(cam) < 0) this.cameras.push(cam)
    if (!this.current || cam.wantsCurrent) {
      cam.consumeWantsCurrent()
      this.current = cam
    }
  }

  /** Forget `cam`, promoting the next enabled camera if it was current. */
  unregister(cam: C): void {
    const i = this.cameras.indexOf(cam)
    if (i >= 0) this.cameras.splice(i, 1)
    if (this.current === cam) this.current = this.#pickNext()
  }

  makeCurrent(cam: C): void {
    cam.consumeWantsCurrent()
    for (const c of this.cameras) c.consumeWantsCurrent()
    this.current = cam
  }

  /** Pick another camera when the current one is gone or disabled. */
  reevaluate(): void {
    if (!this.current || !this.current.enabled) this.current = this.#pickNext()
  }

  /** Make the next enabled camera other than `cam` current, or none. */
  handOff(cam: C): void {
    this.current = this.#pickNext(cam)
  }

  #pickNext(skip?: C): C | null {
    let best: C | null = null
    for (const c of this.cameras) {
      if (!c.enabled || c === skip) continue
      if (!best || c.priority > best.priority) best = c
    }
    return best
  }
}

/**
 * The current-camera state of one camera node and its link to the registry it
 * joined on attach. Shared by {@link CameraNode2D} and {@link CameraNode3D}.
 *
 * @internal
 */
export class CameraSlot<C extends RegisteredCamera> {
  enabled = true
  /** `makeCurrent()` called before attach, consumed on register. */
  wantsCurrent = false
  // Held from attach to detach because the node's tree is already gone by the
  // time detach runs.
  #registry: CameraRegistry<C> | null = null
  readonly #cam: C

  constructor(cam: C) {
    this.#cam = cam
  }

  setEnabled(v: boolean): void {
    if (this.enabled === v) return
    this.enabled = v
    if (!v) this.#registry?.reevaluate()
  }

  get isCurrent(): boolean {
    return this.#registry !== null && this.#registry.current === this.#cam
  }

  makeCurrent(): void {
    if (this.#registry) this.#registry.makeCurrent(this.#cam)
    else this.wantsCurrent = true
  }

  clearCurrent(enableNext: boolean): void {
    this.wantsCurrent = false
    if (enableNext && this.isCurrent) this.#registry!.handOff(this.#cam)
  }

  attach(registry: CameraRegistry<C> | undefined, what: string): void {
    if (!registry) {
      throw new StargazerError(
        'SG5007',
        `${what} was attached to a tree with no camera host ` +
          `(SceneTree.stage is null). Camera nodes must live under a Stage's tree.`,
      )
    }
    this.#registry = registry
    registry.register(this.#cam)
  }

  detach(): void {
    this.#registry?.unregister(this.#cam)
    this.#registry = null
  }
}
