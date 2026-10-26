# Stargazer

Stargazer is a 2D rendering engine with a WebGPU and WebGL backend, written entirely in TypeScript.

Stargazer builds scenes from a tree of nodes, each with its own transform. Nodes can carry logic through attached and reusable behaviors. Cameras decide what is visible, and 2D and 3D nodes can share one tree (though render in separate passes).

A node in Stargazer draws with immediate-mode-style commands such as `fillCircle` and `strokePath`. The engine records them once and replays them directly from the GPU until changes are made.

Draw commands are batched, and geometry stays cached on the GPU while nothing changes. A scene at rest uploads little, and frame cost comes from state changes such as program, texture, blend mode and clip, not from the number of shapes. The [rendering model](https://julianagaibler.github.io/stargazer/guides/rendering) guide has the details.

Stargazer is WebGPU first, with a WebGL2 fallback behind the same device interface that draws the same scenes. Shaders are written once in WGSL and converted to GLSL.

## Features

- Scene graph with tweens, behaviors, cameras and pointer input in world units
- 2D vector drawing: shapes, SVG paths, strokes, gradients, drop shadows and clipping
- Text through the browser's text engine, and layout that keeps menus fitted to the window
- Lottie and dotLottie playback, particles and 2D physics
- Post-processing effects, per layer or for the whole stage
- Experiemental (optional) 3D pass with meshes, lights, shadows and ambient occlusion
- HTML overlays that can be attached to scene nodes and transform with them seamlessly
- Extendable debug interface

## Install

```sh
npm install @julianagaibler/stargazer svelte
```

Svelte 5 is a peer dependency. The `mountEngine` action and the debug UI use it. The engine itself has two dependencies, `earcut` and `esm-env`. Install `@webgpu/types` as well if you want WebGPU types in your own project.

## Quick start

Give a `<canvas>` a CSS size and mount the engine on it. The engine picks WebGPU where it works and falls back to WebGL2:

```ts
import {
  CameraNode2D,
  ShapeNode,
  createEngineHost,
  selectGfxDevice,
} from '@julianagaibler/stargazer'

const canvas = document.querySelector('canvas')!
const { device } = await selectGfxDevice(canvas, 'auto')
const host = createEngineHost({
  canvas,
  gpuDevice: device,
  clearColor: '#0d1a2c',
})

await host.loadScene((scene) => {
  const camera = new CameraNode2D()
  camera.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(camera)
  scene.root.add(
    new ShapeNode({
      geometry: { kind: 'circle', radius: 40 },
      fill: '#ffd34d',
    }),
  )
})

host.start()
```

A yellow circle appears on a dark blue background. In Svelte, the [`mountEngine`](https://julianagaibler.github.io/stargazer/module/svelte/mountengine) action does the same from a `<canvas>`. The [Getting started guide](https://julianagaibler.github.io/stargazer/guides/getting-started) builds a small project from here.

## Where to read next

The sidebar lists a guide for each feature, and the API reference lists every symbol by module. [Architecture](https://julianagaibler.github.io/stargazer/guides/architecture) explains the frame loop, and [Rendering model](https://julianagaibler.github.io/stargazer/guides/rendering) explains how a tree becomes GPU work.

## Run the demos

`npm run demo` starts the runnable scenes in `demo/`. Each opens at `?demo=<name>`, and `demo/demo-scene.ts` is the shortest.

## License

MPL-2.0
