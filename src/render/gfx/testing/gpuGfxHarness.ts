// Shared setup for the GpuGfx tests: a 400x300 canvas on a MockGfxDevice, and
// the frame preamble every test repeats. Tests only; the build skips the
// testing directory.
import { GpuGfx } from '../GpuGfx'
import { MockGfxDevice } from '../mock/mockGfxDevice'

const CANVAS_WIDTH = 400
const CANVAS_HEIGHT = 300

type GpuGfxOptions = NonNullable<ConstructorParameters<typeof GpuGfx>[2]>

export interface FrameOptions {
  /** Defaults to the dark blue most tests draw on. */
  clearColor?: string
  /** Set false to leave the base transform and alpha untouched. */
  resetState?: boolean
}

export function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT
  return canvas
}

/** A GpuGfx on a fresh mock device. Pipelines are still warming. */
export function makeGpuGfx(opts?: GpuGfxOptions): {
  gfx: GpuGfx
  device: MockGfxDevice
  canvas: HTMLCanvasElement
} {
  const canvas = makeCanvas()
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device, opts)
  return { gfx, device, canvas }
}

/** Like `makeGpuGfx`, once the pipelines are warm and the device is clear. */
export async function makeReadyGfx(
  opts?: GpuGfxOptions,
): Promise<{ gfx: GpuGfx; device: MockGfxDevice }> {
  const { gfx, device } = makeGpuGfx(opts)
  await gfx.whenReady
  device.reset()
  return { gfx, device }
}

/** Begins a frame on a gfx that is already warm. */
function startFrame(
  gfx: GpuGfx,
  { clearColor = '#0d1a2c', resetState = true }: FrameOptions = {},
): void {
  gfx.beginFrame({
    clearColor,
    transparent: false,
    pixelW: CANVAS_WIDTH,
    pixelH: CANVAS_HEIGHT,
  })
  if (resetState) {
    gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
    gfx.setAlpha(1)
  }
}

/** Waits for the pipelines, clears the device and begins a frame. */
export async function beginFrame(
  gfx: GpuGfx,
  device: MockGfxDevice,
  opts?: FrameOptions,
): Promise<void> {
  await gfx.whenReady
  device.reset()
  startFrame(gfx, opts)
}

/** A ready gfx with a frame already begun. */
export async function makeFrameGfx(
  gfxOpts?: GpuGfxOptions,
  frameOpts?: FrameOptions,
): Promise<{ gfx: GpuGfx; device: MockGfxDevice }> {
  const made = await makeReadyGfx(gfxOpts)
  startFrame(made.gfx, frameOpts)
  return made
}
