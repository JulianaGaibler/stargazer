---
title: Getting started
group: Getting started
order: 1
---

# Getting started

This guide builds a small game called Star catcher, one step at a time. You put a scene on screen, add shapes and text, move them, react to a tap, add a heads-up display and a second scene, and then draw a node of your own. After the last step you know where to look things up and which habits save time.

You need TypeScript, a page with one `<canvas>` element that has a CSS size, and the `stargazer` package in your project. Every code block imports from `'stargazer'`.

## See something on screen

An {@link EngineHost} runs the engine on a canvas element. A scene shows content once it has a camera, so the first scene adds a {@link CameraNode2D} and one circle.

```ts
import { createEngineHost, CameraNode2D, ShapeNode } from 'stargazer'

const canvas = document.querySelector('canvas')!
const host = createEngineHost({ canvas, clearColor: '#0d1a2c' })

await host.loadScene((scene) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)

  const ball = new ShapeNode({
    geometry: { kind: 'circle', radius: 40 },
    fill: '#ffd34d',
  })
  ball.transform.x = 960
  ball.transform.y = 540
  scene.root.add(ball)
})

host.start()
```

A yellow circle appears in the middle of a dark blue canvas. The camera frames a world that is 1920 units wide and 1080 units high and fits it into the canvas element at a uniform scale, so the circle stays round at any window size. `loadScene` empties the scene and calls your builder, and `host.start()` starts the frame loop.

If the canvas shows only the dark blue, the scene has no camera. Add a `CameraNode2D` to `scene.root` as in the first example. To mount the engine from a Svelte component with an action instead, see [Engine setup](/guides/setup).

## Add things with built-in nodes

A built-in node describes what to show through its options. The rest of this guide adds lines to the scene builder, after the camera. This step adds a backdrop, a card and a label.

```ts
import { ShapeNode, TextNode } from 'stargazer'

const backdrop = new ShapeNode({
  geometry: { kind: 'rect', width: 1920, height: 1080, centered: false },
  fill: '#12233f',
})
scene.root.add(backdrop)

const card = new ShapeNode({
  geometry: { kind: 'rect', width: 240, height: 140, radii: 16 },
  fill: '#1c2438',
  stroke: '#ffd34d',
  lineWidth: 2,
})
card.transform.x = 960
card.transform.y = 760
scene.root.add(card)

const label = new TextNode({
  text: 'Star catcher',
  x: 960,
  y: 760,
  align: 'center',
  baseline: 'middle',
  fontSize: 28,
  fontWeight: 700,
  sizeSpace: 'world',
  color: '#fdf6e3',
})
scene.root.add(label)
```

The canvas shows a slightly lighter backdrop with a dark card near the bottom, a yellow border around it and a cream label in the middle. A rect is centered on the node's position unless you set `centered: false`, which anchors its top-left corner there. `sizeSpace: 'world'` makes the font size a world unit, so the label scales with the card.

A star is a vector path. {@link parseSvgPaths} reads path data from SVG text, and a {@link Path2DNode} draws one of the paths.

```ts
import { Path2DNode, parseSvgPaths } from 'stargazer'

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128">
  <path id="star" d="M0 -60 L17 -20 L57 -18 L26 8 L35 48 L0 26 L-35 48 L-26 8 L-57 -18 L-17 -20 Z"/>
</svg>`
const { paths } = parseSvgPaths(svg, { tessellate: true })
const entry = paths.get('star')!

const star = new Path2DNode({
  path: entry.path,
  bounds: entry.bounds,
  fill: '#ffd34d',
})
star.transform.x = 960
star.transform.y = 360
scene.root.add(star)
```

A yellow star appears over the card, centered on its origin. The same pattern covers lines ({@link PolylineNode}), images ({@link ImageNode}), particles and Lottie animations. The [`nodes` module](/module/nodes) in the API reference lists every built-in node, and the option types such as {@link ShapeGeometry} list every shape a node takes.

## Place and move things

Every node has a `transform` with `x`, `y`, `rotation`, `scaleX`, `scaleY`, `alpha` and more. A node's position is relative to its parent, so children move, turn and fade with it. Move the label into the card and the pair travels together.

```ts
label.x = 0
label.y = 0
card.add(label)

