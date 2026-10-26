import { describe, expect, it } from 'vitest'
import { ParticlePool } from './ParticlePool'

// Slot allocation (counts, freelist, capacity checks) is covered by
// SlotPool.test.ts. These cases cover what ParticlePool adds on top: the
// `field.alive` mask mirroring each slot's liveness.
describe('ParticlePool', () => {
  it('spawn marks the slot alive in the field, and -1 leaves the mask alone', () => {
    const p = new ParticlePool(2)
    const a = p.spawn()
    const b = p.spawn()
    expect(p.field.alive[a]).toBe(1)
    expect(p.field.alive[b]).toBe(1)
    expect(p.spawn()).toBe(-1)
    expect(p.field.alive.reduce((n, v) => n + v, 0)).toBe(2)
  })

  it('kill clears the slot in the field, and a double-kill leaves other slots alone', () => {
    const p = new ParticlePool(4)
    const a = p.spawn()
    const b = p.spawn()
    p.kill(a)
    const availBefore = p.availableCount
    const aliveBefore = p.aliveCount
    p.kill(a)
    p.kill(a)
    expect(p.availableCount).toBe(availBefore)
    expect(p.aliveCount).toBe(aliveBefore)
    expect(p.field.alive[a]).toBe(0)
    expect(p.field.alive[b]).toBe(1)
  })

  it('clear zeroes the alive mask', () => {
    const p = new ParticlePool(4)
    for (let i = 0; i < 4; i++) p.spawn()
    p.clear()
    expect([...p.field.alive]).toEqual([0, 0, 0, 0])
    expect(p.aliveCount).toBe(0)
  })
})
