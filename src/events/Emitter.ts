import { diagnostics, reportThrown } from '../diagnostics/Diagnostics'
/** Handler for an {@link Emitter} event, called with the event's payload. */
export type EmitterHandler<T> = (payload: T) => void

/**
 * Typed event bus keyed by an event map `M`. Payload types follow the map, so
 * `on` and `emit` are checked against the key. Build one with
 * {@link createEmitter}.
 */
export interface Emitter<M> {
  /** Subscribe to `key`. Returns an unsubscribe function. */
  on<K extends keyof M>(key: K, handler: EmitterHandler<M[K]>): () => void
  /** Unsubscribe a handler previously passed to `on`. */
  off<K extends keyof M>(key: K, handler: EmitterHandler<M[K]>): void
  /** Dispatch `payload` to every handler registered for `key`. */
  emit<K extends keyof M>(key: K, payload: M[K]): void
}

type AnyHandler = EmitterHandler<unknown>

// Per-key dispatch bookkeeping: reused scratch array + reentrancy depth.
// Allocated lazily on first emit of a given key.
interface KeyState {
  scratch: AnyHandler[]
  depth: number
}

class EmitterImpl<M> implements Emitter<M> {
  readonly #handlers = new Map<keyof M, Set<AnyHandler>>()
  readonly #stateByKey = new Map<keyof M, KeyState>()

  on<K extends keyof M>(key: K, handler: EmitterHandler<M[K]>): () => void {
    let set = this.#handlers.get(key)
    if (!set) {
      set = new Set()
      this.#handlers.set(key, set)
    }
    set.add(handler as AnyHandler)
    return () => {
      this.#handlers.get(key)?.delete(handler as AnyHandler)
    }
  }

  off<K extends keyof M>(key: K, handler: EmitterHandler<M[K]>): void {
    this.#handlers.get(key)?.delete(handler as AnyHandler)
  }

  emit<K extends keyof M>(key: K, payload: M[K]): void {
    const set = this.#handlers.get(key)
    if (!set || set.size === 0) return

    let state = this.#stateByKey.get(key)
    if (!state) {
      state = { scratch: [], depth: 0 }
      this.#stateByKey.set(key, state)
    }

    // Snapshot the handlers so a handler calling on/off during dispatch only
    // changes the next emit. The outer dispatch still reads the scratch array,
    // so a reentrant emit takes a fresh one.
    const reentrant = state.depth > 0
    if (reentrant) {
      diagnostics.report(
        'SG5001',
        `Emitter.emit reentrant on key '${String(key)}' at depth ${state.depth + 1}.`,
        { key: String(key) },
      )
    }
    const handlers = reentrant ? [] : state.scratch
    for (const h of set) handlers.push(h)
    state.depth++
    try {
      for (let i = 0; i < handlers.length; i++) {
        try {
          ;(handlers[i] as EmitterHandler<M[K]>)(payload)
        } catch (error) {
          reportThrown('SG4003', `a '${String(key)}' handler`, error)
        }
      }
    } finally {
      state.depth--
      // Drop the references so the scratch array does not keep the handlers
      // alive between emits.
      handlers.length = 0
    }
  }
}

/** Create an {@link Emitter} for the event map `M`. */
export function createEmitter<M>(): Emitter<M> {
  return new EmitterImpl<M>()
}