card.transform.rotation = 0.1 // radians, clockwise
card.transform.alpha = 0.9
```

The label now sits in the card's own space, so it keeps its place when the card tilts. Nodes draw in tree order: a parent, then its children in the order they were added. A node added later draws over an earlier one, so the star draws over the backdrop. `parent.addAt(node, index)` inserts a node at a position.

A tween moves numbers from their current values to new values over a duration and returns a promise. `loop` runs an async function again and again while the node lives.

```ts
import { easings } from 'stargazer'

star.loop(async () => {
  await star.tween({ y: 440 }, { duration: 1.2, easing: easings.inOutQuad })
  await star.tween({ y: 360 }, { duration: 1.2, easing: easings.inOutQuad })
})
```

The star floats up and down. Destroying the node ends the loop, because every tween and wait started from a node stops when the node is destroyed. See [Animation](/guides/animation) for timelines, delays and the other tween helpers.

A {@link Behavior} attaches logic that runs on every frame. Write one when something changes continuously and has no end, such as a spin.

```ts
import { Behavior } from 'stargazer'

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

star.addBehavior(new Spin(0.8))
```

The star turns about 0.8 radians per second while it floats. `dt` is the frame time in seconds, and `this.node` is the node the behavior is attached to. Use a tween for a move with a start and an end, and a behavior for something that runs for as long as the node lives.

## React to a tap

A {@link ButtonBehavior} turns a node into a tap button. It calls `onClick` when the pointer goes down and comes up on the node. A path node takes taps over the region its `hitMode` describes, and `'circle'` uses a circle of `hitRadiusWorld` around the node's origin.

```ts
import { ButtonBehavior, easings, ignoreAbort } from 'stargazer'
import type { Node2D } from 'stargazer'

let score = 0

async function pop(node: Node2D): Promise<void> {
  await node.tween({ scaleX: 1.4, scaleY: 1.4 }, { duration: 0.08, key: 'pop' })
  await node.tween(
    { scaleX: 1, scaleY: 1 },
    { duration: 0.2, easing: easings.outBack, key: 'pop' },
  )
}

star.hitMode = 'circle'
star.hitRadiusWorld = 80
star.addBehavior(
  new ButtonBehavior({
    onClick: () => {
      score += 1
      star.transform.x = 300 + Math.random() * 1320
      pop(star).catch(ignoreAbort)
    },
  }),
)
```

Tapping the star scores a point, makes it pop and moves it to a new spot along the row. The `key` option cancels a pop that is still running when the next tap arrives. The cancelled tween rejects with an `AbortError`, and {@link ignoreAbort} ignores that rejection and rethrows any other. To handle raw pointer events or drags, see [Input](/guides/input).

## Build a bigger scene

One long builder function stops being readable. Split the scene into builder functions, which are plain functions that create nodes and return them. A reusable part is a call to a builder. Keep one file per concern:

```
src/
  main.ts
  theme.ts
  game.ts
  parts/camera.ts
  parts/star.ts
  parts/hud.ts
  scenes/title.ts
  scenes/play.ts
```

`theme.ts` holds the shared values, and `game.ts` holds an {@link Emitter} for the game's events. The parts import from them.

```ts
// theme.ts
export const COLORS = {
  backdrop: '#12233f',
  panel: '#1c2438',
  gold: '#ffd34d',
  text: '#fdf6e3',
} as const

export const WORLD = { x: 0, y: 0, width: 1920, height: 1080 }

// game.ts
import { createEmitter } from 'stargazer'

