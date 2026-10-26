import { describe, it, expect, vi } from 'vitest'
import { beginFrame, makeGpuGfx } from './testing/gpuGfxHarness'

describe('GpuGfx.unimplemented.strokeAlignFallback', () => {
  it('ticks once per call for a non-center align on an open polyline', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    const pts = new Float32Array([0, 0, 40, 0])
    gfx.strokePolyline(pts, 2, { color: '#fff', width: 4, align: 'outside' })
    gfx.strokePolyline(pts, 2, { color: '#fff', width: 4, align: 'outside' })
    gfx.endFrame()
    expect(gfx.unimplemented.strokeAlignFallback).toBe(2)
    warn.mockRestore()
  })

  it('stays zero for a centered stroke', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.strokeLine(0, 0, 40, 0, { color: '#fff', width: 4 })
    gfx.endFrame()
    expect(gfx.unimplemented.strokeAlignFallback).toBe(0)
  })

  it('stays zero for a well-wound closed contour', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    const square = new Float32Array([0, 0, 40, 0, 40, 40, 0, 40])
    gfx.strokePolyline(square, 4, {
      color: '#fff',
      width: 4,
      align: 'outside',
      closed: true,
    })
    gfx.endFrame()
    expect(gfx.unimplemented.strokeAlignFallback).toBe(0)
  })

  it('ticks on every draw through the cached Path2D outline path too, not just the first', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    const { registerPathTessellation } =
      await import('./PathTessellationRegistry')
    const path = new Path2D('M0 0 L40 0 Z')
    // An open-ended contour (closed: false) so the align request can never
    // resolve: registered with no contours is also valid, but giving one
    // exercises the real per-contour loop in `strokePath2D`.
    registerPathTessellation(
      path,
      { vertices: new Float32Array(), indices: new Uint16Array() },
      [new Float32Array([0, 0, 40, 0])],
      [false],
    )
    const style = { color: '#fff', width: 4, align: 'outside' as const }
    gfx.strokePath2D(path, style)
    gfx.strokePath2D(path, style)
    gfx.endFrame()
    expect(gfx.unimplemented.strokeAlignFallback).toBe(2)
    warn.mockRestore()
  })
})
