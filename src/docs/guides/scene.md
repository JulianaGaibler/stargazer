---
title: Scene graph
group: Getting started
order: 4
---

# Scene graph

Everything a stage draws lives in one tree of nodes. A {@link SceneTree} holds 2D nodes ({@link Node2D}) and 3D nodes ({@link Node3D}) under a single root, `tree.root`. The root is a {@link GroupNode}, a node with no transform of its own. After this guide you can add nodes, move and nest them, attach logic, reuse parts of a scene, and remove what you are finished with.

Each {@link Stage} owns one tree. `engine.tree` is the primary stage's tree, and a stage from `engine.attachStage(...)` has its own as `stage.tree`. See [Stages](/guides/stages) for a second canvas. This guide covers the 2D side. See [3D](/guides/3d) for {@link Node3D}.

## Basic usage

A scene builder adds nodes to the tree, and the nodes you add control what the stage shows.

### Add nodes

A scene builder passed to `host.loadScene` adds a camera and some content to the root. The host comes from {@link createEngineHost}, see [Setup](/guides/setup).

```ts
import { CameraNode2D, ShapeNode } from '@julianagaibler/stargazer'

await host.loadScene((scene) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)

  const ball = new ShapeNode({
    geometry: { kind: 'circle', radius: 60 },
    fill: '#ffd34d',
  })
  ball.transform.x = 960
  ball.transform.y = 540
  scene.root.add(ball)
})
```

The camera frames a 1920 by 1080 world rectangle, and a yellow circle sits in its center. A scene shows content once it has a camera, and until then the canvas shows the clear color. `loadScene` destroys the previous scene's content before it calls the builder, so each builder adds its own camera. See [Camera](/guides/camera).

`parent.add(a, b)` appends children in argument order, and `parent.remove(child)` detaches one. Adding a node that already has a parent moves it. `tree.add(...)` is shorthand for `tree.root.add(...)`. A plain `Node2D` draws nothing, so it works as a container that moves its children together.

### Choose built-in nodes or a custom node

Start with the built-in nodes. {@link ShapeNode}, {@link Path2DNode}, {@link PolylineNode}, {@link TextNode}, {@link ImageNode} and the other ready-made nodes describe what to show through options. A card with a border and a label is a `ShapeNode` and a `TextNode` under one parent:

```ts
import { Node2D, ShapeNode, TextNode } from '@julianagaibler/stargazer'

const card = new Node2D('card')
card.add(
  new ShapeNode({
    geometry: { kind: 'rect', width: 240, height: 140, radii: 16 },
    fill: '#1b2a44',
    stroke: '#ffd34d',
    lineWidth: 3,
  }),
  new TextNode({
    text: 'Card',
    fontSize: 28,
    sizeSpace: 'world',
    color: '#fff',
    align: 'center',
    baseline: 'middle',
  }),
)
card.transform.x = 960
card.transform.y = 540
scene.root.add(card)
```

When no built-in node draws what you need, or one node should draw many things such as a grid or a gauge, subclass `Node2D` and override `paint`. The engine records the draw commands you call on the {@link Canvas} into a picture and replays the picture every frame. The same card as one custom node:

```ts
import {
  Node2D,
  definePaintProps,
  type Canvas,
} from '@julianagaibler/stargazer'

class Card extends Node2D {
  declare label: string
  constructor(label: string) {
    super('card')
    definePaintProps(this, { label })
  }
  override paint(canvas: Canvas): void {
    canvas.fillAndStrokeRoundRect(-120, -70, 240, 140, 16, '#1b2a44', {
      color: '#ffd34d',
      width: { screen: 3 },
    })
    canvas.fillText(this.label, 0, 0, {
      font: '28px sans-serif',
      color: '#fff',
      align: 'center',
      baseline: 'middle',
    })
  }
}

const card = new Card('Card')
card.transform.x = 960
card.transform.y = 540
scene.root.add(card)
```

