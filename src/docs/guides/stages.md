---
title: Stages
group: Features
order: 21
---

# Stages

A {@link Stage} is one canvas with its own scene tree, cameras and render target. The engine creates a primary stage for its own canvas, and [`engine.attachStage`](/module/engine/engine#attachstage) adds secondary stages that draw other scenes into other canvases on the same page. After this page you can attach, park and detach a secondary stage, give it pointer input, and render a scene to an image.

Use a secondary stage when you want a second render surface on the same clock as the first, such as a small animated card next to the main view, a tutorial view or a preview panel. All stages share one frame loop and one tween animator, so animations on two canvases stay in step.

To layer content inside one scene, use a {@link Layer} in the same tree. A heads-up display that ignores the camera, or content with its own post-processing, belongs in a layer, and a layer needs no second canvas or GPU context. See [Scene graph](/guides/scene) and [Post-processing](/guides/post-processing).

## Basic usage

This example attaches a stage to a second canvas and draws a circle on it. `engine` is `host.engine`.

```ts
import { CameraNode2D, ShapeNode } from '@julianagaibler/stargazer'

const stage = engine.attachStage(cardCanvas, { name: 'card' })

const cam = new CameraNode2D()
cam.setViewport({ x: -120, y: -80, width: 240, height: 160 })
stage.tree.root.add(cam)

stage.tree.root.add(
  new ShapeNode({ geometry: { kind: 'circle', radius: 14 }, fill: '#c084fc' }),
)
```

The circle appears in the center of `cardCanvas`, over the page background, because a secondary stage is transparent by default. A secondary stage shows content once its tree has a {@link CameraNode2D}, as the primary stage does.

### Detach a stage

Detach a stage when its canvas goes away:

```ts
engine.detachStage(stage)
```

Detaching destroys the stage's tree. Every node's `abortSignal` fires, so node tweens reject with `AbortError`. It also removes the stage's input handling and resize observer and frees its GPU resources, which includes losing the canvas's WebGL context, so give a later stage a new canvas element. `engine.destroy()` detaches every secondary stage before it destroys the primary.

### Mount a stage in Svelte

The {@link mountStage} action attaches a stage when the canvas mounts and detaches it when the canvas unmounts.

```svelte
<script lang="ts">
  import { mountStage, CameraNode2D } from '@julianagaibler/stargazer'
  import type { Engine, Stage } from '@julianagaibler/stargazer'

  const { engine }: { engine: Engine } = $props()

  function buildScene(stage: Stage): void {
    const cam = new CameraNode2D()
    cam.setViewport({ x: -100, y: -100, width: 200, height: 200 })
    stage.tree.root.add(cam)
    // Add the rest of the scene under stage.tree.root.
  }
</script>

<canvas
  use:mountStage={{
    engine,
    options: { name: 'preview' },
    onReady: buildScene,
  }}
></canvas>
```

`options` goes to `attachStage`, and `onReady` builds the scene after the stage is attached. An optional `onDestroy` runs before the stage is detached.

### Take pointer input

Pass `interactive: true` and the nodes on a secondary stage receive pointer events, the same way nodes on the primary stage do.

```ts
import { ShapeNode } from '@julianagaibler/stargazer'

const stage = engine.attachStage(cardCanvas, { interactive: true })

const marker = new ShapeNode({
  geometry: { kind: 'circle', radius: 14 },
  fill: '#c084fc',
})
marker.bindPointer({
  singlePointer: true,
  move: (e) => {
    marker.transform.x = e.pointer.world.x
    marker.transform.y = e.pointer.world.y
  },
})
stage.tree.root.add(marker)
```

The marker follows a finger or the mouse while it is pressed on the marker. The stage hit-tests its own tree and maps pointers through its own current camera.

The stage emits `pointerDown`, `pointerMove`, `pointerUp` and `pointerCancel` on `stage.events`. Listen on `stage.events` for taps on a secondary canvas, which keeps them apart from the main view's handlers on `engine.events`. The primary stage's pointer events reach `engine.events`. See [Input](/guides/input).

Each canvas captures its own pointers. A pointer that goes down on one canvas stays with that canvas when it moves onto another, so a finger on the primary canvas and a finger on a secondary canvas work at the same time.

### Park a stage

[`stage.setActive(false)`](/module/render/stage#setactive) takes a stage out of the frame: the engine skips its updates, transforms and rendering. `setActive(true)` brings it back at once, with no setup and no new GPU context, so you can keep a stage prepared and parked until it is needed.

```ts
stage.setActive(false) // parked
stage.setActive(true) // drawing again on the next frame
```

## Advanced usage

### Stage options

[`attachStage`](/module/engine/engine#attachstage) takes {@link StageOptions}, and every field is optional. This example makes an opaque, lower-resolution stage that reports its size:

```ts
const stage = engine.attachStage(previewCanvas, {
  name: 'preview',
  transparent: false,
  clearColor: '#101018',
  renderScale: 0.5,
  onResize: ({ cssSize }) => {
    // Reposition anchored nodes for the new size.
  },
})
```

The stage clears to `#101018` each frame and renders at half the canvas's CSS size times the pixel ratio, and the browser scales the result up. `renderScale` is one setting for a stage whose cost grows with its pixel count, because the 3D pass and post-processing render at the lower resolution too. [`stage.renderScale`](/module/render/stage#renderscale) can also change while the stage runs, and the engine lowers it on the primary stage when the GPU is the bottleneck. See [Engine setup](/guides/setup).

The type lists the other options, such as `msaaSamples`, `physics`, `fixedPixelSize` and `exactText`, with their defaults.

### What stages share

All stages share the {@link Ticker}, so one animation frame drives every stage. They share the tween animator, so `engine.animation.cancelAll()` stops tweens on every stage, and they share the pause flag, so `engine.setPaused(true)` pauses updates on every stage. A tween on a secondary stage advances in the same frame and by the same `dt` as one on the primary stage:

```ts
engine.animate(mainNode, { x: 700 }, { duration: 2 })
engine.animate(cardNode, { x: 100 }, { duration: 2 })
// Both tweens end on the same frame.
```

`onUpdate` and `onFixedStep` run on every active stage, and the fixed step can run several times in one frame, so keep fixed-step work small when you attach several stages.

Each stage has its own scene tree, cameras, render target, GPU context, texture caches and input. Text that appears on two stages is rasterized once per stage. Asset data holds no GPU handles, so one instance can back nodes on several stages. This includes a `Path2D`, a {@link BitmapMask}, an image, and the tessellations from {@link parseSvgPaths}.

```ts
import { Path2DNode, parseSvgPaths } from '@julianagaibler/stargazer'

const { paths } = parseSvgPaths(svgSource, { tessellate: true })
const badge = paths.get('badge')!.path

engine.tree.root.add(new Path2DNode({ path: badge, fill: '#88c' }))
stage.tree.root.add(new Path2DNode({ path: badge, fill: '#fff' }))
```

### Resize and pixel ratio

Every stage watches its canvas with a `ResizeObserver` and listens for `window` resize. When the CSS size or the device pixel ratio changes, the stage sizes the backing store to the CSS size times the pixel ratio times `renderScale`, resizes its render target, refits every 2D camera, and calls `onResize`. The engine's `resize` event fires for the primary canvas.

Set `fixedPixelSize` for a stage that should render at an exact size, with a pixel ratio of 1. Such a stage ignores CSS size changes, so its canvas can sit outside the document. [`stage.setFixedPixelSize`](/module/render/stage#setfixedpixelsize) changes the size later.

### Capture a scene as an image

[`engine.capture`](/module/engine/engine#capture) renders a scene to an `ImageBitmap`, and [`engine.captureBlob`](/module/engine/engine#captureblob) encodes it as an image file such as a PNG or a JPEG. Use them for a thumbnail, a share image, or any still that should look like the rest of the app.

This example encodes a 400 by 200 pixel card with a gradient and a title as a JPEG.

```ts
import {
  ShapeNode,
  TextNode,
  cssLinearGradient,
} from '@julianagaibler/stargazer'

const jpeg = await engine.captureBlob({
  width: 400,
  height: 200,
  type: 'image/jpeg',
  quality: 0.9,
  clearColor: '#0d1a2c',
  build: (root) => {
    root.add(
      new ShapeNode({
        geometry: { kind: 'rect', width: 400, height: 200, centered: false },
        fill: cssLinearGradient(400, 200, 135, [
          { offset: 0, color: '#ff6600' },
          { offset: 1, color: '#fb2872' },
        ]),
      }),
    )
    root.add(
      new TextNode({
        text: 'Level 3',
        x: 24,
        y: 120,
        fontSize: 48,
        color: '#fff',
      }),
    )
  },
})
```

`build` adds the scene to `root`, where one unit is one pixel and the origin is the top left corner. The image is exactly 400 by 200 pixels, whatever the display's pixel ratio. A capture has a transparent background unless you pass a `clearColor`, so set one for a type such as JPEG that has no alpha channel. `build` can be async, so it can load fonts and images before it adds nodes.

A capture renders outside the frame loop, so it also works while the engine is stopped or paused. Captures run one at a time, in the order they were called. Choose `capture` for an image to draw again, for example on another canvas, and `captureBlob` for a file to save, send, or show in an `<img>` element.

All captures go through one inactive secondary stage, created on the first capture. Each capture destroys the scene it built once the image is taken, and the stage and its GPU context are detached after {@link CAPTURE_IDLE_RELEASE_SEC} seconds after the last capture or when the engine is destroyed. {@link CaptureOptions} describes `settleFrames`, which sets how many frames render before the image is taken. A layer whose effects are still compiling draws unprocessed, so the capture waits for the compile and renders its frames again.

### Physics on a stage

The engine steps every registered physics world, whether or not its stage is active. A parked stage keeps simulating the bodies in its world. Call [`stage.clearScene()`](/module/render/stage#clearscene) before you park the stage, which destroys the nodes, removes the bodies their `RigidBodyBehavior`s added, and unregisters the worlds of their {@link PhysicsWorldBehavior}s. A node on a secondary stage uses that stage's world when you pass `world: stage.physics` to its `RigidBodyBehavior`. See [Physics](/guides/physics).

### Backend and context loss

A secondary stage creates its own WebGL2 context, also when the primary stage uses WebGPU. `await selectGfxDevice(canvas)` from {@link selectGfxDevice} resolves to an object whose `device` you can pass as the `gpuDevice` option to draw a secondary stage with WebGPU.

The host recovers a lost context on the primary canvas. See [Engine setup](/guides/setup). For a secondary stage, listen for `webglcontextrestored` on its canvas and call [`stage.reacquireContext()`](/module/render/stage#reacquirecontext), or detach the stage and attach it again on a new canvas.

```ts
cardCanvas.addEventListener('webglcontextrestored', () => {
  stage.reacquireContext()
})
```

## Common problems

**A secondary canvas shows only the page background.** The stage's tree has no camera. Add a `CameraNode2D` to `stage.tree.root` as in the first example.

**`attachStage` throws that the canvas is already attached.** A canvas holds one stage, and the primary canvas already has one. Attach each stage to its own canvas element.

**A tap on a secondary canvas does not reach `engine.events`.** Secondary stages report pointers on `stage.events`, and they need `interactive: true`.

**A parked stage still simulates physics.** The engine steps every registered world. Call `stage.clearScene()` before `setActive(false)`.

## See also

- {@link Stage}: one canvas with its own tree
- {@link StageOptions}: options for `attachStage`
- {@link CaptureOptions}, {@link CaptureBlobOptions}: options for `capture` and `captureBlob`
- {@link Engine}: owns the primary stage and attaches the others
- {@link mountStage}: Svelte action that attaches a stage
- [Engine setup](/guides/setup): mounting the engine and context loss
- [Architecture](/guides/architecture): what a frame does on each stage
- [Input](/guides/input): pointer events and capture
- [Scene graph](/guides/scene): layers inside one scene