export const game = createEmitter<{ score: number }>()
```

The star becomes a builder that takes a callback. The score lives in the scene builder, and the star only reports a catch.

```ts
// parts/star.ts
import {
  Behavior,
  ButtonBehavior,
  Path2DNode,
  easings,
  ignoreAbort,
  parseSvgPaths,
} from 'stargazer'
import { COLORS } from '../theme'

const STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128">
  <path id="star" d="M0 -60 L17 -20 L57 -18 L26 8 L35 48 L0 26 L-35 48 L-26 8 L-57 -18 L-17 -20 Z"/>
</svg>`

class Spin extends Behavior {
  override onUpdate(dt: number): void {
    this.node.transform.rotation += 0.8 * dt
  }
}

export function buildStar(onCatch: () => void): Path2DNode {
  const { paths } = parseSvgPaths(STAR_SVG, { tessellate: true })
  const entry = paths.get('star')!
  const star = new Path2DNode({
    path: entry.path,
    bounds: entry.bounds,
    fill: COLORS.gold,
    hitMode: 'circle',
    hitRadiusWorld: 80,
  })
  star.transform.x = 960
  star.transform.y = 360
  star.addBehavior(new Spin())
  star.addBehavior(new ButtonBehavior({ onClick: onCatch }))
  star.loop(async () => {
    await star.tween({ y: 440 }, { duration: 1.2, easing: easings.inOutQuad })
    await star.tween({ y: 360 }, { duration: 1.2, easing: easings.inOutQuad })
  })
  return star
}
```

A heads-up display stays in place while the camera moves, so it belongs in a {@link Layer} with its own placement. In a layer with `space: 'screen'`, one unit is one CSS pixel and the origin is the top-left corner of the canvas element.

```ts
// parts/hud.ts
import { Layer, TextNode } from 'stargazer'
import { COLORS } from '../theme'
import { game } from '../game'

export function buildHud(): Layer {
  const hud = new Layer({ space: 'screen' })
  const score = new TextNode({
    text: 'Score 0',
    x: 24,
    y: 24,
    baseline: 'top',
    fontSize: 32,
    fontWeight: 700,
    color: COLORS.text,
  })
  hud.add(score)

  const off = game.on('score', (n) => (score.text = `Score ${n}`))
  hud.events.on('destroy', off)
  return hud
}
```

The HUD listens for `score` events and removes the listener when its layer is destroyed. A layer can also fit a design rectangle into any window shape, see the Layers part of [Scene graph](/guides/scene).

A scene is a function that fills an empty scene. `loadScene` destroys what the previous scene created before it calls the next one, so each scene builds its own camera.

```ts
// scenes/play.ts
import { CameraNode2D, Node2D, ShapeNode } from 'stargazer'
import type { SceneBuilder } from 'stargazer'
import { COLORS, WORLD } from '../theme'
import { game } from '../game'
import { buildStar } from '../parts/star'
import { buildHud } from '../parts/hud'

export function playScene(): SceneBuilder {
  return (scene) => {
    const cam = new CameraNode2D()
    cam.setViewport(WORLD)

    const world = new Node2D('world')
    world.add(
      new ShapeNode({
        geometry: {
          kind: 'rect',
          width: WORLD.width,
          height: WORLD.height,
          centered: false,
        },
        fill: COLORS.backdrop,
      }),
    )
    let score = 0
    world.add(
      buildStar(() => {
        score += 1
        game.emit('score', score)
      }),
    )

    scene.root.add(cam, world, buildHud())
  }
}
```

The `world` group holds the game's content, and the HUD sits beside it under the root. The title scene shows one button, and a tap on it loads the play scene.

