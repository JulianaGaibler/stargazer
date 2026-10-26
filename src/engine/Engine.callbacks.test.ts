import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diagnostics } from '../diagnostics/Diagnostics'
import { GroupNode } from '../scene/GroupNode'
import { Behavior } from '../scene/Behavior'
import { MockGfxDevice } from '../render/gfx/webgl2/mockGfxDevice'
import { Engine } from './Engine'

describe('game callbacks that throw', () => {
  const callbacks: FrameRequestCallback[] = []
  const origRaf = globalThis.requestAnimationFrame

  beforeEach(() => {
    callbacks.length = 0
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      callbacks.push(cb)
      return callbacks.length
    }) as typeof requestAnimationFrame
    vi.spyOn(console, 'error').mockImplementation(() => {})
    diagnostics.clear()
  })
  afterEach(() => {
    globalThis.requestAnimationFrame = origRaf
    vi.restoreAllMocks()
  })

  function frame(engine: Engine, atMs: number): void {
    engine.start()
    callbacks.shift()?.(atMs)
  }

  it('reports the error and still updates the other nodes', () => {
    const engine = new Engine({
      canvas: document.createElement('canvas'),
      gpuDevice: new MockGfxDevice(),
    })
    const seen: string[] = []
    const reports: { node?: string; code: string }[] = []
    engine.events.on('diagnostic', (d) => reports.push(d))

    class Broken extends GroupNode {
      override onUpdate(): void {
        throw new Error('boom')
      }
    }
    class Healthy extends GroupNode {
      override onUpdate(): void {
        seen.push('healthy')
      }
    }
    const broken = new Broken('broken')
    class Faulty extends Behavior {
      override onUpdate(): void {
        throw new Error('behavior boom')
      }
    }
    const withBehavior = new GroupNode('with-behavior')
    withBehavior.addBehavior(new Faulty())
    const healthy = new Healthy('healthy')
    engine.tree.root.add(broken)
    engine.tree.root.add(withBehavior)
    engine.tree.root.add(healthy)

    frame(engine, 1000)
    frame(engine, 1016)

    expect(seen.length).toBeGreaterThan(0)
    const codes = reports.map((r) => `${r.code}:${r.node}`)
    expect(codes).toContain('SG4001:broken')
    expect(codes).toContain('SG4001:with-behavior')
    // The same error twice is one report.
    expect(codes.filter((c) => c === 'SG4001:broken')).toHaveLength(1)
    expect(diagnostics.countOf('SG4001')).toBeGreaterThanOrEqual(4)
    engine.destroy()
  })

  it('reports a throwing lifecycle hook and still attaches and detaches', () => {
    const engine = new Engine({
      canvas: document.createElement('canvas'),
      gpuDevice: new MockGfxDevice(),
    })
    class Fussy extends Behavior {
      override onAttach(): void {
        throw new Error('attach boom')
      }
      override onDetach(): void {
        throw new Error('detach boom')
      }
    }
    const node = new GroupNode('fussy-node')
    engine.tree.root.add(node)
    const behavior = node.addBehavior(new Fussy())
    expect(node.behaviors).toContain(behavior)
    node.removeBehavior(behavior)
    expect(node.behaviors).not.toContain(behavior)
    expect(diagnostics.countOf('SG4008')).toBe(2)
    engine.destroy()
  })

  it('keeps a tween running when its onUpdate throws', async () => {
    const engine = new Engine({
      canvas: document.createElement('canvas'),
      gpuDevice: new MockGfxDevice(),
    })
    const target = { x: 0 }
    const done = engine.animation.tween(
      target,
      { x: 1 },
      {
        duration: 0.01,
        onUpdate: () => {
          throw new Error('tween boom')
        },
      },
    )
    engine.animation.tick(0.02)
    await done
    expect(target.x).toBe(1)
    expect(diagnostics.countOf('SG4009')).toBeGreaterThanOrEqual(1)
    engine.destroy()
  })
})
