---
title: Architecture
group: Getting started
order: 3
---

# Architecture

Stargazer keeps your content in a tree of nodes. On every browser animation frame, the engine runs your update code, places the nodes and draws them. This page explains when your code runs, which coordinate space each value is in, and what order things draw in. Read it when a value is stale, a node draws under the wrong sibling, or you need to know which hook to use. The advanced part follows a stage as it turns the tree into GPU work, which helps when you read the debug HUD or profile a scene.

The main types are {@link Engine}, which runs the loop, {@link Stage}, which is one canvas element with its own tree, and {@link SceneTree}, which holds the nodes. [Engine setup](/guides/setup) shows how to create them.

## Basic usage

You build a tree of nodes and change it over time. The engine does the rest on each frame.

### The node tree

A {@link SceneTree} has one root, a {@link GroupNode}, and holds 2D and 3D nodes together. Every 2D node is a {@link Node2D}, for example a {@link ShapeNode}, a {@link Path2DNode} or a {@link TextNode}. Every 3D node is a {@link Node3D}. Both share the {@link Node} base, which owns the children, the behaviors and the node's lifecycle.

A node's `transform` is relative to its parent. This card has a yellow dot as a child:

```ts
import { ShapeNode } from 'stargazer'

const card = new ShapeNode({
  geometry: { kind: 'rect', width: 240, height: 140, radii: 16 },
  fill: '#12233f',
})
card.transform.x = 960
card.transform.y = 540

const dot = new ShapeNode({
  geometry: { kind: 'circle', radius: 12 },
  fill: '#ffd34d',
})
dot.transform.x = 100

card.add(dot)
scene.root.add(card)
```

The card is centered in the 1920 by 1080 world, and the dot sits 100 units to the right of the card's center, at world x 1060. Moving the card moves the dot with it.

The engine computes each node's world transform as the parent's world transform times the node's own. A 2D node uses the nearest 2D ancestor, and a 3D node the nearest 3D ancestor. A `GroupNode` has no transform, so a group between two 2D nodes leaves their transforms as they are. See [3D](/guides/3d) for mixed trees.

A {@link Behavior} adds logic to a node through `onAttach`, `onDetach`, `onUpdate(dt)` and `onFixedStep(fixedDt)`. A node can have several behaviors, and `node.getBehavior(Ctor)` finds one by class.

Every node has an `AbortSignal`. `node.destroy()` destroys the children first, then detaches the node's behaviors and aborts the signal. The node's pending `tween`, `wait` and `animate` promises then reject with `AbortError`. See [Scene graph](/guides/scene) and [Animation](/guides/animation).

### The frame loop

The {@link Ticker} runs the loop on `requestAnimationFrame`. Each frame it computes `dt`, the time since the last frame in seconds. It limits `dt` to `maxDt`, so the frame after a stall advances the simulation by a capped amount. By default it also smooths `dt` to remove timer jitter, and `smoothTimestep: false` turns that off. {@link TickerOptions} lists the defaults.

The ticker also runs a fixed step, by default 120 times a second. Use it through `onFixedStep` for work that has to stay independent of the frame rate, such as physics. The ticker adds each frame's `dt` to a running total and runs as many fixed steps as fit in it, at most 8 per frame. After a long stall it drops the time left over. [`ticker.fixedAlpha`](/module/engine/ticker#fixedalpha) is the fraction of a step left over, for smoothing positions between fixed steps in `onUpdate`.

This behavior moves a node at a steady speed in fixed steps and draws the position between the last two steps:

```ts
import { Behavior } from 'stargazer'
import type { Engine } from 'stargazer'

class Drift extends Behavior {
  readonly #engine: Engine
  #previous = 0
  #current = 0

  constructor(engine: Engine) {
    super()
    this.#engine = engine
  }

  override onFixedStep(fixedDt: number): void {
    this.#previous = this.#current
    this.#current += 300 * fixedDt
  }

  override onUpdate(): void {
    const alpha = this.#engine.ticker.fixedAlpha
    this.node.transform.x =
      this.#previous + (this.#current - this.#previous) * alpha
  }
}

node.addBehavior(new Drift(engine))
```

