import { describe, expect, it } from 'vitest'
import { Engine } from '../engine/Engine'
import { MockGfxDevice } from './gfx/mock/mockGfxDevice'

describe('StageOptions.lockInteraction', () => {
  function makeEngine(lockInteraction?: boolean): Engine {
    return new Engine({
      canvas: document.createElement('canvas'),
      gpuDevice: new MockGfxDevice(),
      lockInteraction,
    })
  }

  it('blocks browser touch handling by default', () => {
    const engine = makeEngine()
    const canvas = engine.primaryStage.canvas
    expect(canvas.style.touchAction).toBe('none')
    expect(canvas.style.userSelect).toBe('none')
    const menu = new MouseEvent('contextmenu', { cancelable: true })
    canvas.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    engine.destroy()
  })

  it('leaves the canvas alone when turned off', () => {
    const engine = makeEngine(false)
    const canvas = engine.primaryStage.canvas
    expect(canvas.style.touchAction).toBe('')
    const menu = new MouseEvent('contextmenu', { cancelable: true })
    canvas.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(false)
    engine.destroy()
  })
})
