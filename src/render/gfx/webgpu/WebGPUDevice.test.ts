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

/**
 * A fake GPUDevice that logs texture destroys and queue submits in order, and
 * keeps every texture and bind group layout descriptor it was given.
 */
function fakeGpu(
  log: string[],
  descriptors: (GPUTextureDescriptor | GPUBindGroupLayoutDescriptor)[] = [],
): GPUDevice {
  let textures = 0
  // Logs the binds a draw makes and ignores every other pass call.
  const renderPass = new Proxy(
    {},
    {
      get: (_, key) =>
        typeof key === 'string' &&
        /^set(VertexBuffer|IndexBuffer|BindGroup)$/.test(key)
          ? () => log.push(key)
          : anything(),
    },
  )
  const device = {
    limits: {
      minUniformBufferOffsetAlignment: 256,
      maxStorageBufferBindingSize: 1 << 27,
      maxBufferSize: 1 << 28,
    },
    lost: new Promise(() => {}),
    createBindGroupLayout: (desc: GPUBindGroupLayoutDescriptor) => {
      descriptors.push(desc)
      return {}
    },
    createTexture: (desc: GPUTextureDescriptor) => {
      descriptors.push(desc)
      const id = ++textures
      return {
        destroy: () => log.push(`destroy ${id}`),
        createView: anything,
      }
    },
    createCommandEncoder: () => ({
      beginRenderPass: () => renderPass,
      finish: anything,
    }),
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

async function makeDevice(
  log: string[],
  descriptors?: (GPUTextureDescriptor | GPUBindGroupLayoutDescriptor)[],
): Promise<WebGPUDevice> {
  const gpu = fakeGpu(log, descriptors)
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
    vi.stubGlobal(
      'GPUShaderStage',
      new Proxy({}, { get: () => 1 }) as typeof GPUShaderStage,
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
  it.each([
    { samples: 1, depth: true, stencil: true },
    { samples: 4, depth: true },
    { samples: 4, stencil: true },
    { samples: 1, depth: true, depthSampled: true },
  ] as const)(
    'gives a resized render target the textures of a new one (%o)',
    async (opts) => {
      const created: GPUTextureDescriptor[] = []
      const device = await makeDevice([], created)
      device.createRenderTarget({ width: 8, height: 8, ...opts })
      const fresh = created.splice(0)
      const rt = device.createRenderTarget({ width: 4, height: 4, ...opts })
      created.length = 0
      device.resizeRenderTarget(rt, 8, 8)
      expect(created).toEqual(fresh)
    },
  )
  it('pairs each sampled texture binding with its sampler at binding + 16', async () => {
    const created: GPUBindGroupLayoutDescriptor[] = []
    const device = await makeDevice([], created)
    device.createBindGroupLayout([
      { binding: 0, type: 'texture-2d' },
      { binding: 1, type: 'texture-2d-depth' },
      { binding: 2, type: 'texture-2d-array-shadow' },
      { binding: 3, type: 'texture-cube-shadow' },
    ])
    const entries = [...created[0]!.entries].map(
      ({ binding, texture, sampler }) => ({ binding, texture, sampler }),
    )
    expect(entries).toEqual([
      { binding: 0, texture: { sampleType: 'float' } },
      { binding: 16, sampler: { type: 'filtering' } },
      { binding: 1, texture: { sampleType: 'depth' } },
      { binding: 17, sampler: { type: 'non-filtering' } },
      {
        binding: 2,
        texture: { sampleType: 'depth', viewDimension: '2d-array' },
      },
      { binding: 18, sampler: { type: 'comparison' } },
      { binding: 3, texture: { sampleType: 'depth', viewDimension: 'cube' } },
      { binding: 19, sampler: { type: 'comparison' } },
    ])
  })

  describe('draw binds', () => {
    // A draw sets only what differs from the draw before it in the same pass.
    const asDrawCall = (o: {
      vb: unknown
      offset?: number
      ib?: unknown
      bg: unknown
      dynamicOffsets?: number[]
    }): Parameters<WebGPUDevice['draw']>[0] =>
      ({
        pipeline: { gpu: {}, stencilRef: 0 },
        vertexBuffers: [{ buffer: o.vb, offset: o.offset ?? 0 }],
        bindGroups: [
          { group: 0, bindGroup: o.bg, dynamicOffsets: o.dynamicOffsets },
        ],
        indexBuffer: o.ib,
        vertexCount: 3,
        indexCount: 3,
      }) as never

    async function openPass(log: string[]): Promise<WebGPUDevice> {
      const device = await makeDevice(log)
      device.beginFrame()
      device.beginRenderPass({
        color: {
          target: { samples: 1, color: { createView: anything } } as never,
          loadOp: 'load',
        },
      })
      return device
    }
    const gpuBuffer = (gpu: object = {}) => ({ gpu, indexType: 'uint16' })

    it('skips a repeated vertex buffer, index buffer and bind group', async () => {
      const log: string[] = []
      const device = await openPass(log)
      const vb = gpuBuffer()
      const ib = gpuBuffer()
      const bg = { gpu: {} }
      device.draw(asDrawCall({ vb, ib, bg, dynamicOffsets: [256] }))
      device.draw(asDrawCall({ vb, ib, bg, dynamicOffsets: [256] }))
      expect(log).toEqual(['setVertexBuffer', 'setBindGroup', 'setIndexBuffer'])
    })

    it('sets again when the offset, dynamic offsets or buffer changes', async () => {
      const log: string[] = []
      const device = await openPass(log)
      const vb = gpuBuffer()
      const bg = { gpu: {} }
      device.draw(asDrawCall({ vb, bg, dynamicOffsets: [256] }))
      log.length = 0
      device.draw(asDrawCall({ vb, bg, offset: 64, dynamicOffsets: [256] }))
      expect(log).toEqual(['setVertexBuffer'])
      log.length = 0
      device.draw(asDrawCall({ vb, bg, offset: 64, dynamicOffsets: [512] }))
      expect(log).toEqual(['setBindGroup'])
      log.length = 0
      device.draw(
        asDrawCall({ vb: gpuBuffer(), bg, offset: 64, dynamicOffsets: [512] }),
      )
      expect(log).toEqual(['setVertexBuffer'])
    })

    it('treats no dynamic offsets and an empty list as the same bind group', async () => {
      const log: string[] = []
      const device = await openPass(log)
      const vb = gpuBuffer()
      const bg = { gpu: {} }
      device.draw(asDrawCall({ vb, bg }))
      log.length = 0
      device.draw(asDrawCall({ vb, bg, dynamicOffsets: [] }))
      expect(log).toEqual([])
    })

    it('binds everything again in a new pass', async () => {
      const log: string[] = []
      const device = await openPass(log)
      const vb = gpuBuffer()
      const bg = { gpu: {} }
      device.draw(asDrawCall({ vb, bg }))
      device.endRenderPass()
      log.length = 0
      device.beginRenderPass({
        color: {
          target: { samples: 1, color: { createView: anything } } as never,
          loadOp: 'load',
        },
      })
      device.draw(asDrawCall({ vb, bg }))
      expect(log).toEqual(['setVertexBuffer', 'setBindGroup'])
    })
  })
})
