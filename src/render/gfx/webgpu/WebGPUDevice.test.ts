import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebGPUDevice } from './WebGPUDevice'

/**
 * A callable stand-in that returns another stand-in for any property or call,
 * so device setup code that only needs objects to exist can run.
 */
function anything(): unknown {
  return new Proxy(function () {}, {
    get: (_, key) => (key === 'then' ? undefined : anything()),
    apply: () => anything(),
  })
}

/** A fake GPUDevice that logs texture destroys and queue submits in order. */
function fakeGpu(log: string[]): GPUDevice {
  let textures = 0
  const device = {
    limits: {
      minUniformBufferOffsetAlignment: 256,
      maxStorageBufferBindingSize: 1 << 27,
      maxBufferSize: 1 << 28,
    },
    lost: new Promise(() => {}),
    createTexture: () => {
      const id = ++textures
      return {
        destroy: () => log.push(`destroy ${id}`),
        createView: anything,
      }
    },
    queue: {
      submit: () => log.push('submit'),
      writeTexture: () => {},
      writeBuffer: () => {},
      copyExternalImageToTexture: () => {},
    },
  }
  return new Proxy(device, {
    get: (target, key) => {
      if (key in target) return target[key as keyof typeof target]
      // Not a thenable, so the device can be awaited.
      return key === 'then' ? undefined : anything()
    },
  }) as unknown as GPUDevice
}

async function makeDevice(log: string[]): Promise<WebGPUDevice> {
  const gpu = fakeGpu(log)
  vi.stubGlobal('navigator', {
    gpu: {
      requestAdapter: async () => ({
        features: new Set(),
        requestDevice: async () => gpu,
      }),
      getPreferredCanvasFormat: () => 'bgra8unorm',
    },
  })
  const canvas = document.createElement('canvas')
  canvas.getContext = (() => anything()) as never
  return WebGPUDevice.create(canvas)
}

const frame = { width: 8, height: 8 } as unknown as ImageBitmap

describe('WebGPUDevice', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'GPUTextureUsage',
      new Proxy({}, { get: () => 1 }) as typeof GPUTextureUsage,
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Commands recorded earlier in the frame can still name the old texture, and
  // WebGPU rejects a submit that uses a destroyed one.
  it('keeps a replaced texture alive until the frame is submitted', async () => {
    const log: string[] = []
    const device = await makeDevice(log)
    const tex = device.createTexture2D({ width: 4, height: 4 })
    device.beginFrame()
    device.updateTexture2D(tex, frame)
    expect(log).toEqual([])
    device.endFrame()
    expect(log.indexOf('submit')).toBeLessThan(log.indexOf('destroy 1'))
  })

  it('keeps a resized render target alive until the frame is submitted', async () => {
    const log: string[] = []
    const device = await makeDevice(log)
    const rt = device.createRenderTarget({ width: 4, height: 4 })
    device.beginFrame()
    device.resizeRenderTarget(rt, 8, 8)
    expect(log.filter((e) => e.startsWith('destroy'))).toEqual([])
    device.endFrame()
    const firstDestroy = log.findIndex((e) => e.startsWith('destroy'))
    expect(firstDestroy).toBeGreaterThan(log.indexOf('submit'))
  })
})
