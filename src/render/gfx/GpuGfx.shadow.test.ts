import { describe, it, expect } from 'vitest'
import type { GfxShadowStyle } from './Gfx2D'
import { beginFrame as baseFrame, makeGpuGfx } from './testing/gpuGfxHarness'

const shadow = (overrides: Partial<GfxShadowStyle> = {}): GfxShadowStyle => ({
  color: 'rgba(20,16,40,0.35)',
  offsetX: 0,
  offsetY: 8,
  blur: 32,
  spread: 0,
  inset: false,
  ...overrides,
})

describe('GpuGfx analytic shadows', () => {
  it('draws an outset round-rect shadow as one instance, one draw call', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(50, 50, 200, 120, 16, shadow())
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(gfx.stats.shadowInstances).toBe(1)
  })

  it('draws an inset round-rect shadow without crashing', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(50, 50, 200, 120, 16, shadow({ inset: true }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('draws a circle shadow without crashing', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowCircle(100, 100, 40, shadow())
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('handles zero blur (a hard, unblurred shadow) without crashing', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(0, 0, 100, 60, 8, shadow({ blur: 0 }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('handles a blur much larger than the shape without crashing (sigma clamp)', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(0, 0, 20, 20, 4, shadow({ blur: 500 }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('handles negative spread (shrink) without inverting the shape', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(0, 0, 40, 40, 8, shadow({ spread: -1000 }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('multiple shadows on the same instance batch (no gradient, no clip change)', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(0, 0, 40, 40, 8, shadow())
    gfx.shadowRoundRect(50, 0, 40, 40, 8, shadow())
    gfx.shadowCircle(150, 20, 20, shadow())
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(gfx.stats.shadowInstances).toBe(3)
  })
})
