import { WebGPUDevice } from '../src/render/gfx/webgpu/WebGPUDevice'

/**
 * A WebGPU device when the URL asks for one with `?gfx=webgpu`. Returns
 * `undefined` otherwise, or when WebGPU fails, so the host falls back to
 * WebGL2.
 */
export async function gpuDeviceFromUrl(
  canvas: HTMLCanvasElement,
  onFallback: (err: unknown) => void = (err) =>
    console.warn('[demo] WebGPU unavailable, using WebGL2:', err),
): Promise<WebGPUDevice | undefined> {
  if (new URLSearchParams(window.location.search).get('gfx') !== 'webgpu')
    return undefined
  try {
    return await WebGPUDevice.create(canvas)
  } catch (err) {
    onFallback(err)
    return undefined
  }
}
