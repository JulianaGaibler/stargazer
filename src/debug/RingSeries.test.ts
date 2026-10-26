import { describe, expect, it } from 'vitest'
import { FrameStats } from './FrameStats'
import { RingSeries, foldWorst } from './RingSeries'

describe('RingSeries', () => {
  it('reads samples oldest to newest, before and after wrapping', () => {
    const s = new RingSeries(3)
    const out = new Float32Array(3)
    s.push(1)
    s.push(2)
    expect(s.readOrdered(out)).toBe(2)
    expect([...out.slice(0, 2)]).toEqual([1, 2])
    s.push(3)
    s.push(4)
    expect(s.readOrdered(out)).toBe(3)
    expect([...out]).toEqual([2, 3, 4])
    expect(s.last).toBe(4)
    expect(s.peak).toBe(4)
  })

  it('reports empty as zeros', () => {
    const s = new RingSeries(3)
    expect(s.count).toBe(0)
    expect(s.last).toBe(0)
    expect(s.peak).toBe(0)
    expect(s.readOrdered(new Float32Array(3))).toBe(0)
  })

  it('reads no more than the output buffer holds', () => {
    const s = new RingSeries(10)
    for (let i = 1; i <= 6; i++) s.push(i)
    const out = new Float32Array(3)
    expect(s.readOrdered(out)).toBe(3)
    expect([...out]).toEqual([1, 2, 3])
  })

  it('drops every sample on clear', () => {
    const s = new RingSeries(3)
    s.push(1)
    s.push(2)
    s.clear()
    expect(s.count).toBe(0)
    expect(s.last).toBe(0)
    expect(s.readOrdered(new Float32Array(3))).toBe(0)
  })
})

describe('foldWorst', () => {
  it('keeps the largest sample of each column so a spike survives', () => {
    const src = new Float32Array([1, 9, 2, 2, 3, 1])
    const out = new Float32Array(3)
    expect(foldWorst(src, 6, 3, out)).toBe(3)
    expect([...out]).toEqual([9, 2, 3])
  })

  it('gives one column per sample when there are fewer samples than columns', () => {
    const out = new Float32Array(10)
    expect(foldWorst(new Float32Array([4, 5]), 2, 10, out)).toBe(2)
    expect([...out.slice(0, 2)]).toEqual([4, 5])
  })
})

describe('FrameStats', () => {
  it('reports zeros when empty', () => {
    const s = new FrameStats(10)
    const p = s.percentiles()
    expect(p).toEqual({ p50: 0, p95: 0, p99: 0, max: 0, count: 0 })
  })

  it('computes percentiles from a monotonic sample', () => {
    const s = new FrameStats(100)
    for (let i = 1; i <= 100; i++) s.push(i / 1000) // 1ms to 100ms
    const p = s.percentiles()
    expect(p.count).toBe(100)
    // With 100 samples, floor(100 * 0.5) = 50 -> sorted[50] = 51ms.
    expect(p.p50).toBeCloseTo(0.051, 6)
    expect(p.p95).toBeCloseTo(0.096, 6)
    expect(p.p99).toBeCloseTo(0.1, 6)
    expect(p.max).toBeCloseTo(0.1, 6)
  })

  it('rings around at capacity, only the last N samples count', () => {
    const s = new FrameStats(10)
    for (let i = 0; i < 15; i++) s.push(i)
    const p = s.percentiles()
    expect(p.count).toBe(10)
    // Last 10 samples are [5..14]. Sorted, p50 = pick(0.5) = sorted[5] = 10.
    expect(p.p50).toBe(10)
    expect(p.max).toBe(14)
  })
})
