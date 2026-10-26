# Stargazer

Stargazer is a 2D game engine with an optional 3D pass, written in TypeScript. You build a scene graph of nodes, and a renderer with a WebGPU and a WebGL2 backend draws it to a `<canvas>`. A Svelte 5 action mounts the engine on the canvas element.

The engine takes care of drawing, input, animation, and timing. Your code owns the game's rules and state.

## Quick start

A scene shows content once it has a camera. This builder adds a camera that frames a 1920 by 1080 world and one circle at the world origin:

```ts
import { CameraNode2D, ShapeNode } from 'stargazer'
import type { SceneBuilder } from 'stargazer'

export const buildScene: SceneBuilder = (scene) => {
  const camera = new CameraNode2D()
  camera.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(camera)

  scene.root.add(
    new ShapeNode({
      geometry: { kind: 'circle', radius: 40 },
      fill: '#ffd34d',
    }),
  )
}
```

In a Svelte component, the [`mountEngine`](/module/svelte/mountengine) action builds an [`EngineHost`](/module/engine/enginehost) from the canvas and destroys it when the component unmounts:

```svelte
<script lang="ts">
  import { mountEngine } from 'stargazer'
  import type { EngineHost } from 'stargazer'
  import { buildScene } from './scene'

  async function onReady(host: EngineHost): Promise<void> {
    await host.loadScene(buildScene)
    host.start()
  }
</script>

<canvas use:mountEngine={{ options: { clearColor: '#0d1a2c' }, onReady }}
></canvas>
```

The canvas shows a yellow circle on a dark blue background. Outside Svelte, call [`createEngineHost`](/module/engine/createenginehost) with the canvas element instead.

## Two ways to put things on screen

A built-in node describes what to show through options. This card is a [`ShapeNode`](/module/nodes/shapenode):

```ts
import { ShapeNode } from 'stargazer'

const card = new ShapeNode({
  geometry: { kind: 'rect', width: 240, height: 140, radii: 16 },
  fill: '#1c2438',
  stroke: '#ffd34d',
  lineWidth: 2,
})
```

When no built-in node draws what you need, write a custom node. It overrides `paint` and records draw commands on a [`Canvas`](/module/scene/canvas). The engine keeps the recording as a picture and replays it every frame. This node draws the same card:

```ts
import { Node2D } from 'stargazer'
import type { Canvas } from 'stargazer'

class Card extends Node2D {
  override paint(canvas: Canvas): void {
    canvas.fillAndStrokeRoundRect(-120, -70, 240, 140, 16, '#1c2438', {
      color: '#ffd34d',
      width: { screen: 2 },
    })
  }
}
```

Start with built-in nodes. Choose a custom node when one node draws many things, such as a grid or a gauge.

The two combine. Every built-in node is a `Node2D`, so a custom node can be its child and draw in the parent's local space. A subclass can also call `super.paint(canvas)` and then add its own draw commands:

```ts
class ScoreCard extends ShapeNode {
  override paint(canvas: Canvas): void {
    super.paint(canvas)
    canvas.fillCircle(100, -50, 8, '#ff5a5f')
  }
}
```

The [Drawing guide](/guides/drawing) covers the draw commands.

## What the engine covers

Nodes move with tweens and behaviors, and a camera pans and zooms the view. Pointer input arrives in world units. Text uses the browser's text engine, and layout keeps menus fitted to the window. SVG paths and Lottie files load as nodes. Particles, 2D physics, post-processing effects and 3D meshes work in the same scene. HTML elements can follow nodes, an accessibility layer mirrors chosen nodes for screen readers, and a debug HUD shows frame cost. Optional systems cost nothing until your code uses them.

## Where to read next

Start with the [Getting started guide](/guides/getting-started). It builds one small project from a single shape to a scene with a HUD. The sidebar lists the guide for each feature, and the API reference lists every symbol by module.

## Run the demos

`npm run demo` starts the runnable scenes in `demo/`. Each opens at `?demo=<name>`, and `demo/demo-scene.ts` is the shortest.

## License

MPL-2.0