The node moves 300 units a second at any frame rate, and its motion stays smooth on displays that run faster than the fixed step.

### What a frame does

On each animation frame the engine first runs the fixed steps that are due. Each fixed step does this:

1. Step every registered physics world.
2. Call `onFixedStep` on each node that has fixed-step work, and then on its behaviors, in tree order, on every active stage.

Then the engine runs the frame itself:

1. Call the [`onBeforeFrame`](/module/engine/engine#onbeforeframe) handlers. Code that moves the camera belongs in this step.
2. Update pointer world positions on every interactive stage.
3. Advance tweens and waits.
4. Call `onUpdate` on each node that has update work, and then on its behaviors, in tree order, on every active stage.
5. Lay out every {@link LayoutRoot} that changed.
6. Compute world transforms on every active stage.
7. Render every active stage: the 3D pass, then the 2D nodes, then post-processing.
8. Emit `frame` on `engine.events`.

The order has reasons you can rely on. A camera that moves in step 1 is already in place when step 2 maps pointers to world positions, so pointer positions are current when your `onUpdate` reads them in step 4. Step 2 also emits a `pointerMove` for a pointer that stays still on screen while the camera moves under it. Tweens advance before `onUpdate`, so update code reads this frame's tweened values. Layout runs after `onUpdate`, so a size you change in `onUpdate` takes effect in the same frame.

This handler runs in step 1, so the camera is in place before pointers are mapped:

```ts
const off = engine.onBeforeFrame((dt) => {
  followCamera(dt) // ease the camera toward its target
})
off() // remove the handler
```

This behavior reads a pointer in step 4:

```ts
import { Behavior } from 'stargazer'
import type { Engine } from 'stargazer'

class FollowPointer extends Behavior {
  readonly #engine: Engine

  constructor(engine: Engine) {
    super()
    this.#engine = engine
  }

  override onUpdate(): void {
    for (const pointer of this.#engine.input.pointers.values()) {
      this.node.transform.x = pointer.world.x
      this.node.transform.y = pointer.world.y
    }
  }
}
```

The node follows a finger or mouse button held down on the canvas element, and keeps its place under the pointer while the camera pans.

While `engine.setPaused(true)` is in effect, the engine skips the fixed steps and frame steps 2 to 4. The rest still runs, so the debug camera moves and a resize still lays out the scene again.

[`engine.capture`](/module/engine/engine#capture) renders outside this loop. It lays out, transforms, and renders its own inactive stage directly, so it also works while the ticker is stopped. See [Stages](/guides/stages).

### Coordinate spaces

The engine uses three coordinate spaces:

- World coordinates are the units your scene uses. `node.transform.x` and `node.hitTest` use them.
- Screen coordinates are CSS pixels on the canvas element. Pointer events arrive in them.
- Device pixels are the canvas element's physical pixels. The renderer works in them.

A {@link CameraNode2D} fits its world `viewport` rectangle into the canvas element at one uniform scale. When the canvas element has a different aspect ratio than the viewport, extra world shows along one axis. The camera converts between world and screen coordinates:

```ts
const cam = engine.currentCamera2D!
const world = cam.screenToWorld(cssX, cssY)
const screen = cam.worldToScreen(node.transform.x, node.transform.y)
```

For a pointer at the middle of a 960 by 540 canvas element framed on the 1920 by 1080 viewport, `world` is `{ x: 960, y: 540 }`. Both methods take an optional `out` vector, which keeps a per-frame loop from allocating. The stage multiplies the camera transform by the device pixel ratio, so your code stays in world and CSS pixel units. See [Camera](/guides/camera).

### Draw order

2D nodes draw in tree order: a node before its children, and siblings in the order they were added. To draw a node under content that was added before it, insert it at its place with `addAt` or `insertBefore`.

```ts
scene.root.add(background, card)
scene.root.insertBefore(glow, card) // glow draws after the background and under the card
```

A node's alpha multiplies into its children's, and a hidden node hides its whole subtree. See [Scene graph](/guides/scene).

## Advanced usage

This part describes how a stage turns the tree into GPU work: pictures, the command list, passes, the 3D pass and the backends. It also covers stages and the Svelte boundary.

### Pictures and the 2D walk

A 2D node draws in one of two ways. A node with `paint(canvas)` records its drawing into a {@link Picture} through a {@link Canvas}. The stage keeps the picture and replays it every frame. A node with `draw(gfx, camera, dt)` draws into {@link Gfx2D} directly, every frame.

```ts
import { Node2D, definePaintProps } from 'stargazer'
import type { Canvas } from 'stargazer'

class Gauge extends Node2D {
  declare value: number

  constructor() {
    super()
    definePaintProps(this, { value: 0.4 })
  }

  override paint(canvas: Canvas): void {
    canvas.fillRoundRect(0, 0, 200, 24, 12, '#1c2438')
    canvas.fillRoundRect(0, 0, 200 * this.value, 24, 12, '#ffd34d')
  }
}
```

The gauge records its picture the first time the stage draws it. Moving, scaling and fading the gauge replays that picture. Writing `gauge.value` marks the gauge for repaint, and so does a call to [`markNeedsPaint`](/module/scene/node2d#markneedspaint). The stage then records the picture again before the next draw.

Each frame the stage walks the tree once in draw order. For each visible 2D node it repaints the picture if needed, skips the node when its bounds are known and outside the view, and replays the picture under the node's world transform and alpha. The walk also applies clips, `InsetViewNode` views, and {@link Layer} spaces and effects. See [Drawing](/guides/drawing) for the `Canvas` rules.

### The command list

The 2D renderer, `GpuGfx`, implements {@link Gfx2D}. During the walk it records, and it submits at the end of the frame. Recording works like this:

- Each draw call appends its vertex or instance data to a stream that belongs to its shader program.
- A change of program, texture, blend mode or clip ends the current run and starts a new one. A run is one future draw call.
- Alpha, color and transform go into the per-instance data, so a change in them keeps the run going.

At the end of the frame the renderer joins runs, uploads each stream once and replays the runs in draw order. A run joins an earlier run with the same program and state when no run between them touches the same pixels, so draw order holds wherever pixels overlap. Draws of the same kind on separate pixels therefore cost one draw call, which is why the frame cost depends on how often program, texture, blend mode and clip change.

### Passes and surfaces

Some nodes draw into an offscreen surface first, and the renderer then draws the surface into the frame. A {@link Layer} with effects or a raster cache does this. So does a node with `compositeGroup`, a `compositeBlend` other than `'source-over'`, or a `matte`.

In the command list, a surface's runs sit between a begin mark and an end mark. At submit time the renderer gives every surface a render pass of its own and runs those passes before the main pass. A nested surface comes before the surface that contains it. A layer's effects run when its pass closes. The main pass then draws the frame in one go, and it composites each surface where the node sat in draw order.

One stage frame runs in this order:

1. Check that the stage's pipelines are ready. The stage skips the frame until they are.
2. Bake masks for path shadows that the previous frame asked for.
3. Render the 3D shadow maps and ambient occlusion, if the stage has 3D content.
4. Record the 2D walk and the debug overlays.
5. Run every surface pass.
6. Run the main pass: clear, draw the 3D meshes, then the 2D runs.
7. Run post-processing, if any effect is active. It reads the frame and writes the canvas element.

When no effect is active and `directPresent` is on, the main pass writes the canvas element directly. See [Post-processing](/guides/post-processing).

A layer with an effect takes the surface route. This layer blurs everything under it:

```ts
import { DualKawaseBlur, Layer, ShapeNode } from 'stargazer'

const panel = new Layer({ effects: [new DualKawaseBlur()], padding: 24 })
panel.add(
  new ShapeNode({
    geometry: { kind: 'rect', width: 400, height: 200, radii: 24 },
    fill: '#12233f',
  }),
)
scene.root.add(panel)
```

The panel's shape draws into a surface of its own. The blur runs when that pass closes, and the main pass composites the blurred result where the panel sits in draw order. A layer with no effects and no cache draws in the main pass like any other group. See [Post-processing](/guides/post-processing) for the effects a layer takes.

### The 3D pass

A stage with 3D content gives its frame target a depth attachment, and `MeshRenderer` draws the {@link Node3D} meshes at the start of the main pass. The 2D runs follow in the same pass and draw on top. When the last 3D node leaves the tree, the stage drops the depth attachment again. A 2D-only stage creates none. See [3D](/guides/3d).

### Backends

`GpuGfx` and `MeshRenderer` draw through `GfxDevice`, an interface that follows WebGPU: immutable pipelines, render passes with load and store operations, bind groups, and draws that state all their inputs. The WebGPU backend implements it directly, and the WebGL2 backend emulates it. The code that calls the interface is the same for both, so a node draws the same picture on either backend.

Shaders are written in WGSL. The WebGL2 backend loads GLSL files generated from them, named `*.gen.vert.glsl` and `*.gen.frag.glsl`. After you edit a WGSL file, run `npm run gen:shaders` to regenerate the GLSL.

Pipelines compile asynchronously when a stage starts, and the stage skips frames until they are ready. On WebGL2 they are ready before the next frame.

### Stages

A {@link Stage} is one canvas element with its own {@link Renderer}, scene tree, cameras, GPU context and render target. The engine owns the primary stage at `engine.primaryStage`, and `engine.tree`, `engine.renderer` and `engine.currentCamera2D` read from it.

```ts
import { CameraNode2D } from 'stargazer'

const stage = engine.attachStage(secondCanvas, { interactive: true })
const cam = new CameraNode2D()
cam.setViewport({ x: 0, y: 0, width: 400, height: 300 })
stage.tree.root.add(cam)
```

The second canvas element draws its own tree through its own camera, on the same clock as the first.

[`engine.attachStage`](/module/engine/engine#attachstage) adds a stage for another canvas element. All stages share the ticker, the tween animator and the pause flag. The primary stage and stages created with `interactive: true` receive pointer input. See [Stages](/guides/stages).

### The Svelte boundary

Svelte code talks to the engine through the {@link EngineHost}. Commands go in: `start`, `stop`, `pause`, `resume`, `destroy` and `loadScene`. Events come out on `host.events`, typed by {@link EngineEvents}.

Create an {@link Emitter} with {@link createEmitter} for your own game events. Two helpers connect emitters to Svelte:

- {@link mountEngine} is a `<canvas>` action that creates the host and destroys it on unmount.
- {@link emitterStore} and {@link latestEventStore} turn an emitter event into a readable store.

Use stores for events that fire now and then. Read per-frame values with `on` inside a `$effect`, because each store update re-renders the components that read it, and `frame` and `pointerMove` fire many times per second. The store helpers log a warning when given those two events.

```ts
import { emitterStore } from 'stargazer'

// An event that fires a few times a minute, as a store.
const score = emitterStore(game.events, 'score', 0) // {$score} in markup

// A per-frame value, read straight from the event.
$effect(() => host.events.on('frame', ({ dt }) => updateFpsMeter(dt)))
```

Move things with tweens and behaviors in the [Animation](/guides/animation) guide.

## See also

- {@link Engine}: the frame loop and the subsystems
- {@link Ticker}: the clock and the fixed step
- {@link SceneTree}: the tree a stage draws
- {@link Stage}: one canvas with its own tree
- {@link Picture}: the recorded drawing of a node
- {@link Gfx2D}: the 2D drawing interface
- [Engine setup](/guides/setup): mounting the engine and its options
- [Scene graph](/guides/scene): nodes, behaviors and draw order
- [Drawing](/guides/drawing): painting nodes
- [Rendering performance](/guides/performance): what breaks a batch and what the renderer keeps
- [Stages](/guides/stages): more canvases on the same clock
- [3D](/guides/3d): meshes, lights and the 3D pass
