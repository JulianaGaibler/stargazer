---
title: Debugging
group: Features
order: 10
---

# Debugging

Every engine host has a {@link DebugController} at `host.debug`. It owns the debug HUD, the hotkeys, a free 2D and 3D debug camera, on-canvas overlays, and the per-frame stats. This page shows how to open the HUD, move around a running scene, read the frame cost, and add a panel of your own.

The host builds the controller in every build, so the hotkeys work whether or not the HUD is mounted. The HUD itself is the `DebugHud` Svelte component. Mount it next to the canvas and pass it `host.debug`.

```svelte
<script lang="ts">
  import { DebugHud } from 'stargazer/debug-ui'
  import type { EngineHost } from 'stargazer'

  const { host }: { host: EngineHost } = $props()
</script>

<DebugHud debug={host.debug} />
```

## Basic usage

Add `?debug=hud` to the page URL to open the HUD on boot, or press `Y` at any time. In code, pass `debug: 'hud'` to {@link createEngineHost}, or toggle it at runtime.

```ts
host.debug.setHudVisible(true)
host.debug.toggleHud()
```

The `debug` option takes `'hidden'`, `'hud'` or `'perf'`. When you leave it out, the host reads the `?debug` URL flag, and any value other than `hud` or `perf` starts with the HUD hidden.

### Hotkeys

The controller listens for keys on the window and skips keys typed into text fields.

| Key | Effect                                                         |
| --- | -------------------------------------------------------------- |
| `Y` | Show or hide the HUD                                           |
| `C` | Toggle the 2D pan and zoom debug camera                        |
| `V` | Toggle the 3D fly camera                                       |
| `G` | Make the 2D debug camera follow the game camera                |
| `R` | Reset the active debug camera to the game camera's view        |
| `O` | Outline node bounds                                            |
| `L` | Outline layout boxes                                           |
| `X` | Show the coordinate grid                                       |
| `T` | Show the pointer overlay                                       |
| `P` | Freeze updates, tweens, and the fixed step, but keep rendering |

### Debug cameras

Press `C` to look at the scene from a camera you can move. The game camera stays as it is, and its viewport shows as a dashed rectangle. Pointer input still goes through the camera on screen, so you can tap a shape while you look at it from elsewhere.

The 2D camera pans with `W`, `A`, `S` and `D`, and zooms with `E` (in) and `Q` (out). Press `V` for the 3D fly camera, which also moves with `W`, `A`, `S` and `D`, rises with `E` and sinks with `Q`. The arrow keys turn it. Click the canvas to turn it with the mouse, and press `Esc` to release the mouse. The scroll wheel sets the fly speed and `Shift` sprints. The HUD's camera pad has buttons for the same moves on touch screens.