```ts
// scenes/title.ts
import { ButtonBehavior, CameraNode2D, ShapeNode, TextNode } from 'stargazer'
import type { EngineHost, SceneBuilder } from 'stargazer'
import { COLORS, WORLD } from '../theme'
import { playScene } from './play'

export function titleScene(host: EngineHost): SceneBuilder {
  return (scene) => {
    const cam = new CameraNode2D()
    cam.setViewport(WORLD)

    const button = new ShapeNode({
      geometry: { kind: 'rect', width: 320, height: 96, radii: 48 },
      fill: COLORS.gold,
    })
    button.transform.x = 960
    button.transform.y = 540
    button.add(
      new TextNode({
        text: 'Play',
        align: 'center',
        baseline: 'middle',
        fontSize: 40,
        fontWeight: 700,
        sizeSpace: 'world',
        color: COLORS.panel,
      }),
    )
    button.addBehavior(
      new ButtonBehavior({
        onClick: () => void host.loadScene(playScene()),
      }),
    )

    scene.root.add(cam, button)
  }
}
```

`main.ts` creates the host and loads the first scene:

```ts
// main.ts
import { createEngineHost } from 'stargazer'
import { titleScene } from './scenes/title'

const canvas = document.querySelector('canvas')!
const host = createEngineHost({ canvas, clearColor: '#0d1a2c' })

await host.loadScene(titleScene(host))
host.start()
```

The canvas shows a yellow pill button labeled Play. Tapping it swaps in the play scene with the spinning star and the score in the top-left corner, and each catch raises the score.

## Draw your own node

When no built-in node draws what you need, write a custom node. Subclass {@link Node2D}, override `paint`, and call draw commands on the {@link Canvas} it receives. The engine records the commands once into a picture and replays the picture every frame.

This node draws the card from earlier in one piece, and a change to `title` repaints it.

```ts
import { Node2D, definePaintProps } from 'stargazer'
import type { Canvas } from 'stargazer'

class Card extends Node2D {
  declare title: string

  constructor(title: string) {
    super()
    definePaintProps(this, { title })
  }

  override paint(canvas: Canvas): void {
    canvas.fillAndStrokeRoundRect(-120, -70, 240, 140, 16, '#1c2438', {
      color: '#ffd34d',
      width: { screen: 2 },
    })
    canvas.fillText(this.title, 0, 0, {
      font: '700 28px sans-serif',
      align: 'center',
      baseline: 'middle',
      color: '#fdf6e3',
    })
  }
}

const card = new Card('Star catcher')
card.transform.x = 960
card.transform.y = 760
scene.root.add(card)
```

The picture matches the card from the built-in version, with the label inside it. Writing `card.title = 'Level 2'` repaints the node, and moving or fading it replays the same picture. Rect coordinates in `paint` give the top-left corner, so the card starts at `(-120, -70)` to center on the node.

A custom node can also add to a built-in one. Add it as a child of the `ShapeNode` and it draws in the shape's local space. Or subclass the built-in node and call `super.paint(canvas)` before your own draw commands:

```ts
import { ShapeNode } from 'stargazer'

class ScoreCard extends ShapeNode {
  override paint(canvas: Canvas): void {
    super.paint(canvas)
    canvas.fillCircle(100, -50, 8, '#ff5a5f')
  }
}
```

The card draws as before, with a red dot near its top-right corner.

Reach for built-in nodes first, because they handle bounds, hit testing and stroke scaling for you. Write a custom node when one node should draw many things, as in a grid, a gauge or a board.

```ts
const STARS = Array.from({ length: 200 }, () => ({
  x: Math.random() * 1920,
  y: Math.random() * 1080,
  r: 1 + Math.random() * 2,
}))

class Starfield extends Node2D {
  override paint(canvas: Canvas): void {
    for (const s of STARS) canvas.fillCircle(s.x, s.y, s.r, '#fdf6e3')
  }
}
```

One node draws 200 dots. The positions are made once at module load, so the picture is the same each time it is recorded. The [Drawing guide](/guides/drawing) covers fills, strokes, gradients, clips and images, and explains the third option, `draw(gfx)`, for content that changes on every frame.

## Where to find things

To see what is available, start from the API reference. Each module page lists its classes, functions and types: `nodes` has the built-in nodes, `scene` has `Node2D`, `Behavior` and `Layer`, and `input` has the pointer events. A node's options type, such as {@link ShapeNodeOptions}, lists every option with its default, and unions such as {@link ShapeGeometry} list every value a field takes.