Both versions draw the same picture. The built-in nodes also handle bounds, hit testing and stroke scaling, so they are the shorter path for shapes, text and images. A `ShapeNode` rect is centered on the node origin, so the `Canvas` call starts at `-120, -70`, because `Canvas` rect calls take a top-left corner.

{@link definePaintProps} declares the fields that `paint` reads. Writing a new value to one, by hand or by a tween, runs `paint` again, so `card.label = 'Play'` redraws the card. Declare the fields with `declare` and no initializer, because a class field with an initializer hides the property. The [Drawing](/guides/drawing) guide covers the `Canvas` calls, and [When a node repaints](#when-a-node-repaints) lists what triggers `paint`.

### Move nodes

`node.transform` is a {@link Transform2D}. Set its fields directly:

```ts
node.transform.x = 100
node.transform.y = 200
node.transform.rotation = Math.PI / 4 // radians, clockwise
node.transform.scaleX = 2
node.transform.alpha = 0.5
```

The node moves 100 units right and 200 down, turns an eighth of a turn, doubles in width and becomes half transparent. Positions are in the parent's local space, so a child moves, turns and scales with its parent. `originX` and `originY` are the pivot that scale and rotation turn around. {@link Transform2D} lists the other fields.

To animate a transform, use `node.tween(...)` instead of changing fields every frame. See [Animation](/guides/animation).

### Nest nodes and set draw order

2D content draws in tree order: a parent first, then its children in the order they were added, then the parent's next sibling. A later node draws over an earlier one, so a backdrop is the first node you add. To draw a node under nodes added before it, insert it at a position:

```ts
const backdrop = new ShapeNode({
  geometry: { kind: 'rect', width: 1920, height: 1080 },
  fill: '#16243d',
})
scene.root.addAt(backdrop, 0)
scene.root.insertBefore(backdrop, card)
```

`addAt(node, index)` and `insertBefore(node, reference)` both move a node that is already a child of that parent. You can change the tree at any time.

`node.visible = false` hides the node and everything under it, for drawing and for hit testing. A hidden subtree still updates, so destroy a subtree you are finished with instead of hiding it. {@link isEffectivelyVisible} tells you whether a node is visible with its ancestors taken into account.

`transform.alpha` multiplies into everything under the node, so a parent fades its whole subtree. The alpha applies to each drawing separately, so overlapping parts of a translucent group show through each other. Set `compositeGroup = true` on the parent to fade the group as one flat image. See [Groups, blend modes and mattes](#groups-blend-modes-and-mattes).

### Attach behaviors

A {@link Behavior} attaches logic to a node. Extend it, override the hooks you need, and attach an instance with `addBehavior`:

```ts
import { Behavior } from '@julianagaibler/stargazer'

class Spin extends Behavior {
  radPerSec: number
  constructor(radPerSec: number) {
    super()
    this.radPerSec = radPerSec
  }
  override onUpdate(dt: number): void {
    this.node.transform.rotation += this.radPerSec * dt
  }
}

node.addBehavior(new Spin(0.5))
```

The node spins half a radian per second. A behavior reaches its node through `this.node`. `getBehavior(Spin)` returns the first attached behavior of that class, or `null`, and `getBehaviors(Spin)` returns all of them. Both match subclasses. `removeBehavior(b)` detaches one. The hooks are listed on {@link Behavior}.

### Destroy nodes

`node.destroy()` destroys the node and its whole subtree, detaches its behaviors, and removes it from its parent. Calling it again changes nothing.

Destroying a node aborts `node.abortSignal`. Every `node.tween(...)` and `node.wait(...)` is tied to that signal, so it rejects with an `AbortError` when the node is destroyed. Pass {@link ignoreAbort} to `.catch` to treat that rejection as a normal end:

```ts
import { easings, ignoreAbort } from '@julianagaibler/stargazer'

await node
  .tween({ alpha: 0 }, { duration: 0.5, easing: easings.outCubic })
  .catch(ignoreAbort)
node.destroy()
```

The node fades out over half a second and then leaves the scene. If something else destroys the node first, the `await` ends quietly and `destroy()` has nothing left to do.

### Reuse nodes with builders

To reuse part of a tree, write a function that builds and returns it. Each call returns an independent copy, and builders can call other builders.

```ts
function buildBall(): Node2D {
  const ball = new ShapeNode({
    geometry: { kind: 'circle', radius: 20 },
    fill: '#ffd34d',
  })
  ball.addBehavior(new Spin(1))
  return ball
}

function buildArena(): Node2D {
  const arena = new Node2D('arena')
  arena.add(buildBall())
  return arena
}

const left = buildArena()
const right = buildArena()
right.transform.x = 400
scene.root.add(left, right)
```

Two arenas appear side by side, each with its own spinning ball. Attach behaviors in the builder to make the subtree self-contained. A {@link PhysicsWorldBehavior}, for example, gives a subtree its own physics world, so two arenas simulate independently. See [Physics](/guides/physics).

A node can also keep an HTML element aligned with it. See [HTML overlays](/guides/html-overlays).

## Advanced usage

Reach for these parts when a scene needs input, effects on a subtree, a HUD that ignores the camera, or a precise picture of what runs when.

### React to a node joining or leaving the scene

A behavior hears about the tree through three hooks. `addBehavior` sets `this.node` and calls `onAttach` at once. `onSceneReady` runs once after that, as soon as the node is in a scene, so it is the place to read `this.node.engine`. `onDetach` runs when the behavior is removed or the node is destroyed.

```ts
import { Behavior, Node2D } from '@julianagaibler/stargazer'

class Announce extends Behavior {
  override onSceneReady(): void {
    console.log('in scene, engine:', this.node.engine !== null)
  }
  override onDetach(): void {
    console.log('detached from', this.node.id)
  }
}

const marker = new Node2D('marker')
marker.addBehavior(new Announce())
marker.events.on('destroy', () => console.log('destroyed'))
scene.root.add(marker)
```

The first message prints when `marker` joins the root. The other two print when `marker` is destroyed: `onDetach` first, then the `destroy` event. A node outside a scene has no engine yet, and `onSceneReady` waits until it has one.

A behavior targets {@link Node2D} by default. A behavior for 3D nodes extends `Behavior<Node3D>`, and one for either kind extends `Behavior<Node>`. A node can also override `onUpdate` and `onFixedStep` itself, instead of attaching a behavior.

### Update order

Each frame, the engine calls `onUpdate(dt)` on every node that has update work of its own or on a behavior. `dt` is the frame time in seconds. The order is tree order. A node's own `onUpdate` runs before its behaviors', and its behaviors run in the order they were attached.

```ts
class Drifter extends Node2D {
  override onUpdate(dt: number): void {
    this.transform.x += 60 * dt
  }
  override onFixedStep(fixedDt: number): void {
    this.transform.y += 30 * fixedDt
  }
}
```

`onUpdate` moves the node at the same speed on any display. `onFixedStep(fixedDt)` follows the same rules at a fixed rate, 120 Hz by default, and `fixedStepHz` in the engine host options sets the rate. Use it for work that must give the same results at any frame rate, such as physics integration. Pausing the engine with `engine.setPaused(true)` stops both passes.

A node added during the pass first updates on the next frame. A node destroyed during the pass is skipped, and the nodes after it still update. Nodes with no update work cost nothing.

### Nodes of other kinds in the tree

The tree mixes three kinds of node: {@link Node2D}, {@link Node3D} and {@link GroupNode}. Each 2D node takes its world transform from the nearest `Node2D` ancestor, skipping nodes of other kinds. A `Node2D` under a `GroupNode` or a `Node3D` with no `Node2D` ancestor is placed as if it sat at the root.

```ts
import { GroupNode } from '@julianagaibler/stargazer'

const level = new GroupNode('level')
level.add(hud, world) // hud holds 2D nodes, world holds 3D nodes
scene.root.add(level)
level.visible = false // hides both
```

A `GroupNode` is a plain container for lifecycle and visibility, and its children keep their own transforms. Hiding or destroying `level` affects the 2D and the 3D content together.

### World transforms

`transform.local` and `transform.world` are {@link Affine2D} matrices with six numbers, `a` to `f`. Both are read-only. Every field setter marks the node dirty. Once per frame, the stage rebuilds `local` for dirty nodes and sets `world` to the parent's world times `local`.

The composition order is origin, scale, skew, rotate, then translate. `skew` shears along the direction `skewAxis` gives, in radians, and the default axis 0 is a horizontal shear.

```ts
parent.transform.x += 100
// The stage updates `child.transform.world` once per frame. Ask for it now.
child.ensureWorldTransform()
const { e, f } = child.transform.world
const local = child.worldToLocal(e + 10, f)
```

Code that changes an ancestor and needs a descendant's new position in the same frame calls `node.ensureWorldTransform()`. `node.worldToLocal(x, y)` and `node.localToWorld(x, y)` call it for you.

### PointerBehavior

{@link PointerBehavior} is a base class for a behavior that handles pointer input. Return the handlers from `handlers()`. The base class binds them with `bindPointer` on attach and unbinds them on detach.

```ts
import {
  PointerBehavior,
  type PointerHandlers,
} from '@julianagaibler/stargazer'

class DragToMove extends PointerBehavior {
  protected handlers(): PointerHandlers {
    return {
      singlePointer: true, // ignore extra fingers while one drags
      move: (e) => {
        const parent = this.node.spatialParent
        const p = parent ? e.localTo(parent) : e.pointer.world
        this.node.transform.x = p.x
        this.node.transform.y = p.y
      },
    }
  }
}
node.addBehavior(new DragToMove())
```

The node follows the finger. The position is taken in the space of the node's nearest `Node2D` ancestor, because that is the space `transform.x` and `transform.y` are in. A node with no `Node2D` ancestor uses the world position. Override the optional `onPointerDetach()` for cleanup that runs after the handlers are unbound. See [Input](/guides/input) for `bindPointer` and the ready-made button and drag behaviors.

### Async work scoped to a node

The async helpers on a node are tied to `node.abortSignal`, so destroying the node cancels them. `wait(seconds)` resolves after a delay in engine time, and `loop(body)` runs an async body again and again while the node lives:

```ts
node.loop(async () => {
  await node.tween({ scaleX: 1.2, scaleY: 1.2 }, { duration: 0.4 })
  await node.tween({ scaleX: 1, scaleY: 1 }, { duration: 0.4 })
  await node.wait(1)
})
```

The node pulses once every 1.8 seconds until it is destroyed. The other helpers are `play`, `tweenTo`, `playTo`, `scope` and `autoDestroy`, described on {@link Node}.

Call `tween` and `wait` on a node that is in a scene. On a detached node the promise rejects. Pass `node.abortSignal` to your own async work so that a destroyed node leaves no promise pending. `engine.animate(node, to, opts)` is the engine-level form of `node.tween`. More on aborting in [Animation](/guides/animation).

When `node.destroy()` runs, the children are destroyed first, then the node's behaviors detach, its signal aborts, and `'destroy'` is emitted on `node.events`. Its last step is leaving its parent.

### Hit testing

On a pointer press, the input system checks the 2D nodes from the topmost drawn down. Nodes that are hidden or have `hitEnabled` false are skipped. The first node whose `hitTest(worldX, worldY, touchSlopWorld)` returns true captures the pointer.

A container with no picture of its own takes taps over a region when it sets `boundsOverride`:

```ts
const button = new Node2D('button')
button.boundsOverride = { x: -100, y: -30, width: 200, height: 60 }
button.bindPointer({ down: () => console.log('tapped') })
scene.root.add(button)
```

A press inside that 200 by 60 rectangle around the node's origin runs the handler. `bindPointer` turns `hitEnabled` on when you pass a `down` handler.

The built-in nodes test these shapes:

- {@link ShapeNode} tests a circle or an ellipse exactly and the geometry's box for a rect, in local space.
- {@link Path2DNode} uses `hitMode`, which is `'none'` by default. `'fill'` and `'stroke'` test the path exactly, and `'circle'` tests a circle of radius `hitRadiusWorld` around the local origin.
- A plain {@link Node2D} tests `node.bounds`, the bounds of its picture, and reports a miss when it has no picture.

`boundsOverride` replaces the picture's bounds. To test another shape, override `hitTest` in a subclass. It receives a point in world space and returns a boolean. {@link hitTestCircle} is a helper for a circle around the node's origin. See [Input](/guides/input) for the rest of the pipeline.

### When a node repaints

A node runs `paint` again in these cases:

- A paint property declared with `definePaintProps` gets a different value. Hold primitives, or replace objects instead of changing them in place.
- A resource it declared with `canvas.use(resource)` changes its `version`. A {@link VersionedRef} is such a resource, and `ref.touch()` bumps it. A path drawn with `fillPath` or `strokePath` is tracked automatically.
- The node calls `markNeedsPaint()`, for state it owns and changes by hand.
- It called `canvas.snap(length)` and the scale it is drawn at settles at a new value. `snap` rounds a length to whole device pixels.
- It called `canvas.visibleWorldRect()` and the camera's view changes.
- It called `canvas.screenScale()` and the world size of a CSS pixel changes.

Moving, scaling, rotating and fading a node replays its picture. Content that moves on a clock belongs in a child node whose transform `onUpdate` changes, and each child keeps its own picture:

```ts
class Hand extends Node2D {
  override paint(canvas: Canvas): void {
    canvas.strokeLine(0, 0, 0, -60, { color: '#ffd34d', width: { screen: 3 } })
  }
  override onUpdate(dt: number): void {
    this.transform.rotation += dt
  }
}

const dial = new Node2D('dial')
dial.add(new Hand())
```

The hand turns once every 2π seconds and `paint` runs once. A rotation computed from the clock inside the parent's `paint` would leave a stale picture.

`paint` reads only the state in that list. Reading the clock, the camera, the node's transform or other changing state inside `paint` leaves a picture that is out of date. A `paint` that marks any node for repaint throws in development. In development, the engine also paints a few unchanged nodes again each frame and warns once per node when the result differs from the kept picture. That is how an undeclared dependency shows up.

A size in CSS pixels is `size * canvas.screenScale()`. A stroke width can be `{ screen: 2 }`, which is 2 CSS pixels at any zoom and needs no repaint. Inside `paint`, `canvas.setAlpha` is relative to the node's alpha. Set `pixelSnap = true` to round the node's origin to a whole device pixel when it draws. It repaints nothing.

To test what a node draws, `paintCalls` runs its `paint` and returns the recorded calls in the vocabulary of `Canvas`:

```ts
import { paintCalls } from '@julianagaibler/stargazer'

const calls = paintCalls(new Hand(), { deviceScale: 2 })
console.log(calls.map((c) => c.name)) // ['strokeLine']
```

### Groups, blend modes and mattes

Three node properties draw a node and its subtree into an offscreen surface and then composite that surface as one image:

- `compositeGroup = true` composites the subtree once with the node's alpha, so a translucent group looks like one flat image.
- `compositeBlend` sets how the node blends with what is under it. Any value other than `'source-over'` makes the node a group. {@link GfxBlend} lists the modes.
- `matte` names another node whose drawing masks this one, a track matte. `matteMode` is `'alpha'` (the default), `'inverted-alpha'`, `'luma'` or `'inverted-luma'`.

```ts
const card = new Node2D()
card.compositeGroup = true
card.transform.alpha = 0.5 // the card fades as one image

const mask = new ShapeNode({
  geometry: { kind: 'circle', radius: 80 },
  fill: '#fff',
})
parent.add(photo, mask)
photo.matte = mask // photo shows only inside the circle
```

The card fades as one flat image, and the photo shows only inside the circle. The matte node is drawn only as a mask. It can sit anywhere in the tree, usually next to the node it masks so that both share a parent's transform. A node can be the matte of one node. A hidden matte node is an empty matte, which hides the node, or shows all of it for an inverted mode.

A group costs a surface each frame and a render pass of its own, so turn it on only where it changes the result. A group that contains an `InsetViewNode` draws each part separately and skips the matte. Toggling these properties repaints nothing, because none of them changes a picture.

### Viewport culling

The compose walk skips a painted node when its bounds lie fully outside the visible world rect. The bounds are the picture's bounds combined with `boundsOverride`, grown a little for strokes and shadows. A node whose picture has unknown bounds, such as one that draws a `Path2D`, is culled when it sets `boundsOverride`. A culled node still checks its dependencies, so it is up to date when it comes back into view.

```ts
import { Path2DNode } from '@julianagaibler/stargazer'

const coastline = new Path2DNode({
  path,
  stroke: '#ffd34d',
  bounds: { x: 0, y: 0, width: 800, height: 600 },
})
```

The node is skipped while the camera shows none of the 800 by 600 rectangle. A {@link Path2DNode} gets bounds from its `bounds` option, which also grows for its border and shadow.

### Stroke widths and camera zoom

The stroked nodes ({@link ShapeNode}, {@link Path2DNode}, {@link PolylineNode}) read `lineWidth` as CSS pixels by default (`strokeSpace: 'screen'`), so a stroke keeps its thickness on screen when the camera zooms. To make a stroke scale with the world, set `strokeSpace: 'world'`:

```ts
const track = new Path2DNode({
  path,
  stroke: '#ffd34d',
  lineWidth: 8,
  strokeSpace: 'world', // scales with camera zoom
})
```

The track is 8 world units wide at any zoom. The `shadow` option of {@link ShapeNode} and {@link Path2DNode} follows the same setting. Its `offsetX`, `offsetY`, `blur` and `spread` stay the same on screen by default. A custom node writes a stroke width as `{ screen: px }` in its stroke style for the same effect. See [Drawing](/guides/drawing) and [Camera](/guides/camera).

### Clip a subtree

`node.clip` limits a node and all its descendants to a region in the node's own space. The region is a rect `{ x, y, width, height }` or a {@link GfxPath}.

```ts
const panel = new Node2D()
panel.clip = { x: 0, y: 0, width: 320, height: 200 }
panel.add(list) // rows that scroll past the edge are cut off
```

The clip follows the node's transform, so a rotated or scaled panel clips correctly. Clips on nested nodes narrow each other, up to 7 deep. Set it to `null` to remove it. A rect on an axis-aligned node clips in the shader at no extra draw cost. A path, a rotated node, an inner clip or a clip inside an inset view uses the stencil buffer, which adds a few draws per clipped subtree. Setting a clip repaints no node.

### Inset views

An `InsetViewNode` shows a separate 2D world inside a rounded rect, with a view of its own, like picture-in-picture. Build the inner world under `inset.content` in its own units. Set `inset.viewport` to the rect of that world to show. The rect is fitted into the inset at a uniform scale and centered. Setting it every frame pans and zooms like a camera.

```ts
import { InsetViewNode } from '@julianagaibler/stargazer'

const inset = new InsetViewNode({ width: 392, height: 516, radius: 40 })
inset.content.add(ship)
engine.ticker.onFrame(() => {
  inset.viewport = {
    x: ship.transform.x - 39,
    y: ship.transform.y - 52,
    width: 78,
    height: 104,
  }
})
card.add(inset)
```

The inset follows the ship. Everything under `content` is clipped to the rounded rect. It draws with a view that includes the inset's zoom, so a screen-space stroke keeps its width on screen and `visibleWorldRect` reports the inner world's rect. The inset moves and scales with its parents like any node.

An inset has these limits. A node inside that calls `setClip` itself replaces the inset's clip for its own draw. An inset inside another inset is clipped to the inner one only. Pointer input and HTML overlays see inner nodes in the parent's coordinates, not through the inset's view.

### Layers

A {@link Layer} gives its subtree a placement of its own. The stage camera moves and scales everything in the tree, which suits a world but moves a heads-up display away. Put such nodes under a layer whose `space` is not `'world'`, and the camera leaves them in place.

```ts
import { Layer, TextNode } from '@julianagaibler/stargazer'

// One unit is one CSS pixel, origin at the top left of the canvas.
const hud = new Layer({ space: 'screen' })
hud.add(new TextNode({ text: 'Score 0', x: 16, y: 16, baseline: 'top' }))
scene.root.add(hud)

// Laid out for a 1920 by 1080 design, fitted into any canvas shape.
const ui = new Layer({
  space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
})
scene.root.add(ui)
```

The score stays at the top left while the camera pans and zooms. The {@link LayerSpace} values are:

- `'world'`, the default, uses the view in effect where the layer sits.
- `'screen'` maps one unit to one CSS pixel, with the origin at the top left of the canvas.
- `{ frame }` fits the rect into the canvas at a uniform scale and centers it, the way a camera fits its viewport. The design keeps its proportions at any canvas shape.

`frame` can also be a function of the canvas size in CSS pixels. The layer calls it every time it reads the canvas size, so it can switch designs when the canvas changes shape, such as when a phone turns:

```ts
const responsive = new Layer({
  space: {
    frame: (w, h) =>
      w >= h
        ? { x: 0, y: 0, width: 1920, height: 1080 }
        : { x: 0, y: 0, width: 1080, height: 1920 },
  },
})
```

Return the same rect for the same size. [`layer.frame`](/module/scene/layer#frame) is the rect in effect. For a function, that is the rect it returned last, and `null` until the layer is first drawn or resolved with {@link viewFor}.

A layer with a space of its own is the root of that space. Its own `transform` places the subtree inside the view, so a screen layer can be offset, scaled or rotated in CSS pixels. Every `transform.world` under it is in layer space, so `localToWorld`, hit testing and layout work as usual. `alpha` and `visible` still cascade from above.

The nearest ancestor layer whose space is not `'world'` decides where a node is placed. Pictures under a screen or frame layer keep their recording when the camera zooms, because their view stays the same. Pointer input follows the placement, see [Input](/guides/input).

Code that needs the view placing a node, such as a screen position or a pointer conversion, calls {@link viewFor} with the node and the stage. {@link layerOf} returns the layer that places a node, or `null` under the camera.

A layer can also run post-processing effects over its subtree only, and keep its rendered result between frames with `cache: 'raster'`. See [Post-processing](/guides/post-processing).

### Scene lifecycle

`host.loadScene(builder)` destroys the current children of the root and then calls `builder(scene, engine)`. The builder may be async, and `loadScene` returns a promise that resolves when it finishes. Await it.

A node with `persistent = true` survives a scene load and `destroyChildren()`, together with its subtree. A {@link Layer} takes `persistent` as an option.

```ts
const chrome = new Layer({ space: 'screen', persistent: true })
chrome.add(new TextNode({ text: 'Menu', x: 16, y: 16, baseline: 'top' }))
scene.root.add(chrome)

await host.loadScene(() => {})
// `chrome` is still in the tree, drawing and taking input.
```

A persistent node keeps drawing and taking input across scene loads, so use it for content that is independent of the scene. Destroying it directly still works.

`host.destroy()` destroys the engine and the tree. Every node's `abortSignal` fires, every pending tween rejects, and every behavior detaches.

## Next step

Make the scene respond to the player with [Input](/guides/input), or move things over time with [Animation](/guides/animation).

## See also

- {@link Node2D}: the 2D node, its transform, hooks and pointer handlers
- {@link Behavior}: logic attached to a node
- {@link SceneTree}: the tree a stage owns
- {@link Transform2D}: position, scale, rotation, skew and alpha
- {@link Layer}: a subtree with a placement of its own
- {@link definePaintProps}: fields that make a node repaint
- [Drawing](/guides/drawing): the `Canvas` calls inside `paint`
- [Camera](/guides/camera): the view that places the tree
- [Input](/guides/input): pointer handlers and hit testing
- [Animation](/guides/animation): tweens, waits and aborts
- [Stages](/guides/stages): more than one canvas
