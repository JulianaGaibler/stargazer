---
title: HTML overlays
group: Features
order: 19
---

# HTML overlays

Menus, pause screens and forms are easier to build in HTML than to draw on the canvas. An HTML overlay attaches an element to a scene node, and each frame the engine sets the element's CSS `transform` so it sits over the node. The node's position, scale, rotation and pivot apply, and the camera's pan and zoom apply on top. After this guide you can pin a menu to a node, switch views by moving the camera, and anchor HTML in a heads-up display.

The engine sets only the element's position and size. The contents stay yours. Attach elements with the {@link domAnchor} Svelte action or with `engine.dom`, a {@link DomTransformSync}.

## Basic usage

In Svelte, add the `domAnchor` action to the element and give it the engine, the node and the size of the node's rect in world units.

```svelte
<script lang="ts">
  import { domAnchor } from 'stargazer'
</script>

<div
  use:domAnchor={{
    engine: host.engine,
    node,
    size: { width: 480, height: 320 },
  }}
>
  <Menu />
</div>
```

The element is 480 by 320 world units and covers the node's local area from `(0, 0)` to `(480, 320)`. When the camera pans or zooms, the element moves and scales with the scene. The action attaches on mount and detaches on unmount.

In plain TypeScript, call [`engine.dom.attach`](/module/dom/domtransformsync#attach) and keep the handle it returns.

```ts
import type { Engine, Node2D } from 'stargazer'

declare const engine: Engine
declare const node: Node2D
declare const element: HTMLElement

const handle = engine.dom.attach(node, element, {
  size: { width: 480, height: 320 },
})
// later
handle.detach()
```

In both cases the element detaches by itself when its node is destroyed.

### Put the element over the canvas

The engine sets the element's `transform` and measures it from the top-left corner of the canvas element. Place the element in a container that covers exactly the same rect as the canvas. Padding, a border or an offset on that container shifts every element away from the scene.

The usual setup is a wrapper that holds the canvas element and an overlay container on top of it.

```svelte
<div class="stage">
  <canvas use:mountEngine={{ onReady }}></canvas>
  <div class="overlay">
    <div use:domAnchor={{ engine, node, size }}>
      <Menu />
    </div>
  </div>
</div>

<style>
  .stage {
    position: relative;
  }
  .overlay {
    position: absolute;
    inset: 0; /* same rect as the canvas, no padding or border */
    pointer-events: none; /* clicks fall through to the canvas */
  }
  .overlay button {
    pointer-events: auto; /* buttons still get clicks */
  }
</style>
```

The overlay container passes pointer events to the canvas element. Set `pointer-events: auto` on the elements that need clicks.

On attach, the engine sets the element's `position` to `absolute`, its `left`, `top` and `margin` to `0`, and its `transform-origin` to the top-left corner. The element stays hidden until the first frame places it.

### Cover the node's rect

With `size`, the engine sets the element's CSS `width` and `height` to that size in world units. One CSS pixel of the element is one world unit before the transform. The element's top-left corner is the node's local origin, the point the node draws from, with its pivot applied. The engine then applies the node's world transform and the camera, so the element covers the area where the canvas draws the node.

Lay out the content against that box. In this example the menu stays centered on the node wherever the camera goes.

```svelte
<div use:domAnchor={{ engine, node, size: { width: 1920, height: 1080 } }}>
  <!-- 1920 by 1080 before the transform, the engine scales it to the screen -->
  <div class="menu">
    <h1>Paused</h1>
    <button onclick={resume}>Resume</button>
  </div>
</div>

<style>
  .menu {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
  }
</style>
```

The camera's scale is a CSS transform, so text stays sharp at every zoom level.

### Anchor a point

To pin a label or a badge to a point in the world, attach the element and omit `size`. The engine anchors the element's top-left corner to the node's origin, and the element keeps its own CSS width and height. The node's transform and the camera still apply, so the element scales and rotates with the scene.

```ts
engine.dom.attach(markerNode, badgeElement)
```

### Common problems

An overlay sits in the wrong place, shifted by a constant offset. The container around it does not cover the canvas element exactly. Remove its padding, border and offset, or use `position: absolute; inset: 0` as in the wrapper earlier on this page.

An overlay never appears. No camera places its node yet, or the canvas has size zero. The engine hides the element until a camera frames the node. Add a {@link CameraNode2D} to the scene and call `makeCurrent()`.

An overlay's text turns blurry when the camera zooms in. The element has `will-change: transform`, so the browser scales a fixed-size image of it. Remove the property.

## Advanced usage

### Attach options

[`attach`](/module/dom/domtransformsync#attach) and `domAnchor` take {@link DomAttachOptions}. This example sets the options a first project reaches for. The type lists the rest.

```ts
engine.dom.attach(node, element, {
  size: { width: 480, height: 320 },
  syncOpacity: true,
  cull: true,
})
```

`syncOpacity` sets the element's `opacity` to the node's `alpha` multiplied by its ancestors' `alpha`. It is off by default so a CSS fade of your own keeps working. `cull` hides the element with `display: none` once its rect is fully outside the canvas. When you omit `size`, `cull` tests the node's origin point.

The engine also hides the element when no camera places the node, and while the camera's mapping is degenerate, such as during a resize to zero size.

### Change options or detach

The {@link DomAttachment} handle has [`setOptions`](/module/dom/domattachment#setoptions), which replaces all options at once, for example with a new `size`. [`detach`](/module/dom/domattachment#detach) stops the sync and leaves the element's styles as they were last written.

```ts
handle.setOptions({ size: { width: 640, height: 360 }, cull: true })
handle.detach()
```

The `domAnchor` action calls `setOptions` when its parameters change. It detaches and attaches again only when `engine` or `node` changes, so an inline parameter object costs nothing extra.

### Switch views with the camera

With `cull`, a camera move is the whole transition between two views. Place each view's UI on a node in its own region of the world and pass `cull: true`. To switch, animate the camera.

```svelte
<script lang="ts">
  import { Node2D, domAnchor } from 'stargazer'

  const { engine } = $props()

  // Two regions side by side: the menu at x = 0, the board at x = 2000.
  const menuAnchor = new Node2D('menu-region')
  const boardAnchor = new Node2D('board-region')
  boardAnchor.transform.x = 2000
  engine.tree.root.add(menuAnchor)
  engine.tree.root.add(boardAnchor)

  const size = { width: 1920, height: 1080 }

  function showBoard() {
    engine.currentCamera2D?.animateTo(
      { x: 2000, y: 0, width: 1920, height: 1080 },
      { duration: 0.6 },
    )
  }
</script>

<div use:domAnchor={{ engine, node: menuAnchor, size, cull: true }}>
  <MainMenu onPlay={showBoard} />
</div>
<div use:domAnchor={{ engine, node: boardAnchor, size, cull: true }}>
  <BoardControls />
</div>
```

During the pan, the menu slides off the left edge and gets `display: none`, which also removes it from page layout and hit testing. The board controls slide in and show themselves. Panning back reverses it.

### Anchor to a layer

An overlay follows the view that places its node. A node under a {@link Layer} with a `space` of `'screen'` or a frame is placed by the layer, so its element stays still while the camera pans and zooms. Use this for HTML in a heads-up display: lay out the display for a fixed design rect and anchor each element to a node in it.

```ts
import { Layer, Node2D } from 'stargazer'

const ui = new Layer({
  space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
})
engine.tree.root.add(ui)

const panel = new Node2D('panel')
panel.transform.x = 1500
ui.add(panel)
// use:domAnchor={{ engine, node: panel, size: { width: 360, height: 200 } }}
```

The element scales with the frame, so the markup keeps its layout at any canvas shape. While the debug camera is on, it replaces the stage camera for overlays too, and a layer's own view stays as it is.

### Anchor to a 3D node

[`engine.dom.attachWorld3d`](/module/dom/domtransformsync#attachworld3d) and the {@link domAnchor3d} action pin an element to a {@link Node3D}. By default the element stays upright on screen, is centered on the node's projected origin, and hides when the node is behind the camera.

```ts
engine.dom.attachWorld3d(cube, labelElement, camera, {
  scaleWithDistance: true,
})
```

The label shrinks as the cube moves away. {@link Dom3DAttachOptions} also has a mode that tilts the element with the node's surface. See the [3D guide](/guides/3d).

### Stacking order

Two overlays overlap by their DOM order or their CSS `z-index`. To put one on top, reorder the elements or set `z-index`. The depth of their nodes in the scene graph has no effect.

### Cost and timing

The sync runs once per frame, on the engine's `frame` event, after every stage has rendered, so the element and the canvas change on the same frame. The engine writes `transform` only when the matrix changed, so a still overlay costs no style writes, and it writes `width` and `height` only when `size` changes. Browsers apply `transform` and `opacity` changes without page layout.

`engine.dom` is created the first time you read it, and the sync runs from then on.

### Project a matrix yourself

{@link projectWorldToCss} is the function behind the sync. It combines a camera's screen affine with a node's world matrix into the six values of a CSS `matrix()`. Use it when you place an element yourself.

```ts
import { projectWorldToCss } from 'stargazer'

const m = projectWorldToCss(camera.getScreenAffine(), node.transform.world)
element.style.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`
```

## Next step

Make the canvas content readable to screen readers, and link a canvas node to an overlay, in the [Accessibility guide](/guides/accessibility).

## See also

- {@link DomTransformSync}: the per-engine overlay manager, reached as `engine.dom`
- {@link DomAttachOptions}: options for a 2D overlay
- {@link domAnchor}: the Svelte action for a 2D node
- {@link domAnchor3d}: the Svelte action for a 3D node
- {@link projectWorldToCss}: the projection the sync uses
- [Camera](/guides/camera): pan, zoom and `animateTo`
- [Scene graph](/guides/scene): layers and visibility
- [3D](/guides/3d): overlays on 3D nodes
- [Accessibility](/guides/accessibility): screen reader access for canvas content
