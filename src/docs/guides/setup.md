---
title: Engine setup
group: Getting started
order: 2
---

# Engine setup

An {@link EngineHost} puts the engine on a page's `<canvas>`. It wraps one {@link Engine}, which owns the frame loop and the services for that canvas: the scene tree, cameras, input, animation and the renderer. The host adds what a page needs around the engine: start and stop, pause and resume, scene swapping, and recovery when the graphics context is lost.

After this page you can mount a host in Svelte or in plain TypeScript, run its lifecycle, and respond when the graphics context is lost. The advanced part covers the backend choice, the host options, the engine's services and events, and automatic quality reduction.

## Basic usage

Mount one host per canvas. In a Svelte component, use the {@link mountEngine} action. Anywhere else, call {@link createEngineHost}. Either way, add a camera to the scene so that it shows content.

### Mount in Svelte

This component mounts the engine, builds a scene with a camera and one circle, and starts the loop.

```svelte
<script lang="ts">
  import { mountEngine, CameraNode2D, ShapeNode } from 'stargazer'
  import type { EngineHost } from 'stargazer'

  async function onReady(host: EngineHost): Promise<void> {
    await host.loadScene((scene) => {
      const cam = new CameraNode2D()
      cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
      scene.root.add(cam)

      const circle = new ShapeNode({
        geometry: { kind: 'circle', radius: 40 },
        fill: '#ffd34d',
      })
      circle.transform.x = 960
      circle.transform.y = 540
      scene.root.add(circle)
    })
    host.start()
  }
</script>

<canvas
  use:mountEngine={{
    options: { clearColor: '#0d1a2c' },
    onReady,
  }}
></canvas>
```

A yellow circle appears in the middle of the 1920 by 1080 world, on a dark blue background. The action picks a rendering backend, builds the host from the element, and calls `onReady`. When the component unmounts, the action calls `host.destroy()`, so the component needs no `onDestroy` of its own.

`options` takes every {@link EngineHostOptions} field except `canvas`, which the action supplies from the element. Keep the host that `onReady` receives if you need it later, for example to pause or to load another scene.

### Mount in plain TypeScript

Pass the canvas element to {@link createEngineHost}, and call `destroy` when the page is finished with the engine.

```ts
import { createEngineHost, CameraNode2D } from 'stargazer'

const canvas = document.querySelector('canvas')!
const host = createEngineHost({ canvas, clearColor: '#0d1a2c' })

await host.loadScene((scene) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)
})

host.start()

// When the page is finished with the engine:
host.destroy()
```

