---
title: Post-processing
group: Features
order: 18
---

# Post-processing

Post-processing runs screen-space effects over the finished frame, after the 3D pass and every 2D layer, before the frame reaches the canvas. Each effect is one or more fullscreen shader passes. After this page you can add a built-in effect such as a {@link Vignette}, {@link DualKawaseBlur} or {@link FilmGrain}, apply effects to part of a scene, and write an effect of your own.

Each stage owns a {@link PostProcessPipeline}. The primary stage's is [`engine.postProcess`](/module/engine/engine#postprocess), and a secondary stage's is [`stage.postProcess`](/module/render/stage#postprocess). The stage creates the pipeline on first access. A frame with no enabled effect is presented directly.

## Basic usage

Add effect instances to the pipeline. This example darkens the corners and adds a color fringe at the edges:

```ts
import { ChromaticAberration, Vignette } from '@julianagaibler/stargazer'

engine.postProcess.add(new Vignette({ intensity: 0.6, radius: 0.4 }))
engine.postProcess.add(new ChromaticAberration({ amount: 0.008 }))
```

Effects run in the order you add them, and each one reads the output of the one before. Adding the same instance a second time changes nothing.

### Change and remove effects

An effect's options are plain fields that the pipeline reads every frame, so you can set or animate them at any time. `add` returns the effect it was given:

```ts
const ca = engine.postProcess.add(new ChromaticAberration({ amount: 0.008 }))

ca.amount = 0.012 // takes effect on the next frame
ca.enabled = false // skipped, but kept in the pipeline
engine.postProcess.remove(ca) // removed, its GPU resources released
```

Set `enabled` to switch an effect off for a while. Call `remove` when you are finished with it.

### Compile effects ahead of time

The first frame with an enabled effect compiles that effect's shaders. The compile is a synchronous stall, long enough to look like the screen froze. Call [`warm`](/module/render/postprocesspipeline#warm) while a scene load or a transition hides the stall:

```ts
const pulse = engine.postProcess.add(new Vignette({ enabled: false }))
engine.postProcess.warm() // compiles every added effect, disabled ones too

// Later, with no stall:
pulse.enabled = true
```

Calling `warm` again skips passes that are already compiled. While a pass is still compiling, the stage presents the unprocessed frame.

### Apply effects to part of the scene

The stage's pipeline processes the whole frame. To process part of the scene, put that part under a {@link Layer} and give the layer the effects. This example blurs what lies behind a panel:

```ts
import { DualKawaseBlur, Layer } from '@julianagaibler/stargazer'

const frosted = new Layer({
  effects: [new DualKawaseBlur({ levels: 3 })],
  padding: 24, // the blur spreads this far past the panel's edge
})
frosted.add(panel)
scene.root.add(frosted)
frosted.warm() // compile the passes while a stall is hidden
```

The layer draws its subtree into a surface, runs the effects over it, and draws the result in the layer's place in tree order. Everything drawn before and after the layer keeps its look. See [Layers](/guides/scene#layers) for the layer itself.

A layer uses the same effect classes as the stage, with the same fields. One effect instance can be on several layers and on the stage at once. The layer reads its `effects` list every frame, so you can change it at any time.

## Advanced usage

### Built-in effects

Each built-in effect takes its options in the constructor and exposes them as public fields. The option types, such as {@link VignetteOptions}, {@link ChromaticAberrationOptions}, {@link VignetteBlurOptions}, {@link DualKawaseBlurOptions} and {@link FilmGrainOptions}, list the options with their defaults. Every effect also has `enabled`.

```ts
import { DualKawaseBlur, FilmGrain } from '@julianagaibler/stargazer'

const blur = engine.postProcess.add(new DualKawaseBlur({ levels: 4 }))
engine.postProcess.add(new FilmGrain({ opacity: 0.1, cellPx: 2 }))

blur.offset = 3 // animate `offset` for a smooth change in blur radius
```

The frame shows a soft image with a fine scatter of tinted cells over it. `levels` steps the blur radius in roughly 2x jumps, so animating it looks like popping, while `offset` changes the radius continuously. Construct the blur at the deepest `levels` you plan to use and call `warm` there, because every shallower chain reuses those passes. The grain after the blur hides the banding that the blur's 8-bit targets can show. A `FilmGrain` with `hz` greater than 0 reads as film on moving images and as crawling static on a still frame.

`DualKawaseBlur` runs `2 * levels` passes. `VignetteBlur` runs two passes, a horizontal and a vertical blur weighted by the same radial mask. The other built-in effects run one pass.

### Write a custom effect

An effect implements {@link PostEffect}: an `enabled` flag and an ordered list of {@link PostPass} objects. A pass is a shader, the byte size of its uniform block, and a callback that fills that block each frame. The pipeline supplies the fullscreen triangle, binds the input texture, and allocates the uniform buffer.

You write each shader in WGSL. `npm run gen:shaders` generates the GLSL that the WebGL2 backend needs. Write one WGSL module per pass with both stages:

- `vs_main` takes `a_pos` at location 0 and `a_uv` at location 1 and passes the uv through.
- `fs_main` samples `u_tex` at binding 0 and reads its own `Params` block at binding 6.

The generator finds the entry points by these names and reports an error for a render shader that uses others. Copy `render/postfx/shaders/vignette.wgsl` as a starting point.

On the TypeScript side, {@link postShader} wraps the generated files and `writeParams` fills the block:

```ts
import { postShader } from '@julianagaibler/stargazer'
import type {
  PostEffect,
  PostPass,
  ShaderReflection,
} from '@julianagaibler/stargazer'
import wgsl from './scanlines.wgsl?raw'
import vertSrc from './scanlines.gen.vert.glsl?raw'
import fragSrc from './scanlines.gen.frag.glsl?raw'
import reflect from './scanlines.reflect.json'

class Scanlines implements PostEffect {
  enabled = true
  strength = 0.2

  readonly passes: readonly PostPass[] = [
    {
      shader: postShader(vertSrc, fragSrc, wgsl, reflect as ShaderReflection),
      paramsBytes: 16, // one vec4, std140
      writeParams: (ctx, out) => {
        out[0] = this.strength
        out[1] = ctx.height
      },
    },
  ]
}

engine.postProcess.add(new Scanlines())
```

`writeParams` runs every frame and reads the effect's live fields, so `strength` can change at any time. `paramsBytes` is the std140 size of the block. A pass with no parameters sets it to `0` and omits `writeParams`.

`npm run gen:shaders` visits every `.wgsl` file under `src`, so an effect's shader can sit next to the code that uses it. The generated `.gen.vert.glsl`, `.gen.frag.glsl` and `.reflect.json` files land next to the `.wgsl` file.

`npm run check:wgsl` compiles the same files with Chrome's WGSL compiler and prints its errors. Chrome rejects some code that Firefox and the generator accept, such as an unparenthesized `a && b || c`, so run it after you edit a `.wgsl` file. It needs Chrome with WebGPU, and the `CHROME` environment variable names the browser binary when it sits elsewhere than the macOS default path.

The later examples on this page show only the pass, and `shader` stands for the {@link postShader} result from the previous example.

### Texture coordinates

Take the texture coordinate from `a_uv`. The pipeline uploads the fullscreen triangle with `a_uv` already flipped where the device needs it, so a shader that reads `a_uv` shows the frame upright on WebGPU and WebGL2.

A pass with a direction or an off-center point reads `ctx.uvYDown` in `writeParams`. It is `true` when `a_uv.y` grows downward on screen (WebGPU) and `false` when it grows upward (WebGL2).

```ts
import type { PostPass } from '@julianagaibler/stargazer'

const angle = 0.5 // radians, counter-clockwise on screen

const streak: PostPass = {
  shader,
  paramsBytes: 16,
  writeParams: (ctx, out) => {
    out[0] = Math.cos(angle)
    out[1] = ctx.uvYDown ? -Math.sin(angle) : Math.sin(angle)
  },
}
```

The direction then points the same way on screen on both backends. An effect that is symmetric around the center, such as a vignette, can ignore `uvYDown`.

### The params block

{@link PostPassContext} is the `ctx` that `writeParams` receives. It has the size of the target the pass draws into (`width`, `height`, `texelW`, `texelH`), the same values for the texture it reads (`inputWidth` and the rest), `time` and `dt` in seconds, `uvYDown`, and `source`, which [Placement](#placement) describes.

```ts
const spread = 1.5

const soften: PostPass = {
  shader,
  paramsBytes: 16,
  writeParams: (ctx, out) => {
    out[0] = ctx.texelW * spread // one texel of the target, scaled
    out[1] = ctx.texelH * spread
    out[2] = ctx.time
  },
}
```

Give a `Params` block `vec4<f32>` members. Under std140 (what the generated GLSL uses) and WGSL's uniform rules, `f32`, `vec2<f32>` and `vec3<f32>` take the same space, but larger types such as `mat2x2<f32>` take different sizes. WebGPU reports nothing when the layouts disagree, and the shader reads wrong values. Pack smaller values into the unused components of a `vec4`.

### Pass size

A pass renders at the frame's full size. Set [`scale`](/module/render/postpass#scale) to render at a fraction of it.

```ts
const half: PostPass = {
  shader,
  paramsBytes: 0,
  scale: 0.5, // half the frame's width and height
}
```

The target is `max(1, floor(frameSize * scale))` pixels on each axis. The fraction applies to the frame the pipeline was given, so a chain can ask for an exact fraction at every level and the rounding errors stay at one pixel. `DualKawaseBlur` is the reference: its down passes shrink and its up passes grow back to `scale: 1`. `ctx.inputWidth` and `ctx.inputHeight` differ from `width` and `height` where `scale` changes the size.

### Exact sizes and extra inputs

[`size`](/module/render/postpass#size) gives a pass an exact target size in device pixels and takes precedence over `scale`. It runs every frame with the chain's source, so the size can follow a parameter. This pass reduces the frame to one texel per cell of a grid:

```ts
const cellPx = 8

const cells: PostPass = {
  shader,
  paramsBytes: 0,
  size: (source) => ({
    width: Math.ceil(source.width / cellPx),
    height: Math.ceil(source.height / cellPx),
  }),
}
```

A pass reads the previous pass's output at `u_tex`. Set [`input`](/module/render/postpass#input) to `'source'` to read the texture the chain started from, or to an earlier pass to read that pass's output.

[`textures`](/module/render/postpass#textures) binds up to four more textures at bindings 1 to 4. The shader samples them as `u_tex1` to `u_tex4`, and each sampler sits at the binding plus 16.

```ts
import { DataTexture } from '@julianagaibler/stargazer'

const table = new DataTexture(256, 1)
table.data[0] = 255 // write texels, then mark the texture as changed
table.markDirty()

const grade: PostPass = {
  shader,
  paramsBytes: 0,
  textures: [table, 'source'], // u_tex1 is the table, u_tex2 the chain's source
}
```

An entry is a {@link DataTexture}, `'source'`, or an earlier pass. A `DataTexture` uploads when its version changes, so a lookup table or a noise tile costs one upload. The output of an earlier pass stays alive until the pass that reads it has drawn. A pass that reads a pass that runs later throws when the effect is prepared.

### Placement

`ctx.source` tells a pass where the chain's source sits, as a {@link PostSourceInfo}. Use it for a pattern that keeps its size on every screen or stays put under moving content.

```ts
const dotSize = 6 // in the owner's units

const dots: PostPass = {
  shader,
  paramsBytes: 16,
  writeParams: (ctx, out) => {
    const { pxPerUnit, unitOriginX, unitOriginY } = ctx.source
    out[0] = dotSize * pxPerUnit // the dots keep their size in units
    out[1] = unitOriginX // the pattern starts at the owner's origin
    out[2] = unitOriginY
  },
}
```

`pxPerUnit` is the number of device pixels in one unit of the owner's local space. A layer's unit is a unit of its own space, so a layer with a 1920 by 1080 frame has the same unit on every screen. The stage's pipeline counts CSS pixels. `unitOriginX` and `unitOriginY` are where the owner's origin falls on the source, in device pixels from its top-left corner. A pattern that starts there stays put when a `'content'` region changes size and corner as its content changes. The values go through `writeParams`, so a cached layer renders again when they change.

### Passes that make data

Some work needs more than one fragment per pixel, such as an algorithm that visits the pixels in order. A {@link PostDataPass} makes a texture from its input instead of drawing one. Later passes read the texture through their `textures`, and it keeps its contents between frames.

```ts
import type { PostDataPass } from '@julianagaibler/stargazer'

const prefixSums: PostDataPass = {
  kind: 'data',
  size: (source) => ({ width: source.width / 8, height: source.height / 8 }),
  paramsBytes: 16,
  writeParams: (ctx, out) => {
    out[0] = ctx.width
  },
  compute: { wgsl: sumsWgsl, workgroups: (ctx) => [1, ctx.height, 1] },
  cpu: (input, output, ctx) => sumRows(input, output, ctx),
}
```

Give the pass a `compute` shader for devices that have compute and a `cpu` function for the rest. The chain picks by `device.supportsCompute`. The compute shader runs every frame. The `cpu` function receives the input's pixels and fills the output's, and the result lands a few frames after the input first draws, with an all-zero texture until then. The TSDoc of {@link PostDataPass} describes both routes, including when `cpu` runs again and how a cached layer reacts.

Rows in the input and output are in the texture's own order, and `ctx.uvYDown` is `true` when row 0 is the top. End every effect with a drawing pass, because a data pass has no target to hand back.

### Color in a shader

A shader receives the frame as premultiplied, display-space (gamma) color, the same bytes the canvas shows. Work in that color space as it arrives. Multiplying by a scalar, or summing samples whose weights add up to 1, keeps premultiplied color valid.

If you offset channels separately, as `ChromaticAberration` does, keep the output alpha greater than or equal to each color channel. A color channel greater than the alpha fringes brightly at transparent edges when the canvas is composited over the page.

### Effects that smooth their input

Set [`smoothsInput`](/module/render/posteffect#smoothsinput) to `true` on an effect that removes the fine detail of its input, as a blur does. `DualKawaseBlur` sets it.

```ts
class Haze implements PostEffect {
  enabled = true
  readonly smoothsInput = true
  readonly passes: readonly PostPass[] = [hazePass]
}
```

A layer whose first enabled effect sets `smoothsInput` draws into a single-sample surface. That saves the memory and bandwidth of a multisampled surface, and the effect removes the edges that multisampling would have smoothed. Leave the flag unset for an effect whose output keeps edges, such as a color grade or grain, so those edges keep their antialiasing. The flag applies to layers. `engine.postProcess` reads the already resolved frame and ignores it.

The first frame that wants a single-sample surface starts compiling single-sample pipelines for every 2D program. The layer draws multisampled until they are ready.

### Layer regions

The `region`, `padding` and `clearColor` options of a layer decide what its effects run over:

```ts
const backdrop = new Layer({
  region: 'view', // the whole canvas, for a background that fills the screen
  padding: 16, // CSS pixels added on every side of the region
  clearColor: '#0d1a2c', // fills the region before the layer draws
  effects: [new DualKawaseBlur()],
})
```

The default region is `'content'`, the box around what the layer draws. A `Rect` picks an area in the layer's own space. {@link LayerOptions} describes each option. The surface has exactly the size of the region, so an effect sees the region and not the canvas, and a blur's levels, or an effect that positions things by the width of its input, are relative to the region. Padding matters for an effect that spreads past what was drawn, because the effect reads only the region. A blur at the region's edge repeats the edge pixels.

A layer inside another layer is processed first, and the outer layer then processes the result.

[`effectsApplied`](/module/scene/layer#effectsapplied) reports whether the last frame drew the subtree with every effect. It is `false` while an effect's pipelines are compiling, and `warm()` shortens that time. A layer that is hidden for a few seconds loses its pipelines and compiles them again when it shows. A layer whose unprocessed picture would look wrong, such as an opaque `clearColor` that the effects turn into dots, sets `holdUntilEffects` to draw nothing for those frames. Effects cover layers that have no {@link InsetViewNode} in their subtree or above them, and `effectsApplied` is `false` for the others. The engine warns once in development.

A layer with effects renders its surface and runs its passes every frame it is drawn, unless it keeps its result. The cost is the surface plus one fullscreen pass per effect pass, at the region's size.

### Keep a layer's result

A layer whose content rarely changes can keep what it rendered. With `cache: 'raster'`, the layer stores the processed result in a target of its own and draws it again as one textured quad while nothing has changed.

```ts
import { DualKawaseBlur, FilmGrain, Layer } from '@julianagaibler/stargazer'

const backdrop = new Layer({
  space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
  region: 'view',
  cache: 'raster',
  effects: [new DualKawaseBlur({ levels: 6 }), new FilmGrain({ hz: 0 })],
})
```

The backdrop blurs its subtree once and then costs one quad per frame. The layer renders again when a node under it moves, changes visibility or alpha, repaints, is added, removed or reordered, or changes how it composites or clips. It also renders again when an effect's parameters change (grain with `hz` greater than 0 changes at its own rate), when an effect is enabled, disabled or swapped, and when the canvas, the layer's view, its region or its padding changes. Under a `'world'` layer that includes a camera pan or zoom, while a `'screen'` or frame layer keeps its result when the camera moves. Call [`invalidate()`](/module/scene/layer#invalidate) for a change that the layer's tracking misses.

The layer applies its own `alpha` when it draws the kept result, so fading a cached layer reuses the kept result. A node that draws immediately with `draw` instead of `paint`, a matte, and a nested layer with effects each make a cached layer render every frame, and the engine warns once in development. The engine releases a kept result when the layer goes unused for a while, and past the cache's memory budget the least recently used go first. The debug HUD lists them as "Layer renders", with how many layers drew from a kept result in the last frame.

### How the pipeline runs

When at least one effect is enabled, the stage draws the frame into its offscreen target instead of presenting it. The pipeline resolves that target (multisampled to a single-sample texture you can sample) and runs each pass as a fullscreen draw. The passes alternate between two pooled targets, and when the frame is drawn in the canvas format and the last pass renders at full size, that pass draws into the canvas directly.

Passes run with depth and blending off. Each pass overwrites every pixel of its target, which is also correct for premultiplied color. GPU resources build on first use and rebuild after a context loss.

A device-wide cache holds each pass's compiled shader and pipelines, so a pass used in several places compiles once. Each owner (the stage's pipeline and every layer with effects) runs the passes in its own chain. A chain owns each pass's params buffer, its own `time`, and the change detection for kept results. Two chains that run the same effect in one frame therefore write separate buffers, which matters on WebGPU, where only the last write to a buffer before a submit takes effect.

Fog belongs to the 3D pass. The 3D shaders apply it per fragment, because it needs each surface's depth and has to mix with the depth-sorted transparent draws. See [Fog](/guides/3d#fog).

### Cost

Each pass is one fullscreen draw. Most built-in effects run one or two passes at full size. `DualKawaseBlur` runs `2 * levels` passes, most of them at a fraction of the frame size, as [this write-up](https://blog.frost.kiwi/dual-kawase/#dual-kawase-blur) describes. The render target pool is keyed by size and frees a size it stops seeing, and a pass that no effect lists for a while releases its compiled pipelines.

The dev demo `?demo=postfx` runs a blur and grain on the stage and a blur on a layer.

## Common problems

**The frame shows no effect for the first moments.** The effect's pipelines are compiling and the stage presents the frame unmodified. Call `warm()` on the pipeline or the layer while a load screen or a transition hides the compile.

**A custom effect draws the frame upside down.** The shader computes its uv from the clip position. Read `a_uv` instead.

**A custom effect gets wrong parameter values on one backend.** The `Params` block uses a type that std140 and WGSL lay out differently. Use `vec4<f32>` members.

**A layer's edges look jagged after an effect that keeps edges.** The effect sets `smoothsInput`, so the layer draws single-sample. Leave the flag unset for effects such as a color grade.

## See also

- {@link PostProcessPipeline}: the stage's list of effects
- {@link PostEffect}: the interface a custom effect implements
- {@link PostPass}: one fullscreen pass and its params
- {@link postShader}: wraps a pass's generated shader files
- {@link Layer}: effects on a subtree
- {@link DualKawaseBlur}: the downsample blur
- [Scene graph](/guides/scene): layers and the tree
- [3D](/guides/3d): fog and the 3D pass
- [Ambient occlusion](/guides/ambient-occlusion): screen-space shading inside the 3D pass
