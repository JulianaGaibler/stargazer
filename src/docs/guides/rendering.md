---
title: Rendering model
group: Internals
order: 20
---

# Rendering model

This page explains how a scene tree becomes GPU work: what a node records, what the renderer replays, what it batches and what it keeps between frames. Read it when you choose between `paint` and `draw`, when a frame costs more than you expect, or when you extend the renderer. [Architecture](/guides/architecture) covers the frame loop and the order your code runs in.

## The pipeline at a glance

```
SceneTree          nodes in draw order
   |  compose walk, once per frame
   v
Picture replay     retained: a recorded Picture, replayed under the node's transform
node.draw()        immediate: the node issues its draws itself, every frame
   |  both call Gfx2D
   v
GpuGfx             per-program streams cut into runs (the command list)
   |  end of frame: merge runs, upload each stream once
   v
GfxDevice          one interface, a WebGPU backend and a WebGL2 backend
   |
   v
surface passes -> main pass (3D meshes, then 2D runs) -> post-processing -> canvas
```

| Part                               | Job                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| {@link SceneTree}                  | Holds the nodes. 2D and 3D nodes share one tree.                                            |
| Compose walk                       | Visits visible 2D nodes in draw order, repaints stale pictures, culls, replays.             |
| {@link Picture} and {@link Canvas} | A node records its drawing once. The picture replays until something it depends on changes. |
| `GpuGfx`                           | Implements {@link Gfx2D}. Turns draw calls into batched runs and owns the caches.           |
| `MeshRenderer`                     | Draws {@link Node3D} meshes, shadow maps and ambient occlusion.                             |
| `GfxDevice`                        | A WebGPU-shaped interface that both backends implement.                                     |

## Two ways to draw

A 2D node draws in one of two ways.

|                | Retained: `paint(canvas)`                                                               | Immediate: `draw(gfx, camera, dt)`                       |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Runs           | Once, then again when a dependency changes                                              | Every frame                                              |
| Output         | A recorded {@link Picture} the engine replays                                           | Direct calls on {@link Gfx2D}, nothing recorded          |
| Bounds         | Computed while recording, so offscreen nodes are skipped                                | None. Culled only when the node sets `boundsOverride`.   |
| Cached layers  | Fine                                                                                    | Makes a cached {@link Layer} above it render every frame |
| Built-in nodes | `ShapeNode`, `Path2DNode`, `PolylineNode`, `TextNode`, `ImageNode`, both particle nodes | `LottieNode`                                             |

Retained is the default. Immediate suits content that changes on every frame, where recording a new picture each frame would cost more than drawing directly, such as a waveform. Both paths end in the same `Gfx2D` calls, so the renderer batches and caches them the same way.

## Retained drawing: pictures

A {@link Canvas} records each call as an operation with its arguments into a {@link Picture}. It copies the arguments, so a scratch array that your code reuses cannot change what was recorded. Images and paths are the exception and are kept by reference. While recording, the canvas works out the picture's bounds and notes whether the drawing depends on the camera, the screen scale or a versioned resource.

The engine replays a picture under the node's world transform and alpha. Moving, scaling, rotating and fading a node therefore never record again.

A node records its picture again on the next frame when:

- it has no picture yet
- a property declared with `definePaintProps` changed, compared with `Object.is`
- code called `markNeedsPaint()`
- a resource passed to `canvas.use` changed its `version`
- `paint` read the camera's visible rect and the camera moved
- `paint` read the screen scale and it changed
- the picture depends on the device scale, as text does, and the scale stopped at a new value

`paint` has to read only declared state. A read of the clock, the node's transform or the camera that is not declared leaves a picture that is out of date until something else repaints it. In development the engine guards against this. Each frame it records two nodes that were not marked dirty and compares the result with the kept picture. It warns when they differ. A call to `markNeedsPaint()` while a node paints throws, and so does a `Canvas` call after `paint` returns.

Content that moves on a clock belongs in a small child node whose transform `onUpdate` writes. Each child keeps its own picture, and the parent's `paint` runs once.

## Immediate drawing

The engine calls `draw` every frame with the node's transform and alpha already set on `gfx`. It records nothing. The node has no picture bounds, so the walk cannot cull it unless the node sets `boundsOverride`, and a cached layer that contains it cannot keep its result.

## The compose walk

