---
title: Combined depth and stencil
group: Internals
order: 23
---

# Combined depth and stencil on one target

A stage's render target carries depth and stencil on one attachment. A scene can then hold 3D content and 2D strokes that use the stencil, such as translucent multi-segment strokes, at the same time. Every pipeline and pass matches that attachment's format, and a target allocated with `depthSampled` carries the depth aspect alone. This page is for changes to the backends, the 2D programs and `Stage.render`.

## Why a pipeline has to know

A pipeline bakes in the depth-stencil format of the attachment it draws into, and WebGPU rejects a pipeline whose format differs from the pass's attachment. Every pipeline that shares a pass therefore names the same format, including the 2D pipelines that test neither depth nor stencil. A 2D pipeline that draws into a combined attachment declares it like this.

```ts
import type { PipelineDesc } from 'src/render/gfx/GfxDevice'

const states = {
  depthStencil: 'depth-stencil',
  depth: null,
  stencil: null,
} satisfies Partial<PipelineDesc>
```

`PipelineDesc.depthStencil` names the format. When it is omitted, the format follows from `depth` and `stencil`, which is right whenever a pipeline uses every aspect its target carries. With both states null, as above, the backend supplies the inert half: writes off and an always-pass comparison for depth, and all-`keep` operations with a zero write mask for stencil.

`resolveDepthStencil` in `render/gfx/depthStencil.ts` is the one function both backends and `pipelineKey` call. The format goes into the cache key through that function, so a key and the backend that compiles the descriptor always agree.

## The three formats

| Aspects         | WebGPU                 | WebGL2             |
| --------------- | ---------------------- | ------------------ |
| `stencil`       | `stencil8`             | `STENCIL_INDEX8`   |
| `depth`         | `depth24plus`          | `DEPTH24_STENCIL8` |
| `depth-stencil` | `depth24plus-stencil8` | `DEPTH24_STENCIL8` |

A stencil-only attachment takes a quarter of the memory of a combined one, which is what a pure-2D stage needs. A target that asks for both aspects gets the combined format. WebGL2 packs depth with stencil either way.

## The attachment drives the pass

`WebGPUDevice.beginRenderPass` builds one `depthStencilAttachment` from the target's own format. It ignores which of `depth` and `stencil` the caller filled in, because WebGPU requires operations for every aspect the format carries and for no other.

An aspect the caller left out is cleared. A load would be legal, since WebGPU zero-initializes lazily, but it leaves depth at `0.0`, and with the engine's `less-equal` default every fragment then fails the depth test. Clearing keeps 3D content visible.

## Swapping the attachment

`GpuGfx.enableDepth` and `GpuGfx.disableDepth` both go through one `#retarget`. It rebuilds the target and warms every pipeline again when the resolved format changed. The path-shadow bakes draw into targets of their own, so a swap leaves them alone.

`Stage.render` attaches depth while a 3D camera exists and either the scene holds 3D content or the 3D debug camera is active. It releases depth otherwise. The check uses `tree.has3D`, which is structural, so the attachment stays put while a scene hides its meshes. A stage outlives the scenes drawn on it, so a depth attachment kept after the last 3D node would stay allocated for the rest of the stage's life. The release frees that memory, and the stencil bits stay either way.

Both calls sit ahead of the readiness gate in `Stage.render`. The swap invalidates every pipeline baked against the old attachment, so the frame that triggers it is the frame that is skipped. The first swap on a stage pays for a real compile. Later swaps find the pipelines in the device's cache.

## Sampled depth targets

A target allocated with `depthSampled`, such as the ambient-occlusion G-buffer, carries the depth aspect alone. Stencil requested with it is neither allocated nor reported. WebGL2 samples depth only from a `DEPTH_COMPONENT24` texture, which has no stencil bits, so reporting stencil would make WebGL2 differ from WebGPU for the same options. `depthStencilFormatFor` applies the rule.

## What the stencil bits mean

The 2D renderer divides each 8-bit stencil value so that fills, clip paths and translucent strokes can overlap without overwriting each other's bits.

| Bits | Holds                                                               |
| ---- | ------------------------------------------------------------------- |
| 7..5 | Clip depth `D` (0 to 7). A pixel is inside when its bits equal `D`. |
| 4    | Flag, set by a translucent stroke while it paints a pixel.          |
| 3..0 | Winding count modulo 16. Non-zero only between a fan and its cover. |

A 3D pass or any other writer outside the 2D renderer leaves bits 7..5 at zero where 2D content starts.

`render/gfx/stencilRecipe.ts` holds one row per operation in `STENCIL_ROWS`, with the compare function, operations, masks and the reference each row uses. WebGPU bakes those into the pipeline and keeps only the reference dynamic, so every row is its own pipeline variant. The fan of a nonzero fill shows the pattern.

```ts
import { STENCIL_ROWS, stencilReferenceFor } from 'src/render/gfx/stencilRecipe'

const { state, colorWrite } = STENCIL_ROWS.fanNonzero
const reference = stencilReferenceFor('fanNonzero', 2)
console.log(state.front, state.back, colorWrite, reference)
```

The row compares with `equal` and the reference is `D << 5`, which is 64 at clip depth 2. Where the depth bits equal `D`, front-facing triangles of the fan add one to the winding bits and back-facing triangles subtract one. The write mask keeps carries and borrows inside bits 3..0, and color writes are off. A cover quad then paints where the count is non-zero and zeroes it again, so the winding bits are zero everywhere outside a fan and its cover. The rows for clip apply, clip pop, the even-odd rule and strokes are commented one by one in the file.

A translucent stroke draws three passes over the same instances. The core pass and the fringe pass both use the stroke mark row, which paints a pixel once because the first fragment sets the flag. The reset pass clears the flag with color writes off.

A fill records its fan and its cover back to back, in the fan stream and the main stream. A clip push writes its fan and apply quad from one reservation. A fan is a set of triangles from the first point of each contour, written with the same vertex layout as every other `coloredTri` draw. The cover is a device-space quad over the path's bounds, clipped to the target, so a path with a small visible part costs a small cover.

## Verifying it

`?demo=shapes3d` draws a translucent multi-segment stroke over a 3D scene, and the `T` key detaches and re-attaches the 3D content. The stroke reads as one even band in both states. The demo runs on WebGL2 by default and on WebGPU with `?gfx=webgpu`. Check both.
