---
title: Camera
group: Features
order: 5
---

# Camera

A {@link CameraNode2D} is a node that frames a rect of the 2D world and shows it on the canvas element. After this page you can add a camera, convert between screen and world positions, animate and switch the view, and make it follow a node.

A {@link Stage} renders through its current 2D camera, and a scene shows content once it has one. Until then the canvas shows the clear color. The [Scene graph](/guides/scene) guide explains the tree the camera lives in.

## Basic usage

Add a camera in the scene builder and give it the world rect to show.

```ts
import { CameraNode2D } from 'stargazer'

await host.loadScene((scene) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)
})
```

The canvas shows the world from (0, 0) to (1920, 1080), scaled to fit. The first camera added to a stage becomes current. Loading a scene destroys the previous camera with the rest of the content, so each scene builder adds its own.

### The uniform fit

For a viewport of `W × H` world units and a canvas of `Cw × Ch` CSS pixels, the scale is `min(Cw / W, Ch / H)`. The viewport is centered on the canvas and nothing is stretched, so circles stay round. `visibleWorldRect()` returns the world rect that the whole canvas shows.

```ts
const visible = cam.visibleWorldRect()
```

On a 1000 by 1000 pixel canvas, this viewport scales by about 0.52, and `visible` is `{ x: 0, y: -420, width: 1920, height: 1920 }`. The extra space on the longer axis shows more of the world, or the clear color where nothing is drawn. The stage refits the camera when the canvas changes size.

### Converting between screen and world

`worldToScreen(x, y)` maps a world point to CSS pixels from the canvas's top left corner. `screenToWorld(x, y)` maps the other way.

```ts
const p = cam.worldToScreen(ball.transform.x, ball.transform.y)
label.style.left = `${p.x}px` // an HTML label over the ball
```

Both take an optional `out` object to fill, which keeps a call in a hot loop from allocating. Pointer events already carry world positions, see [Input](/guides/input). For HTML that follows a node, use [HTML overlays](/guides/html-overlays).

### Animating the view