Each frame the stage walks the tree once in draw order. For each visible 2D node it:

1. repaints the picture if it is missing or stale
2. skips the node when its bounds are known and fully outside the view, padded for strokes and anti-aliasing
3. replays the picture, or calls `draw`, under the node's world transform and alpha

The walk also applies clips, `InsetViewNode` views and {@link Layer} spaces and effects. A node whose picture holds a `Path2D` call has no bounds, because a `Path2D` has none of its own, so it draws every frame until you set `boundsOverride`.

## The command list

`GpuGfx` does not draw while the walk runs. It records.

- Each draw call appends vertex or instance data to a stream that belongs to its shader program.
- A change of program, texture, blend mode or clip ends the current run. A run is one future draw call.
- Alpha, color and transform go into the per-instance data, so a change in them keeps the run going.

At the end of the frame the renderer merges runs, uploads each stream once and replays the runs in draw order. A run joins an earlier run with the same program and state when no run between them touches the same pixels, so painter order holds wherever pixels overlap. Draws of one kind on separate pixels therefore cost one draw call.

The cost of a frame follows from this. It depends on how often program, texture, blend mode and clip change between overlapping draws, and much less on how many shapes there are. [Rendering performance](/guides/performance) lists what breaks a batch.

## What a draw call becomes

Each draw call goes to one program, and the program decides how the shape reaches the screen.

