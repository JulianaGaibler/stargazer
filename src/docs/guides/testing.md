---
title: Testing
group: Features
order: 25
---

# Testing

You can test code that uses stargazer without a GPU or a browser canvas. This page describes the helpers in `stargazer/testing` and how to keep engine messages out of test output.

## Basic usage

Import the helpers from `stargazer/testing`. They are not part of the main entry, so an app does not ship them.

### Run an engine without a GPU

{@link MockGfxDevice} is a graphics device that records every pipeline, pass and draw instead of running them. Pass it as `gpuDevice` to an {@link Engine} and check what was recorded.

```ts
import { CameraNode2D, Engine, ShapeNode } from 'stargazer'
import { MockGfxDevice } from 'stargazer/testing'

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
// Render one frame, then read device.draws and device.passes.
```

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

Call `clearTextLayoutCaches()` when a test changes the measurement, because fitted blocks are cached.

## Advanced usage

### Test a post effect

{@link createPostChain} builds the chain that runs {@link PostEffect}s on a device. Compile is asynchronous, so call `chain.prepare(effects, colorSpace)` until it returns true, then `chain.run`.

### Smooth corners

Smooth corners load a data file over the network. A test environment served over HTTP cannot fetch it, and logs a warning. `setSmoothCornerFieldLoader(() => Promise.resolve(null))` skips the fetch and draws circular corners.

### Engine messages in test output

The engine reports problems through [diagnostics](/guides/diagnostics). To keep them out of test output, or to assert on them, use `diagnostics.configure` and `diagnostics.on`.

```ts
import { diagnostics } from 'stargazer'

diagnostics.configure({ console: false })
const seen: string[] = []
const off = diagnostics.on((d) => seen.push(d.code))
// ...run the code under test...
expect(seen).toContain('SG2001')
off()
```

## See also

- {@link MockGfxDevice}: the recording device
- [Diagnostics](/guides/diagnostics): the reports and their codes
- [Setup](/guides/setup): creating an engine