[`animateTo`](/module/camera/cameranode2d#animateto) moves and resizes the viewport over time, a combined pan and zoom.

```ts
import { easings } from 'stargazer'

await cam.animateTo(
  { x: 0, y: 380, width: 661, height: 520 },
  { duration: 0.5, easing: easings.inOutQuad },
)
```

The view glides to the new rect and the promise resolves when it arrives. It rejects with an `AbortError` when the `signal` option aborts. The other options are in {@link CameraAnimateOptions}. The animation runs on engine time, so it holds while the engine is paused.

### Switching cameras

A stage holds any number of cameras and renders through the current one. [`makeCurrent`](/module/camera/cameranode2d#makecurrent) switches.

```ts
const closeUp = new CameraNode2D()
closeUp.setViewport({ x: 200, y: 100, width: 400, height: 300 })
scene.root.add(closeUp)
closeUp.makeCurrent()
```

The stage now shows the close-up rect. `cam.isCurrent` tells whether a camera is the current one. A `makeCurrent()` call before the camera is in a tree takes effect when it is added.

## Advanced usage

Reach for these parts to follow a node, choose which camera is current, size strokes by zoom, keep a heads-up display off the camera, or work with the debug camera.

### Moving, zooming and rotating the camera node

A camera is a {@link Node2D}, so its `transform` works on the view. Moving the camera node pans the view, rotating it rotates the view, and [`zoom`](/module/camera/cameranode2d#zoom) zooms. A larger `zoom` is closer. To follow a node, make the camera its child and frame a rect centered on the origin.

```ts
import { CameraNode2D, ShapeNode } from 'stargazer'

const hero = new ShapeNode({
  geometry: { kind: 'circle', radius: 30 },
  fill: '#ffd34d',
})
scene.root.add(hero)

const follow = new CameraNode2D()
follow.setViewport({ x: -960, y: -540, width: 1920, height: 1080 })
follow.zoom = 2
hero.add(follow)
follow.makeCurrent()
```

The hero stays at the center of the canvas while it moves, and the world shows at twice the size. The viewport sets the base fit, and the camera's world transform offsets the view on top of it. A camera with only a viewport has an identity transform, so it is a fixed window. A camera is a leaf node, so add other nodes to the camera's parent.

`zoom` sets `transform.scaleX` and `transform.scaleY` to `1 / zoom`, because scaling a camera up shows more of the world.

[`clearFraming`](/module/camera/cameranode2d#clearframing) switches to a pure transform camera. One world unit is then one CSS pixel, the canvas is centered on the camera's position, and the transform does all panning, zooming and rotating. `setViewport` or `animateTo` turns framing back on, and `cam.framingEnabled` tells which mode is active.

### How the current camera is picked

The first camera added to a stage is current. When the current camera is disabled, removed or destroyed, the enabled camera with the highest `priority` takes over, and the earliest added wins among equals.

```ts
const overview = new CameraNode2D()
overview.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
const closeUp = new CameraNode2D()
closeUp.setViewport({ x: 200, y: 100, width: 400, height: 300 })
scene.root.add(overview, closeUp) // overview is current

overview.enabled = false // closeUp takes over
```

When no enabled camera is left, `currentCamera2D` is `null`. `clearCurrent(false)` cancels a `makeCurrent()` that is still waiting for the camera to join a tree.

### Canceling a camera animation

A second `animateTo` runs next to the first, so the two animations write the viewport together. To replace a running animation, keep an `AbortController`, abort it, and pass the new signal.

```ts
import { ignoreAbort, type Rect } from 'stargazer'

let controller: AbortController | null = null

async function zoomTo(rect: Rect): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  await cam
    .animateTo(rect, { duration: 0.5, signal: controller.signal })
    .catch(ignoreAbort)
}
```

The first animation stops where it is and the second continues from there. `animateTo` on a destroyed camera rejects with an `AbortError` too, and `ignoreAbort` covers both.

### Stroke space scale

[`strokeSpaceScale`](/module/camera/cameranode2d#strokespacescale) returns the number of world units in one CSS pixel. Multiply a length in CSS pixels by it to get a world length that looks the same at any zoom. It accounts for the viewport fit and the camera's `zoom`, and it returns 1 until the camera knows the canvas size. [`screenPxPerWorldUnit`](/module/camera/cameranode2d#screenpxperworldunit) is the inverse.

The stroked nodes ({@link ShapeNode}, {@link Path2DNode}, {@link PolylineNode}) apply the scale themselves while `strokeSpace` is `'screen'`, the default. A custom node writes a stroke width as `{ screen: n }` inside `paint`.

```ts
override paint(canvas: Canvas): void {
  canvas.strokePolyline(this.points, this.count, {
    color: '#ffd34d',
    width: { screen: 1.5 },
  })
}
```

The line stays 1.5 CSS pixels wide at any zoom, and the node's picture stays valid across zooms. For other lengths, such as dash lengths, `canvas.screenScale()` returns the same value, and the node repaints when it changes. `canvas.visibleWorldRect()` is the other camera value `paint` can read. It repaints the node whenever the view changes, so use it for content that fills the visible area. See [Scene graph](/guides/scene) for `strokeSpace` and [Drawing](/guides/drawing) for the rest of `Canvas`.

### Layers and the camera

The camera places everything in the tree. A heads-up display stays put when a {@link Layer} with a `space` of `'screen'` or a frame places its subtree by a view of its own. See [Layers](/guides/scene#layers).

{@link viewFor} returns the view that places a node: the layer's view under such a layer, and the stage's camera otherwise. Use it to find a node's position on screen. A frame layer fits its frame into the canvas the same way a camera fits its viewport.

### The debug camera and the active camera

`engine.currentCamera2D` is the primary stage's current camera, the one the game controls. `engine.activeCamera` is the view on screen right now: the current camera, or the debug camera while it is engaged. See [Debugging](/guides/debugging).

The renderer and the input system both use the active camera, so a tap on a shape still works while the debug camera pans around it. The debug camera replaces the stage's camera and leaves a layer's view alone. HTML overlays and the debug overlays project through the view that places each node, so they follow a moved, zoomed, rotated or parented camera.

### Canvas size

The stage tells every camera in its tree the canvas size in CSS pixels whenever the canvas resizes, through `ResizeObserver` and the window's `resize` event. A camera that becomes current later already has the right fit. The renderer applies the device pixel ratio itself, so every camera value is in CSS pixels.

## Common problems

### The canvas shows only the clear color

The stage has no current camera. Add a `CameraNode2D` in the scene builder, as in the first example. The canvas shows the clear color also when the only camera is disabled, or was destroyed with the previous scene.

### Adding a node to a camera throws

A camera is a leaf node. Add the node to the camera's parent instead, and add the camera next to it.

```ts
hero.add(follow) // follow is a CameraNode2D
hero.add(marker) // not follow.add(marker)
```

## Next step

React to the player with pointer handlers, buttons and drag and drop in [Input](/guides/input).

## See also

- {@link CameraNode2D}: the 2D camera node
- {@link CameraView2D}: the view queries every 2D view answers
- {@link CameraAnimateOptions}: options for `animateTo`
- {@link CameraNode3D}: the 3D camera, see [3D](/guides/3d)
- {@link viewFor}: the view that places a node
- [Scene graph](/guides/scene): nodes, layers and stroke space
- [Input](/guides/input): pointer positions in world space
- [Stages](/guides/stages): one camera per stage
