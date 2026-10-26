---
title: Testing
group: Features
order: 25
---

# Testing

Code that uses Stargazer runs in a unit test without a GPU or a browser canvas. The helpers in `stargazer/testing` give the engine a recording device, give text a size, and keep engine messages out of test output. After this guide you can render a scene in a test and assert on what it drew.

## Basic usage

Import the helpers from `stargazer/testing`. They live outside the main entry, so an app bundle leaves them out.

### Run an engine without a GPU

{@link MockGfxDevice} is a graphics device that records every pipeline, pass and draw instead of running them. Pass it as `gpuDevice` to an {@link Engine}, start the engine, let a frame run and read what the device recorded. This example uses Vitest fake timers to run the frame.

```ts
import { expect, it, vi } from 'vitest'
import { CameraNode2D, Engine, ShapeNode } from 'stargazer'
import { MockGfxDevice } from 'stargazer/testing'

it('draws the circle', async () => {
  vi.useFakeTimers()
  const device = new MockGfxDevice()
  const engine = new Engine({
    canvas: document.createElement('canvas'),
    gpuDevice: device,
  })

  const camera = new CameraNode2D()
  camera.setViewport({ x: 0, y: 0, width: 100, height: 100 })
  engine.tree.root.add(camera)
  camera.makeCurrent()
  engine.tree.root.add(
    new ShapeNode({ geometry: { kind: 'circle', radius: 10 }, fill: '#fff' }),
  )

  engine.start()
  await vi.advanceTimersByTimeAsync(40)

  expect(device.draws.length).toBeGreaterThan(0)
  engine.destroy()
  vi.useRealTimers()
})
```

The test passes once the engine has run a frame and the device has recorded a draw. `device.passes` lists the render passes and `device.draws` lists the draws, each with its pipeline, bind groups and buffer contents. The first frames take a few timer ticks because pipelines compile asynchronously.

### Give text a size

A headless environment has no 2D canvas context, so every string measures as empty and every string fits. `setTextMeasurer` replaces the measurement with your own function until you call the function it returns.

```ts
import { setTextMeasurer } from 'stargazer/testing'

const restore = setTextMeasurer((text, style) => {
  const size = Number(/(\d+)px/.exec(style.font)?.[1] ?? 10)
  const width = text.length * size * 0.55
  return {
    localW: width,
    localH: size,
    advance: width,
    ascent: size,
    descent: size * 0.25,
    anchorOffsetX: 0,
    anchorOffsetY: 0,
  }
})
// ...assertions...
restore()
```

Text now measures about half its font size per character, so wrapping and fitting give stable results. When a test changes the measurement, call `clearTextLayoutCaches()` first, because fitted blocks are cached.

## Advanced usage

### Test a post effect

{@link createPostChain} builds the chain that runs {@link PostEffect}s on a device. Call `chain.prepare(effects, colorSpace)` until it returns true, then `chain.run`.

```ts
import { FilmGrain } from 'stargazer'
import { MockGfxDevice, createPostChain } from 'stargazer/testing'

const device = new MockGfxDevice()
const chain = createPostChain(device)
const effects = [new FilmGrain()]

const target = device.createRenderTarget({
  width: 64,
  height: 32,
  samples: 1,
  colorSpace: 'linear',
})
const source = { texture: device.colorTexture(target), width: 64, height: 32 }

while (!chain.prepare(effects, 'linear')) await Promise.resolve()
chain.advance(1 / 60)
const result = chain.run(source, effects, 'linear', null)
```

`prepare` returns false while pipelines compile. `result` is the render target that holds the processed image, and `device.draws` shows the passes that produced it.

### Skip the smooth-corner file

Smooth corners load a data file over the network. A test served over HTTP requests the file, gets no data and logs a warning. A loader that resolves to `null` draws circular corners and logs nothing.

```ts
import { setSmoothCornerFieldLoader } from 'stargazer/testing'

setSmoothCornerFieldLoader(() => Promise.resolve(null))
```

Call `setSmoothCornerFieldLoader(null)` to restore the default loader.

### Engine messages in test output

The engine reports problems through [diagnostics](/guides/diagnostics). To keep them out of the console, or to assert on them, use `diagnostics.configure` and `diagnostics.on`.

```ts
import { expect } from 'vitest'
import { diagnostics } from 'stargazer'

diagnostics.configure({ console: false })
const seen: string[] = []
const off = diagnostics.on((d) => seen.push(d.code))
// ...run the code under test...
expect(seen).toContain('SG2001')
off()
```

Handlers still run while `console` is `false`, so the assertion sees every report.

## Next step

Read the report codes in the [Diagnostics guide](/guides/diagnostics) to choose which ones a test asserts on.

## See also

- {@link MockGfxDevice}: the recording device
- [Diagnostics](/guides/diagnostics): the reports and their codes
- [Setup](/guides/setup): creating an engine