| Program                            | Draws                                                                                                                                                                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`                            | Circles, ellipses and rounded rectangles, analytic shadows, and text and small images from the label page and atlas. One instance per shape, and the fragment shader evaluates a signed distance function, so edges stay sharp at any scale. |
| `coloredTri`                       | Plain rectangles, convex polygons, tessellated paths and linear gradients, as triangles.                                                                                                                                                     |
| `stroke`                           | Lines, quadratic curves and polylines, flattened into segments.                                                                                                                                                                              |
| `textQuad`                         | Images with a texture of their own, and oversized labels.                                                                                                                                                                                    |
| `gradientRadial`, `maskedGradient` | Radial gradients and gradients under a mask.                                                                                                                                                                                                 |
| `shaderQuad`                       | A rectangle with your own fragment shader.                                                                                                                                                                                                   |
| `pathShadowComposite`              | Path shadows, from a cached mask.                                                                                                                                                                                                            |
| `offscreenComposite`               | Surfaces, drawn back into the frame.                                                                                                                                                                                                         |

Circles and rounded rectangles are the cheapest shapes. Each is a single instance, and they share one run with text and sprites. A path is tessellated into triangles, which costs more to build and to upload, so the renderer keeps the result for long paths.

Built-in nodes record the same `Canvas` calls that a custom `paint` makes. A `ShapeNode` circle and a custom node that calls `canvas.fillCircle` draw identically and cost the same. The built-in nodes add bounds, hit testing and stroke scaling on top.

## What the renderer keeps

A picture is a CPU-side recording. Separately, the renderer keeps built geometry on the GPU between frames, so a node at rest uploads little. One policy covers these caches.

- Something is kept on its second frame in a row with the same key, so content that changes on every frame never takes memory.
- A kept entry that goes unused for a while is dropped. When a cache passes its memory budget, the least recently used entries go first, and never one used in the current frame.
- Only what costs no extra draw call to keep is kept.

The kept content includes long strokes of 256 or more segments without dashes, the tessellation of large registered `Path2D` shapes, `Path2D` stroke outlines, flattened `GfxPath` shapes, text and small images on the shared label page. Path shadow masks are kept by a cache of their own, which frees a mask when a new one needs the bytes. See [Shadows on paths](/guides/drawing#shadows-on-paths).

A kept entry is keyed on its source plus what shaped it. For a stroke that is the transform, the alpha and the style. A node that moves, scales, rotates or fades on every frame therefore builds its strokes again each frame, even while its picture rests, and recording a picture again frees what was kept for the old one. The Caches section of the debug HUD shows what is kept, what is admitted and what is evicted.

## Surfaces, layers and passes

Some nodes draw into an offscreen surface and the renderer then draws that surface into the frame. A {@link Layer} with effects or a raster cache does this, and so does a node with `compositeGroup`, a `compositeBlend` other than `'source-over'`, or a `matte`.

In the command list a surface's runs sit between a begin mark and an end mark. At submit time every surface gets a render pass of its own, and those passes run before the main pass. A nested surface runs before the surface that contains it. A layer's effects run when its pass closes.

A layer with `cache: 'raster'` keeps its rendered result, with effects applied, and draws one textured quad on frames that reuse it. It renders again when a node under it moves, changes visibility or alpha, repaints, is added or removed, when an effect's parameters change, or when the canvas, the view or the region changes. An immediate node, a matte or a nested layer with effects under it makes the layer render every frame, and development builds warn once.

One stage frame runs in this order:

1. Check that the stage's pipelines are ready. The stage skips the frame until they are.
2. Bake the path shadow masks that the previous frame asked for.
3. Render the 3D shadow maps and ambient occlusion, if the stage has 3D content.
4. Record the 2D walk and the debug overlays.
5. Run every surface pass.
6. Run the main pass: clear, draw the 3D meshes, then the 2D runs.
7. Run post-processing, if any effect is active. It reads the frame and writes the canvas element.

When no effect is active and `directPresent` is on, the main pass writes the canvas element directly.

## The 3D pass

A stage with 3D content gives its frame target a depth attachment, and `MeshRenderer` draws the meshes at the start of the main pass. The 2D runs follow in the same pass and draw on top. The attachment is released when the last 3D node leaves the tree, and a 2D-only stage never has one. See [3D](/guides/3d).

## Backends and shaders

`GpuGfx` and `MeshRenderer` draw through `GfxDevice`, an interface that follows WebGPU: immutable pipelines, render passes with load and store operations, bind groups, and draws that state all their inputs. The WebGPU backend implements it directly. The WebGL2 backend emulates it on top of GL state, for example by re-pointing vertex buffers where WebGPU would use a base instance. The code above the interface is the same for both, so a node draws the same picture on either.

The Svelte action picks the backend. `'auto'` probes WebGPU on a throwaway device and falls back to WebGL2 when it does not render, and `createEngineHost` uses WebGL2. See [Engine setup](/guides/setup#pick-a-backend).

Shaders are written once in WGSL. A small Rust tool built on naga, `shader-gen`, flattens each shader's includes into a `*.gen.wgsl` file and generates GLSL for WebGL2 as `*.gen.vert.glsl` and `*.gen.frag.glsl`, with a `*.reflect.json` sidecar that describes the bindings. The generated files are checked in, and `npm run gen:shaders` rebuilds them after a WGSL edit. Pipelines compile asynchronously when a stage starts, and the stage skips frames until they are ready.

A lost WebGL2 context can come back. The host rebuilds the GPU resources and every cache above is built again on demand. A lost WebGPU device stays lost. See [Engine setup](/guides/setup#respond-to-context-loss).

## Where the cost goes

| What your code does                                                 | What the renderer does                                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Moves, scales or fades a retained node                              | Replays its picture. Nothing records again.                                                    |
| Writes a declared paint property                                    | Records the picture again on the next frame.                                                   |
| Draws many shapes of one kind on separate pixels                    | Merges them into one draw call.                                                                |
| Alternates programs, blend modes or clips between overlapping draws | Cuts a new run at each change, so more draw calls.                                             |
| Animates a long stroke every frame                                  | Builds the stroke again each frame, because the kept copy is keyed on its transform and alpha. |
| Adds an immediate node                                              | Re-issues its draws every frame and keeps any layer above it from caching.                     |
| Adds an effect layer                                                | Draws the subtree into a surface and runs the effect in an extra pass.                         |
| Leaves a scene at rest                                              | Replays pictures, draws kept content with no upload, and a cached layer draws one quad.        |

## Reading it in the debug HUD

The HUD shows the cost of each part. The Uploaded tooltip breaks the upload down by program, and the Caches group lists what is kept and which pictures stream the most bytes every frame. A picture that uploads kilobytes every frame while its node rests often draws something that cannot be kept. See [Debugging](/guides/debugging) and [Rendering performance](/guides/performance).

## See also

- [Architecture](/guides/architecture): the frame loop, coordinate spaces and draw order
- [Drawing](/guides/drawing): the `Canvas` and `Gfx2D` draw commands
- [Rendering performance](/guides/performance): what breaks a batch and what the renderer keeps
- [Post-processing](/guides/post-processing): effects on layers and on the stage
- [3D](/guides/3d): meshes, lights and the 3D pass
- [Engine setup](/guides/setup): backends and context loss
