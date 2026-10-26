---
title: Input
group: Features
order: 6
---

# Input

Mouse, touch and pen input arrive as pointers, with any number of fingers at once. When a pointer goes down on a node, that node captures it and receives every move, release and cancel of that pointer, even after the pointer leaves the node's shape. After this page you can make nodes respond to pointers, build buttons and drag and drop, and listen to the whole stage.

Each interactive {@link Stage} has an {@link InputSystem} that listens on its canvas element. The primary stage always has one, reached as `engine.input`. Pointer positions arrive in world units, so they match the coordinates you place nodes in. See [Scene graph](/guides/scene) for nodes and the tree.

## Basic usage

Give a node pointer handlers with [`bindPointer`](/module/scene/node#bindpointer).

```ts
import { ShapeNode } from 'stargazer'

const ball = new ShapeNode({
  geometry: { kind: 'circle', radius: 60 },
  fill: '#ffd34d',
})
scene.root.add(ball)

const unbind = ball.bindPointer({
  down: (e) => console.log('grabbed', e.pointer.id),
  move: (e) => {
    ball.transform.x = e.pointer.world.x
    ball.transform.y = e.pointer.world.y
  },
  up: () => console.log('released'),
})
```

Pressing the circle grabs it, and the circle follows the pointer until release. The ball sits directly under the root, so its position is in world units and `e.pointer.world` can be written to it as is. `unbind()` removes exactly these handlers.

### Handling pointers on a node

`bindPointer` takes `down`, `move`, `up` and `cancel` handlers. A `cancel` arrives when the browser cancels the gesture or drops the capture. A node takes part in hit testing while `hitEnabled` is true. `bindPointer` sets it when the handlers include `down`, and `unbind()` clears it again if `bindPointer` set it. Pass `hitEnabled: false` to bind handlers and leave hit testing off.

A {@link Path2DNode} with a `hitMode` other than `'none'` turns `hitEnabled` on itself. Every other node starts with it off.

```ts
ball.hitEnabled = true
ball.onPointerDown = (e) => console.log('grabbed', e.pointer.id)
```

The input system calls the `onPointerDown`, `onPointerMove`, `onPointerUp` and `onPointerCancel` properties of a node. When you assign them directly, you set `hitEnabled` and clear the handlers yourself.

### Pointer events

Every handler receives a {@link PointerEvent2D}.

```ts
ball.bindPointer({
  move: (e) => {
    const { id, kind, screen, world } = e.pointer
    console.log(id, kind, screen, world, e.delta)
  },
})
```

`screen` is in CSS pixels from the canvas element's top left corner, `world` is in world units, and `delta` is the world movement since the previous event for this pointer. `id` stays the same for the whole gesture, and `kind` is `'touch'`, `'mouse'` or `'pen'`. The other fields are `phase`, `source`, `stage`, `localTo(node)` and the {@link PointerStateSnapshot} fields `startedAtMs` and `capturedBy`. `source` is `'native'` for a browser event and `'synthetic'` for one the engine made, see [Continuous world reprojection](#continuous-world-reprojection).

### Local coordinates

`e.pointer.world` is in world space. A node under a moved, scaled or rotated parent needs the position in its parent's space. [`localTo`](/module/input/pointerevent2d#localto) converts it.

```ts
piece.bindPointer({
  move: (e) => {
    const p = e.localTo(board) // board is the piece's parent
    piece.transform.x = p.x
    piece.transform.y = p.y
  },
})
```

The piece follows the pointer at any parent transform. `localTo` takes an optional `out` object to fill, and it handles nodes under a {@link Layer}, see [Pointers and layers](#pointers-and-layers).

### Buttons

A {@link ButtonBehavior} turns a node into a tap button. The button is pressed on `down`, and `onClick` fires on `up` when the release is still over the node. To cancel a press, drag off the button before releasing.

```ts
import { ButtonBehavior } from 'stargazer'

node.addBehavior(
  new ButtonBehavior({
    onClick: () => openMenu(),
    enabled: () => canInteract(),
    onPressedChange: (pressed) => (node.pressed = pressed),
  }),
)
```

The node draws itself. `onPressedChange` reports the pressed state, so make `pressed` a paint property of the node and it repaints when the state flips. `enabled` is a boolean or a function, and the button reacts to presses while it is true.

### Drag and drop

A {@link DraggableBehavior} carries a node onto a drop target, such as a card into a slot.

```ts
import { DraggableBehavior } from 'stargazer'

node.addBehavior(
  new DraggableBehavior<Cell>({
    dragLayer,
    findDropTarget: (w) => cellAt(w.x, w.y),
    onDrop: (cell) => place(node, cell),
  }),
)
```

Pressing and moving the node past the drag threshold starts a drag. The node moves into `dragLayer` so that it draws above its neighbors, and follows the pointer with the grabbed point under the finger. On release over a target, `onDrop` receives the target. On release over nothing, the node slides back to where it started.

### Listening to the whole stage

Every pointer event is also emitted on the stage's event bus, whether or not a node captured it. For the primary stage, listen on `engine.events`.

```ts
const off = engine.events.on('pointerDown', (e) => {
  spawnRipple(e.pointer.world)
})
```

The handler runs for every press on the primary canvas element. Call `off()` to stop listening. The other events are `pointerMove`, `pointerUp` and `pointerCancel`, listed in {@link EngineEvents}.

## Advanced usage

Reach for these parts to control capture, track several fingers, bind a region of the stage, build hold buttons, tune drag and drop, listen on more than one stage, or work under layers.

### How a press finds its node

Two overlapping nodes with handlers show the order. The press goes to the node drawn on top.

```ts
back.bindPointer({ down: () => console.log('back') })
front.bindPointer({ down: () => console.log('front') })
```

Pressing where they overlap logs `front`. On `pointerdown`, the input system takes these steps in order:

1. Converts the event's position to CSS pixels on the canvas element.
2. Calls `canvas.setPointerCapture(pointerId)`, so the browser keeps sending this pointer's events to the canvas element when it slides past the edge.
3. Checks the 2D nodes from the topmost drawn down, skipping hidden nodes and nodes with `hitEnabled` false. For each node it converts the position into the world of the view that places that node and calls `node.hitTest(x, y, touchSlop)`. The first node that returns true captures the pointer.
4. When no 2D node is hit, casts a ray into the 3D scene and picks the nearest {@link Node3D} with `hitEnabled` set. See [3D](/guides/3d).
5. Calls the captured node's `onPointerDown`, then emits `pointerDown` on `stage.events`.

Later moves, releases and cancels of that pointer go to the captured node, wherever the pointer is. They are also emitted on `stage.events`. [Scene graph](/guides/scene) describes hit testing.

### Single pointer and multi-touch

Capture is per pointer. Two fingers on two shapes give each shape its own capture, and each shape receives the events of its own pointer. Each pointer's `capturedBy` is its own shape.

One node can also receive several pointers at once. Pass `singlePointer: true` to `bindPointer` to follow the first.

```ts
node.bindPointer({
  singlePointer: true,
  down: (e) => startDrag(e),
  move: (e) => drag(e.localTo(board)),
  up: () => endDrag(),
})
```

While the first pointer is down, the handlers follow it and ignore every other pointer. The slot frees when the first pointer is released or canceled. {@link ButtonBehavior}, {@link HoldButtonBehavior} and {@link DraggableBehavior} follow a single pointer by default, and their `singlePointer` option switches that off.

### Region gestures

{@link bindRegionGesture} reacts to presses on an area of the primary stage instead of on a node. Use it for a board you tap to drop a piece, or a strip you swipe from.

```ts
import { bindRegionGesture } from 'stargazer'

const off = bindRegionGesture(engine, {
  hitTest: (w) => insideBoard(w.x, w.y),
  enabled: () => state === 'playing',
  down: (e) => beginPreview(e),
  move: (e) => movePreview(e),
  up: (e) => commitDrop(e),
  onReject: () => openMenu(), // a press outside the board
})
// off() removes the binding
```

A press is accepted when `hitTest` and `enabled` both pass, and `onReject` receives it otherwise. The binding then follows that pointer through `move`, `up` and `cancel`. A finger that landed outside `hitTest` produces no `move` or `up`.

`hitTest` receives the camera's world position. The binding follows one pointer by default, and `singlePointer: false` makes a multi-touch region that follows every pointer it accepts. The binding listens on `engine.events`, so it hears presses whether or not a node captured them.

### Hold and auto-repeat

{@link ButtonBehavior} fires on release, which suits a menu item. A game control acts the moment the finger lands. {@link HoldButtonBehavior} fires `onPress` on the press and can repeat while held.

```ts
import { HoldButtonBehavior } from 'stargazer'

node.addBehavior(
  new HoldButtonBehavior({
    onPress: () => shift(-1),
    repeat: { delay: 0.17, interval: 0.05 },
    enabled: () => state === 'playing' && !paused,
    onPressedChange: (pressed) => (node.pressed = pressed),
  }),
)
```

The first `onPress` fires on the press. After `delay` seconds it fires again every `interval` seconds until release. Omit `repeat` for a single press per touch. For a continuous effect, such as a thruster, omit `repeat` and read `behavior.pressed` in your own `onFixedStep`, so the effect grows with time and not with the number of callbacks.

The repeat runs on the fixed step, so its rate is the same at any display refresh rate. The behavior checks `enabled` on the press and on every fixed step, and a false result releases the hold. The repeat continues when the finger drifts off the node, because the node keeps the capture.

The fixed step holds while the engine is paused, and pointer handlers keep running. Make `enabled` return false while paused, as in the example, so a finger resting across a pause releases the hold, and nothing fires when the engine resumes.

### Drag and drop in detail

A drag reports its progress through hooks. {@link DraggableOptions} lists them all.

```ts
node.addBehavior(
  new DraggableBehavior<Cell>({
    dragLayer,
    findDropTarget: (w) => cellAt(w.x, w.y),
    onDragStart: () => lift(node),
    onDragMove: (cell) => highlight(cell), // null over no target
    onDrop: (cell) => place(node, cell),
    onDragCancel: () => clearHighlight(),
    onTap: () => select(node),
    onSettled: () => rest(node),
  }),
)
```

`onDragStart` fires when the press travels past `threshold`, and `onDragMove` fires when the target under the pointer changes. A release over a target calls `onDrop`. A release over no target, or a system cancel, calls `onDragCancel` before the slide back. `onTap` fires for a release before the drag started, and `onSettled` fires when the node is back home and at rest, after a drop or after the slide back.

A drop target is whatever `findDropTarget` returns: a node, a grid cell, an id. `onDragMove` compares targets with `equals`, which defaults to `===`. A `findDropTarget` that returns a new object on each call passes `equals` or returns the same objects.

The node stays in `dragLayer` while it slides back, and returns to its home parent when it arrives, as the last child. A layout pass that skips nodes in the drag layer leaves the animation alone. `snapBack: false` returns the node at once, and `snapDuration` sets the slide in seconds.

With no `dragLayer`, the node is dragged in its own parent. A press during the slide back grabs the node again. `isDragging` is true during a drag and its slide back.

### Per-stage event bus vs `engine.events`

Pointer events are emitted on `stage.events` of the stage they happen on. The engine forwards the primary stage's pointer events to `engine.events`. A tap on a second canvas element is emitted on that stage's own bus.

A secondary stage gets an input system when it is created with `interactive: true`. Listen to it on its own bus.

```ts
const stage = engine.attachStage(secondCanvas, { interactive: true })
const off = stage.events.on('pointerDown', (e) => {
  // runs for presses on secondCanvas
})
```

A stage created with `interactive` left at its default has `stage.input` set to `null`, so its canvas element sends no pointer events to the engine. Every event also has `e.stage`, for code that handles several stages in one place. See [Stages](/guides/stages).

### Active pointers

`stage.input.pointers`, or `engine.input.pointers` for the primary stage, is a map from pointer id to {@link PointerStateSnapshot}. It holds every pointer that is down.

```ts
for (const p of engine.input.pointers.values()) {
  if (p.capturedBy === ball) drawMarker(p.world)
}
```

`world` in the map is the camera's world position.

### Continuous world reprojection

At the start of each frame, the input system computes each active pointer's world position again from its screen position and the active camera. The world under a still finger moves when the camera moves, for example during `animateTo` or a pan of the debug camera.

When the world position changes and no native `pointermove` came that frame, the input system emits a move with `e.source === 'synthetic'`. A drag handler that places its node at the pointer keeps the node under the finger while the camera moves.

The captured node and the stage are told separately, because each sees its own space and only one of them may have moved. A pointer held on a node under a screen {@link Layer} gets a synthetic move on the stage's listeners while the camera pans, and the node receives none.

### Pointers and layers

A node under a {@link Layer} with a space of its own is placed by the layer's view, not the camera's. Input follows the placement. The node is hit-tested where the layer draws it, and its events carry positions in the layer's space. So `pointer.world` has two meanings.

On a stage-level event (`stage.events`, `engine.events`) and in `input.pointers`, it is the camera's world. On an event a node receives for a pointer it holds, it is the world of the view that places that node. For a node under the camera, the two are the same.

`e.localTo(node)` resolves through that node's own view, so it is correct with either kind of event.

```ts
engine.events.on('pointerMove', (e) => {
  const p = e.localTo(hudPanel) // correct under a screen layer, at any zoom
})
```

To convert a stage event's `pointer.world` for a node under a layer, call `e.localTo(node)`. A `pointer.world` passed to `worldToLocal` of such a node gives a position in the wrong space, and development builds log a warning that points to `localTo`.

### Touch slop

Touch slop grows every hit target by a margin, so a fingertip hits small nodes. [`touchSlopScreen`](/module/input/inputsystem#touchslopscreen) is that margin in CSS pixels. `setTouchSlopScreen` changes it.

```ts
engine.input.setTouchSlopScreen(20)
```

The hit test converts the slop into each node's world units as it goes, so the margin keeps its size on screen at any zoom. `touchSlopWorld` gives it in the active camera's world units. [`touchSlopFor(node)`](/module/input/inputsystem#touchslopfor) gives it for the view that places a node, which is the one to use under a layer. A node can grow its own target further in `hitTest`, for example a {@link Path2DNode} with `hitMode: 'circle'` and a large `hitRadiusWorld`.

### Destroyed nodes and lost capture

Destroying a node that holds a pointer emits a `pointerCancel` with `e.source === 'synthetic'` on the stage's bus and releases the capture. The handlers of the destroyed node stop at the destroy. A behavior that tracks a press, such as a {@link PointerBehavior} subclass, is detached in the same destroy, and cleans up in `onDetach` or `onPointerDetach`.

If the browser fires `lostpointercapture` for a pointer the system still holds, the input system treats it as a native cancel. The captured node's `onPointerCancel` runs with `e.source === 'native'`, the capture is released, and the pointer leaves `pointers`. `input.releaseCapture(pointerId)` releases a node's capture from code and sends no cancel.

### Browser gestures

A stage created with `lockInteraction`, which is the default, sets `touch-action: none`, `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none` and `outline: none` on its canvas element. An interactive stage with `lockInteraction` also blocks the `contextmenu` event, so a long press opens no menu. The canvas element then has no pinch-zoom, text selection, touch callout or context menu. Pass `lockInteraction: false` in {@link StageOptions} for a canvas element inside a page the visitor scrolls. Elements outside the canvas element keep the browser's behavior and need their own handling.

## Next step

Move things over time with tweens, waits and cancellation in [Animation](/guides/animation).

## See also

- {@link InputSystem}: per-stage pointer tracking and touch slop
- {@link PointerEvent2D}: the event every handler receives
- {@link PointerHandlers}: the options of `bindPointer`
- {@link PointerBehavior}: a base class for input behaviors
- {@link ButtonBehavior}: a tap button
- {@link HoldButtonBehavior}: a button that fires on press and repeats
- {@link DraggableBehavior}: drag and drop
- {@link bindRegionGesture}: a gesture on an area of the stage
- {@link EngineEvents}: the engine's event map
- [Scene graph](/guides/scene): hit testing and layers
- [Camera](/guides/camera): the view that turns screen positions into world positions
- [Stages](/guides/stages): input on more than one canvas
