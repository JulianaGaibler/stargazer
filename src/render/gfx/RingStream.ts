// Double-buffered CPU->GPU vertex/instance streaming for one draw program.

import { diagnostics } from '../../diagnostics/Diagnostics'
import type { GfxDevice, VBuffer } from './GfxDevice'
import { RING_SIZE } from './batchLayout'

/** Largest CPU staging buffer a stream grows to. Past it, records are dropped. */
const MAX_STREAM_BYTES = 256 * 1024 * 1024

/** Frames a stream must stay under a quarter full before it halves. */
const STREAM_DECAY_FRAMES = 60

/**
 * CPU staging plus one GPU vertex buffer per ring slot. Dual views (float,
 * uint) alias one shared ArrayBuffer. The cursor is append-only within a frame:
 * records accumulate, `takeRun` carves the appended range for one draw run, and
 * the whole written range is uploaded once (`upload`) before the command list
 * replays. `reset` clears it once per frame.
 *
 * @remarks
 *   Maintainers: capacity follows demand and no draw is dropped for lack of room.
 *   `reserve` doubles the CPU buffer (copying the written words) when a record
 *   does not fit. The views are getters because growth replaces them, so read
 *   them after `reserve`, never before. `upload` recreates the slot's GPU
 *   buffer when the written range outgrew it. The old buffer is deleted through
 *   the device's deferred destroy, so a frame still in flight is unaffected.
 *   After {@link STREAM_DECAY_FRAMES} frames below a quarter of the capacity the
 *   stream halves, down to the initial size.
 */
export class RingStream {
  readonly buffers: VBuffer[] = new Array(RING_SIZE)
  readonly pendingWords: Uint32Array = new Uint32Array(RING_SIZE)
  /** Word offset where the current (not-yet-recorded) draw-run began. */
  readonly lastRunWords: Uint32Array = new Uint32Array(RING_SIZE)
  readonly recordStride: number
  readonly label: string
  readonly #minBytes: number
  readonly #gpuBytes: number[] = new Array(RING_SIZE)
  #floatView: Float32Array
  #uintView: Uint32Array
  #wordSize: number
  #highWater = 0
  #quietFrames = 0
  // Every reserve past the limit fails, so report once per frame rather than
  // once per dropped record.
  #warned = false

  constructor(
    device: GfxDevice,
    byteSize: number,
    recordStride: number,
    label = 'stream',
  ) {
    this.#minBytes = byteSize
    this.#wordSize = byteSize / 4
    this.recordStride = recordStride
    this.label = label
    this.#floatView = new Float32Array(byteSize / 4)
    this.#uintView = new Uint32Array(this.#floatView.buffer)
    for (let i = 0; i < RING_SIZE; i++) {
      this.buffers[i] = device.createVertexBuffer(byteSize)
      this.#gpuBytes[i] = byteSize
    }
  }

  /** CPU staging as floats. Read after `reserve`, growth replaces it. */
  get floatView(): Float32Array {
    return this.#floatView
  }

  /** CPU staging as u32. Read after `reserve`, growth replaces it. */
  get uintView(): Uint32Array {
    return this.#uintView
  }

  /** Current CPU capacity in bytes. */
  get byteSize(): number {
    return this.#wordSize * 4
  }

  /** Current CPU capacity in 4-byte words. */
  get wordSize(): number {
    return this.#wordSize
  }

  /**
   * Clear the slot for a fresh frame (called once per frame from `beginFrame`).
   * Applies the shrink policy.
   */
  reset(slot: number): void {
    const used = this.#highWater * 4
    this.#highWater = 0
    if (this.byteSize > this.#minBytes && used * 4 < this.byteSize) {
      if (++this.#quietFrames >= STREAM_DECAY_FRAMES) {
        this.#quietFrames = 0
        this.#resizeCpu(Math.max(this.#minBytes, this.byteSize / 2), 0)
      }
    } else {
      this.#quietFrames = 0
    }
    this.pendingWords[slot] = 0
    this.lastRunWords[slot] = 0
    this.#warned = false
  }

  /**
   * Carve the appended-but-unrecorded range `[lastRunWords, pendingWords)` for
   * one draw-run, advancing the marker. `null` when nothing was appended since
   * the previous run.
   */
  takeRun(slot: number): { startWord: number; endWord: number } | null {
    const start = this.lastRunWords[slot]
    const end = this.pendingWords[slot]
    if (end === start) return null
    this.lastRunWords[slot] = end
    return { startWord: start, endWord: end }
  }

  /** Upload the whole written range `[0, pendingWords)` once, before replay. */
  upload(device: GfxDevice, slot: number): void {
    const words = this.pendingWords[slot]
    if (words === 0) return
    const bytes = words * 4
    if (bytes > this.#gpuBytes[slot]) {
      device.deleteBuffer(this.buffers[slot])
      this.buffers[slot] = device.createVertexBuffer(this.byteSize)
      this.#gpuBytes[slot] = this.byteSize
    } else if (this.#gpuBytes[slot] > this.byteSize * 2) {
      // The CPU side shrank, so release the oversized GPU buffer too.
      device.deleteBuffer(this.buffers[slot])
      this.buffers[slot] = device.createVertexBuffer(this.byteSize)
      this.#gpuBytes[slot] = this.byteSize
    }
    device.updateBufferSubData(this.buffers[slot], 0, this.#floatView, 0, bytes)
  }

  /**
   * Reserve `wordsNeeded` for a vertex batch, returns the word offset in the
   * CPU buffer, or `-1` only when the stream is at its size limit.
   */
  reserve(slot: number, wordsNeeded: number): number {
    const cur = this.pendingWords[slot]
    if (
      cur + wordsNeeded > this.#wordSize &&
      !this.#grow(slot, cur + wordsNeeded)
    ) {
      return -1
    }
    return cur
  }

  commit(slot: number, wordsAdded: number): void {
    this.pendingWords[slot] += wordsAdded
    if (this.pendingWords[slot] > this.#highWater) {
      this.#highWater = this.pendingWords[slot]
    }
  }

  /** Reserve one instance record and return the word offset. */
  reserveInstance(slot: number): number {
    return this.reserve(slot, this.recordStride / 4)
  }

  commitInstance(slot: number): void {
    this.commit(slot, this.recordStride / 4)
  }

  #grow(slot: number, wordsNeeded: number): boolean {
    let bytes = this.byteSize
    while (bytes < wordsNeeded * 4) bytes *= 2
    if (bytes > MAX_STREAM_BYTES) {
      if (!this.#warned) {
        this.#warned = true
        diagnostics.report(
          'SG2012',
          `'${this.label}' stream reached ${MAX_STREAM_BYTES >> 20} MB, dropping records for the remainder of this frame`,
        )
      }
      return false
    }
    this.#resizeCpu(bytes, this.pendingWords[slot])
    return true
  }

  /** Replace the CPU buffer, keeping the first `keepWords` words. */
  #resizeCpu(bytes: number, keepWords: number): void {
    const next = new ArrayBuffer(bytes)
    if (keepWords > 0) {
      new Uint32Array(next).set(this.#uintView.subarray(0, keepWords))
    }
    this.#floatView = new Float32Array(next)
    this.#uintView = new Uint32Array(next)
    this.#wordSize = bytes / 4
  }
}