For a task, read the guide for that feature. The sidebar lists them. The [Scene graph](/guides/scene) guide covers the tree, transforms and layers in depth. The [Camera](/guides/camera) guide covers zoom and panning, [Input](/guides/input) covers taps, drags and multi-touch, and [Text](/guides/text) and [Layout](/guides/layout) cover labels and screens that reflow. [Engine setup](/guides/setup) covers mounting, scene swapping and context loss, and [Architecture](/guides/architecture) explains how a frame runs.

For working code, run the demos. `npm run demo` starts a page that lists them, and `?demo=<name>` opens one. `demo/demo-scene.ts` is the shortest.

## Habits that save time

### The canvas shows only the background color

The scene has no camera. Add a `CameraNode2D` to the scene, as in the first step.

### Content sits half a shape off

A `ShapeNode` rect is centered on the node origin, and `Canvas.fillRect` takes a top-left corner. Use the convention of the API you are in.

```ts
// ShapeNode: x and y are the center.
new ShapeNode({ geometry: { kind: 'rect', width: 100, height: 60 } })

// Canvas: x and y are the top-left corner.
canvas.fillRect(-50, -30, 100, 60, '#fff')
```

### A custom node keeps its first picture

A class field with an initializer hides the setter that `definePaintProps` installs, and development builds throw. Declare the field and give its value to `definePaintProps`.

```ts
class Badge extends Node2D {
  count = 0 // hides the setter

  declare level: number // repaints when written
  constructor() {
    super()
    definePaintProps(this, { level: 1 })
  }
}
```

### A custom node shows stale content

`paint` reads only declared state. Reading the clock, the node's transform or the camera inside `paint` records a picture that stays as it was. Content that moves on a clock goes in a child node whose transform changes in `onUpdate`.

```ts
class Clock extends Node2D {
  override paint(canvas: Canvas): void {
    canvas.rotate(performance.now() / 1000) // stale after the first paint
    canvas.strokeLine(0, 0, 0, -80, { color: '#fdf6e3', width: 4 })
  }
}

class Hand extends Node2D {
  constructor() {
    super()
    this.addBehavior(new Spin(1)) // the transform changes, the picture stays
  }
  override paint(canvas: Canvas): void {
    canvas.strokeLine(0, 0, 0, -80, { color: '#fdf6e3', width: 4 })
  }
}
```

### Many colored objects slow drawing

The engine caches parsed color strings in a bounded cache, and strings built per object or per frame miss it. Build color strings once at module load, and fade with `transform.alpha`, which leaves the picture as it is.

### Overlapping translucent parts show a dark band

Each part blends separately. Set `compositeGroup = true` on the parent so the group fades as one image.

### Hidden objects keep costing time

A hidden subtree still updates. Call `node.destroy()` on a subtree you are finished with.

### A tween rejects when its node is destroyed

Tweens and waits on a node reject with `AbortError` when the node dies. Catch it with {@link ignoreAbort}.

```ts
await star.tween({ alpha: 0 }, { duration: 0.3 }).catch(ignoreAbort)
star.destroy()
```

### A Svelte component updates on every frame

Per-frame events such as `frame` and `pointerMove` update a store many times a second. Subscribe with `host.events.on` inside `$effect` instead.

```ts
$effect(() => host.events.on('frame', ({ dt }) => (elapsed += dt)))
```

### An image looks jagged

An `ImageNode` drawn far below the image's natural size looks jagged. Scale the bitmap once with `createImageBitmap(image, { resizeWidth, resizeHeight, resizeQuality: 'high' })` and give the result to the node.

### A `Path2D` draws nothing

The renderer needs a registered tessellation for it. `parseSvgPaths(text, { tessellate: true })` registers one for each path it returns.

## Next step

Mount the engine in a Svelte component, choose a backend and respond to a lost graphics context in [Engine setup](/guides/setup).