[`engine.activeCamera`](/module/engine/engine#activecamera) is the camera on screen. [`engine.currentCamera2D`](/module/engine/engine#currentcamera2d) is the one the game set. They differ while a debug camera is on.

### Pausing

Press `P` to freeze the game and keep looking around.

```ts
host.engine.setPaused(true)
host.engine.setPaused(false)
```

[`engine.setPaused`](/module/engine/engine#setpaused) stops `onUpdate`, `onFixedStep`, physics and tweens. Rendering and the debug cameras keep running, so you can explore a frozen frame. [`host.pause()`](/module/engine/enginehost#pause) stops the ticker instead, and nothing renders until `host.resume()`.

## Advanced usage

These sections describe each HUD panel, how to add your own, the URL flags, performance marks, and how to read the numbers.

### The hub window

The hub window is the HUD's home. It shows FPS and the CPU work per frame (p50, p95, p99 and max) with a frame graph, and it has a button for each panel and toggles for pause, outlines, the grid and the camera mode. With more than one stage attached, a stage selector picks which stage the panels show.

FPS comes from the real time between frames. The CPU numbers come from [`engine.lastFrameWorkSec`](/module/engine/engine#lastframeworksec), the CPU time from the start of a frame to the end of rendering, so idle waits stay out of it. A 60 Hz frame with room to spare reads 1 to 10 ms, while frames arrive every 16.7 ms.

### Scene panel

The Scene panel shows the active camera, its viewport and its pixels per world unit, and you can make another camera current from it. It counts the nodes and live particles in the stage.

The scene tree lists 2D, 3D and group nodes together. Selecting a node outlines it and shows its position, scale, alpha, bounds and behaviors.

### Rendering panel

The Rendering panel shows what a frame costs. A status row names the backend and the MSAA setting, and a health chip lists the readings outside their good range, worst first. Below it, cards show draw calls, p95 frame time, pictures painted, bytes uploaded, primitives and stale pictures, each with a sparkline of recent frames.

A card is green in its good range, amber in its warning range and red past it. Hover a card, gauge or row for a tooltip. It says what the number counts, what a high reading costs, and where the good and warning ranges end. The ranges are heuristics from benchmarks, and the source keeps them in `THRESHOLDS` in `src/debug/thresholds.ts`.

Collapsible groups follow the cards. Batching shows how often the renderer switches program, texture and blend, and how many draws it merged. Pictures, Instances and Caches give more detail, and Caches shows each retained cache against its memory budget. Rows marked "cumulative" count since startup, because cache and bake work is bursty and reads 0 in most single frames. The 3D group appears when the scene has 3D content.

Debug views has the render mode and a toggle for performance marks. The Textures group is an inspector for the sprite atlas, the label page and each render target.

### Render modes

The render mode recolors what the renderer draws, so you can see overdraw and batches. Pick one under Debug views in the Rendering panel, or set it on a stage from code.

```ts
host.debug.activeStage.setDebugRenderMode('overdraw')
```

Areas drawn many times glow red. The other 2D modes are listed on {@link DebugRenderMode}. With 3D content, {@link MeshRenderMode} adds `wireframe`, `unshaded`, `normals` and `ao` for the mesh pass.

### Quality panel

The Quality panel shows whether frames keep up and what limits them. It compares CPU p95 and GPU time per frame against the frame budget. GPU time needs browser support: timer queries on WebGL2, or the `timestamp-query` feature on WebGPU.

A row of presets sets every setting at once, from Auto to Minimal. Below it, each setting the engine can lower on its own is set to Auto or fixed at a value. Auto shows the value in use and, when the engine has lowered it, what it was lowered from. Each option shows its share of native pixel work, the render-target memory it holds and how it looks. The Fixed settings group holds the settings that stay where you put them, such as the frame cap and the backend.

### Saved quality settings

The host saves settings you fix in the panel to `localStorage`, keyed by screen size and pixel density, and applies them when the page loads. `?quality=reset` clears them and `?quality=off` ignores them and stops saving. The host option `qualityProfile: false` turns the saved settings off in code.

[`engine.qualityControl`](/module/engine/engine#qualitycontrol) does the same from code.

```ts
host.engine.qualityControl.setFixed('msaa', 2) // hold MSAA at 2x
host.engine.qualityControl.setAuto('msaa') // hand it back to the engine
host.engine.qualityControl.applyPreset('efficient')
```

The engine applies a fixed setting every frame, even when the scene sets the same setting itself, and the adaptive controller leaves it where it is. The presets are listed on {@link QualityPresetId}.

### Physics panel

The Physics button appears in the hub when the stage has a physics world. The panel toggles four overlays: collider outlines, AABBs, contact points with normals, and velocity arrows. Colliders are blue for static bodies, green for dynamic and orange for kinematic, and dimmed while asleep.

Each world gets a stats block in its own color, and the overlay draws that world in the same color, so two worlds in one stage are easy to tell apart. See [Physics](/guides/physics).

### Input panel

The Input panel toggles the pointer overlay. It shows the pointer in screen pixels and in world units, the canvas size in CSS and device pixels, and the pixel ratio. Each active pointer is listed with its type, its screen and world position, and the node that captured it.

### Diagnostics panel

The Diagnostics panel lists the engine's recent warnings and errors with their codes, areas, nodes and repeat counts. The hub button shows the count. A filter limits the list to errors, and Clear empties it. See [Diagnostics](/guides/diagnostics).

### Custom panels

[`registerPanel`](/module/debug/debugcontroller#registerpanel) adds your own panel to the hub. It takes a {@link DebugPanelSpec} and returns a function that removes the panel. The component receives `debug` plus the `props` you pass. Build it from the components in [Debug UI](/guides/debug-ui).

```ts
const off = host.debug.registerPanel({
  id: 'board-state',
  title: 'Board',
  component: BoardStatePanel,
  props: { board },
})
// Later, when the component that owns `board` unmounts:
off()
```

Registering the same `id` again replaces the panel. Panels sort by `order`, and panels that set no `order` follow in registration order.

### URL flags

The host reads these flags from the page URL.

- `?debug=hud` opens the HUD on boot.
- `?debug=perf` opens the HUD and turns on performance marks.
- `?msaa=N` sets the MSAA sample count when the host options leave it out. The default is 4.
- `?quality=reset` and `?quality=off` control the saved quality settings.

The backend picker in the Quality panel reloads the page with `?gfx=webgpu` or `?gfx=webgl2`, or with no `gfx` flag for automatic selection. Your app reads `?gfx` and passes the value as the `backend` option of {@link mountEngine}.

### Performance marks

Start the page with `?debug=perf`, or use the toggle under Debug views, and the engine wraps its work in `performance` marks. The browser profiler's user-timing lane then shows each span by name. The marks cost time themselves, so switch them on while you profile.

```ts
host.debug.setPerfMarks(true)
```

| Span                                                                      | Meaning                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `update <id>`                                                             | One node's `onUpdate`                                                                                   |
| `draw <id>`                                                               | One node's draw or picture replay                                                                       |
| `clear`, `3d`, `ao`, `draw2d`, `debug-overlay`                            | One render phase of a stage                                                                             |
| `gfx submit draws=… passes=… surfaces=… uboSlices=… bytes=… target=WxHxN` | Uploading the frame's data and replaying every recorded draw, with the frame's counters and target size |
| `gfx offscreen surface WxH`                                               | One offscreen surface pass                                                                              |
| `gfx present`                                                             | Copying the frame to the canvas, present when the last pass has not already written it                  |
| `lottie evaluate`                                                         | Sampling a Lottie animation at a new frame                                                              |

The profiler drops a measure's detail object, so the counters are part of the span name. The spans measure the time JavaScript spends issuing work. GPU time shows in the Quality panel.

### Reading the numbers

Three readings usually point at a real problem.

A draw-call count that grows with the object count means batches are breaking. Per-object colors, interleaved textures and clip changes inside a loop are the usual causes. See [Rendering performance](/guides/performance).

A label page reset means every label in the scene was drawn again in one frame. It shows in the Caches group and the texture inspector. See [Text](/guides/text).

Bytes uploaded grow with the number of primitives the renderer redraws instead of keeping between frames. The upload buffers grow when a frame needs more room and shrink again after a run of quiet frames.

The path-shadow rows in Caches help tune shadow budgets. A climbing `Outline tessellations` count while the camera is still means a stroke outline is built again every frame. A low `Bake pool hit rate` means mask bakes allocate new render targets instead of taking them from the pool. A `Mask memory` reading that keeps climbing means `quality.vector.shadowMaskBudgetBytes` is larger than the scene needs. See [Path shadows](/path-shadows) for what each budget bounds.

### Demos

The repository has a demo app in `demo/`. Run it with `npm run demo` and open `?demo=<name>` to boot one sandbox scene. `demo/demos.ts` lists them. Each is a short file for one subsystem, and `demo/demo-scene.ts` is the shortest end-to-end example. `?demo=bench&marks` runs the benchmark demo with performance marks on.

## Next step

Build your own panel for the HUD in [Debug UI](/guides/debug-ui).

## See also

- {@link DebugController}: HUD state, hotkeys, overlays, and stats
- {@link DebugPanelSpec}: a custom HUD panel
- [Debug UI](/guides/debug-ui): the components for building panels
- {@link DebugCamera}: the free 2D debug camera
- {@link FrameStats}: the frame-time ring buffer behind the CPU readout
- {@link PhysicsOverlayFlags}: physics overlay toggles
- {@link QualityControl}: fixed and auto quality settings
- {@link EngineHostOptions}: the `debug` and `qualityProfile` options
- [Physics](/guides/physics): worlds, bodies, and the physics overlay
- [Rendering performance](/guides/performance): batching and what the renderer keeps
- [Text](/guides/text): the label cache
- [Path shadows](/path-shadows): shadow mask budgets