The canvas shows the clear color, because this scene has a camera and nothing to draw yet. `createEngineHost` renders with WebGL2. To render with WebGPU, choose the device first, as described in [Pick a backend](#pick-a-backend).

The engine sizes the canvas backing store from the canvas element's CSS size and the device pixel ratio. It follows the element with a `ResizeObserver` and listens for `window` resize, so giving the canvas element a CSS size is all the sizing you write.

### Add a camera

A scene shows content once it has a {@link CameraNode2D}. The first camera added to a stage becomes the current one, and [`makeCurrent`](/module/camera/cameranode2d#makecurrent) switches to another. `engine.currentCamera2D` returns the current camera, or `null` while the tree has none.

```ts
import { CameraNode2D } from 'stargazer'

const overview = new CameraNode2D()
overview.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
const closeUp = new CameraNode2D()
closeUp.setViewport({ x: 760, y: 440, width: 400, height: 200 })

host.engine.tree.root.add(overview, closeUp)
closeUp.makeCurrent()
```

The canvas shows the 400 by 200 rectangle around the middle of the world. The camera guide covers framing, zoom and following a node: see [Camera](/guides/camera).

### Build and swap scenes

`loadScene` destroys the children of the scene root, then calls your builder with the empty scene and the engine. Nodes with `persistent` set to `true` stay, together with their subtrees. The builder can be async, so it can wait for assets before it adds nodes.

```ts
import { CameraNode2D, Path2DNode, parseSvgPaths } from 'stargazer'

await host.loadScene(async (scene, engine) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)

  const svg = await fetch('/board.svg').then((r) => r.text())
  const { paths } = parseSvgPaths(svg, { tessellate: true })
  for (const [id, entry] of paths) {
    scene.root.add(new Path2DNode({ id, path: entry.path, fill: '#12233f' }))
  }
})
```

The scene shows one filled path for each path in the SVG file. The old camera is destroyed with the other children, so each builder adds its own.

Call `loadScene` again to swap scenes. Destroying the old nodes detaches their behaviors and rejects their pending tweens, which were started with `node.tween` or `engine.animate`, with `AbortError`. To avoid fetching and parsing the same file on every scene load, keep the result in an {@link AssetLoader}. See [Assets](/guides/assets).

### Start, stop and pause

The host has these lifecycle calls:

```ts
host.start() // start the frame loop, the first call emits `ready`
host.stop() // stop the loop, the scene and GPU resources stay
host.pause() // stop the loop while an overlay covers the canvas
host.resume() // undo pause()
host.destroy() // stop, remove listeners, reject pending tweens, free the GPU
```

Use `host.pause()` when a menu or modal covers the whole canvas. [`engine.setPaused(true)`](/module/engine/engine#setpaused) is a soft freeze for a game that stays visible: the loop keeps running and the stages keep rendering, while tweens, `onUpdate`, `onFixedStep` and physics stop. The debug camera stays usable during a soft freeze.

After `destroy`, the calls `start`, `stop`, `pause` and `resume` do nothing, so a late timer that calls `host.start()` is safe.

### Common problems

The canvas shows only the background color. The stage has no current camera. Add a `CameraNode2D` to the scene, as shown in [Add a camera](#add-a-camera). If the scene has a camera and the canvas stays empty, check the camera's viewport: it is the world rectangle that fills the canvas.

A tween rejects with `AbortError` after a scene swap. The tween belonged to a node that `loadScene` destroyed. Catch the rejection with {@link ignoreAbort}, or start the tween with `node.play`, which does this for you:

```ts
import { ignoreAbort } from 'stargazer'

declare const node: import('stargazer').Node2D

node.tween({ x: 400 }, { duration: 0.5 }).catch(ignoreAbort)
node.play({ x: 400 }, { duration: 0.5 })
```

## Advanced usage

The host runs with defaults until you change them. This part covers the choices that matter once a project is running on real devices.

### Pick a backend

`mountEngine` takes a `backend` parameter. `'auto'` is the default. It checks that WebGPU works on the machine and falls back to WebGL2. `'webgpu'` and `'webgl2'` force one, and forcing WebGPU fails when WebGPU is unavailable.

```svelte
<canvas use:mountEngine={{ backend: 'webgl2', onReady }}></canvas>
```

A canvas element keeps the context type it gets first, so the choice is made once, before the host exists. With `'webgl2'` the action builds the host right away. With `'auto'` and `'webgpu'` it builds the host after an async check, so `onReady` runs later.

In plain TypeScript, call {@link selectGfxDevice} first and pass the device to the host:

```ts
import { selectGfxDevice, createEngineHost } from 'stargazer'

const { device, backend } = await selectGfxDevice(canvas, 'auto')
console.info('rendering backend:', backend)
const host = createEngineHost({ canvas, gpuDevice: device })
```

The log line prints `webgpu` or `webgl2`, and the host renders through that device.

### Set host options

Every option has a default, so pass the ones your project changes. This host caps the frame rate, turns off automatic quality reduction, shows the debug HUD at start and logs informational diagnostics:

```ts
import { createEngineHost } from 'stargazer'

const host = createEngineHost({
  canvas,
  clearColor: '#0d1a2c',
  maxFps: 60,
  quality: { adaptive: false },
  debug: 'hud',
  log: 'info',
})
```

The page starts with the HUD open, and the console shows diagnostics from `info` up to `error`. {@link EngineHostOptions} lists every option with its default. Options for 3D, physics and render scale are described in [3D](/guides/3d), [Physics](/guides/physics) and [Stages](/guides/stages).

`msaaSamples`, `debug` and `log` fall back to URL flags when you leave them out: `?msaa=N`, `?debug=hud` or `?debug=perf`, and `?log=` followed by a level. These flags let you try settings on a deployed build, and passing the option makes the host ignore the URL. `?quality=off` ignores the quality settings saved in the debug panel and `?quality=reset` deletes them. Pass `qualityProfile: false` to ignore the saved settings in code, for example in a benchmark. See [Debugging](/guides/debugging) for the HUD.

### Reach the subsystems

The engine is at `host.engine`. These are its main properties:

```ts
const engine = host.engine

engine.tree // the primary stage's scene tree, add nodes under tree.root
engine.currentCamera2D // the current 2D camera, or null
engine.input // the primary stage's InputSystem
engine.animation // the Animator that runs every tween and wait
engine.renderer // canvas size in CSS and device pixels, and the pixel ratio
engine.dom // HTML elements that follow scene nodes
engine.a11y // the hidden accessibility tree
engine.postProcess // screen-space effects on the primary stage
engine.physics // the primary stage's PhysicsWorld, or null
engine.qualityControl // hold quality settings at fixed values
```

The engine creates `dom`, `a11y` and `postProcess` the first time you read them, so a project pays for them only once it uses them. See [HTML overlays](/guides/html-overlays), [Accessibility](/guides/accessibility) and [Post-processing](/guides/post-processing).

The engine also has tween helpers, so the common cases can skip `engine.animation`:

```ts
await engine.tween(node.transform, { x: 400 }, { duration: 0.5 })
await engine.wait(0.2)
await engine.animate(node, { alpha: 0 }, { duration: 0.3 }) // ends if node is destroyed
```

The node slides to `x` 400, the code waits 0.2 seconds, and the node fades out. See [Animation](/guides/animation).

### Listen to engine events

`host.events` is the engine's {@link Emitter}, and {@link EngineEvents} lists every event. `on` returns a function that removes the listener.

```ts
const off = host.events.on('resize', ({ css, dpr }) => {
  console.log('canvas is now', css.w, 'x', css.h, 'at dpr', dpr)
})
off()
```

`frame` and `pointerMove` fire many times per second. In Svelte, subscribe to them with `host.events.on` inside a `$effect`, and use stores for events that fire now and then. {@link emitterStore} and {@link latestEventStore} turn other events into Svelte stores, and they log a warning when given `frame` or `pointerMove`. See [Architecture](/guides/architecture#the-svelte-boundary) for both patterns side by side.

### Reduce quality automatically

On a slow GPU the engine lowers the primary stage's quality on its own. It watches the frame interval and the CPU time of each frame, and acts when the frames are slow because the GPU is the bottleneck. Each step lowers one setting, such as the ambient occlusion resolution, the MSAA sample count, the shadow softness or the render scale. A 2D scene only goes through MSAA and the render scale. The engine only lowers quality, because each change rebuilds a render target.

Each step is logged to the console and emitted as `qualitychange` on `host.events`, with the new settings and the kinds of step taken. The conditions, the order of the steps and the timing are described on {@link RenderQuality.adaptive}.

```ts
host.events.on('qualitychange', ({ msaa, renderScale, steps }) => {
  console.info('quality lowered:', steps, 'msaa', msaa, 'scale', renderScale)
})
```

The console shows each step the engine takes, for example `msaa` followed by the new sample count. To keep the settings you start with, pass `quality: { adaptive: false }`. To keep one setting at a value while the engine still lowers the others, hold it with {@link QualityControl}:

```ts
host.engine.qualityControl.setFixed('msaa', 2)
```

The debug HUD's Quality panel uses the same controls.

### Respond to context loss

The browser can take the graphics context away, for example after a GPU reset. The two backends recover differently, and the host handles both.

A lost WebGL2 context can come back. The host emits `contextlost` and waits. When the context returns, the host rebuilds the GPU resources and emits `contextrestored`. The host gives up after three losses within 60 seconds, or when the browser reports the context as unrestorable. It then calls `onContextLost(restorable)` if you passed it, or else `onReload`, which reloads the page by default.

A lost WebGPU device stays lost, and a canvas element keeps its context type. The host emits `contextlost` and `backendlost`, then calls `onBackendLost`, or `onReload` if you passed no `onBackendLost`. To recover in place, the component that owns the canvas remounts on a new canvas element with `backend: 'webgl2'`.

```ts
import { createEngineHost } from 'stargazer'

const host = createEngineHost({
  canvas,
  onContextLost: (restorable) => {
    // WebGL2 recovery gave up. Rebuild the engine instead of reloading.
  },
  onBackendLost: () => {
    // WebGPU is gone. Remount on a new canvas with WebGL2.
  },
})
```

Both handlers replace the page reload, so each one has to leave the user with a working canvas. `mountEngine` takes `onBackendLost` as a parameter too. Re-key the canvas element, for example with a Svelte `{#key}` block, and pass `backend: 'webgl2'` on the remount.

### Respond to render failures

A shader that the browser rejects leaves the engine running. The program that needs it draws nothing, and everything else keeps rendering. The engine emits `renderfailure` once per failure, with the `source` and the compiler's `message`. The debug HUD's Rendering panel lists the same failures.

An error thrown while a stage renders halts that stage. It logs the error once and draws no more frames, and [`stage.faulted`](/module/render/stage#faulted) becomes `true`.

```ts
host.events.on('renderfailure', ({ source, message }) => {
  console.error('GPU resource failed:', source, message)
})

if (host.engine.primaryStage.faulted) {
  // Show an error page or remount the component.
}
```

Check `faulted` when a canvas stays frozen while the page is otherwise responsive.

Find out when your code runs in a frame with the [Architecture](/guides/architecture) guide.

## See also

- {@link EngineHost}: the lifecycle wrapper around one engine
- {@link createEngineHost}: builds a host for a canvas
- {@link mountEngine}: Svelte action that mounts a host
- {@link EngineHostOptions}: every host option
- {@link Engine}: the frame loop and the subsystems
- {@link selectGfxDevice}: picks the WebGPU or WebGL2 backend
- [Getting started](/guides/getting-started): build a first scene
- [Architecture](/guides/architecture): how the engine runs a frame
- [Scene graph](/guides/scene): nodes, behaviors and transforms
- [Camera](/guides/camera): viewport framing and zoom
- [Stages](/guides/stages): more canvases on the same clock
- [Debugging](/guides/debugging): the HUD and its panels
- [Diagnostics](/guides/diagnostics): the codes the engine reports
- [Testing](/guides/testing): running nodes and games in unit tests
