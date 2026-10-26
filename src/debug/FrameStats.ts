import { RingSeries } from './RingSeries'

/** A {@link RingSeries} of recent frame times that also reports percentiles. */
export class FrameStats extends RingSeries {
  readonly #sortScratch: Float32Array

  constructor(capacity = 300) {
    super(capacity)
    this.#sortScratch = new Float32Array(capacity)
  }

  /** The 50th, 95th and 99th percentile and the maximum of the held samples. */
  percentiles(): {
    p50: number
    p95: number
    p99: number
    max: number
    count: number
  } {
    const n = this.count
    if (n === 0) return { p50: 0, p95: 0, p99: 0, max: 0, count: 0 }
    // Sorting a scratch copy keeps the ring in time order and allocates nothing.
    this.#sortScratch.set(this.unordered)
    const slice = this.#sortScratch.subarray(0, n).sort()
    const pick = (q: number): number =>
      slice[Math.min(n - 1, Math.floor(n * q))]
    return {
      p50: pick(0.5),
      p95: pick(0.95),
      p99: pick(0.99),
      max: slice[n - 1],
      count: n,
    }
  }
}
