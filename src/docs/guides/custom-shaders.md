---
title: Custom shaders
group: Features
order: 14
---

# Custom shaders

[`canvas.drawShaderQuad(quad, x, y, w, h)`](/module/scene/canvas#drawshaderquad) draws a rectangle with your own fragment shader. Use it when one shader can stand in for many shapes, such as a field of dots or a procedural fill, because one draw record replaces a draw record per shape. This page writes a shader, draws it from a custom node, and feeds it data that changes every frame.

You need a custom node that overrides `paint`. See [Drawing](/guides/drawing).

## Basic usage

A shader quad has three parts: a shader module written in WGSL, a {@link ShaderQuad} that holds its parameters and textures, and a draw call in `paint`.

### Write the shader

Write one WGSL module with `vs_main` and `fs_main`. This one draws a grid of circular dots and reads each dot's color from a texture.

```text
struct Frame {
  proj: mat3x3<f32>,
  targetH: f32,
  fragYFlip: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;

// #include "include/clipUniform.inc.wgsl"

struct Params {
  cols: f32,
  rows: f32,
  radius: f32,
  pad: f32,
};
@group(1) @binding(10) var<uniform> params: Params;
@group(1) @binding(0) var cells: texture_2d<f32>;
@group(1) @binding(16) var cellsSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) alpha: f32,
};

@vertex
fn vs_main(
  @location(0) a_unit: vec2<f32>,
  @location(1) a_originAxisX: vec4<f32>,
  @location(2) a_axisYAlpha: vec4<f32>,
) -> VOut {
  let origin = a_originAxisX.xy;
  let axisX = a_originAxisX.zw;
  let axisY = a_axisYAlpha.xy;
  let pos = origin + axisX * a_unit.x + axisY * a_unit.y;
  let clip = frame.proj * vec3<f32>(pos, 1.0);
  var out: VOut;
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  out.uv = a_unit;
  out.alpha = a_axisYAlpha.z;
  return out;
}
```

The vertex shader places each corner of the quad in device pixels from the origin and the two edge vectors, projects it with `frame.proj`, and passes the corner's `0..1` position on as the UV. The draw's alpha arrives with the vertex data. The `Frame` struct, the group and binding numbers, and the three vertex inputs are the same for every shader quad. The `Params` block sits at group 1 binding 10, each texture at its own binding from 0 to 3, and the texture's sampler at the texture's binding plus 16. The remarks on {@link quadShader} list the contract.

The fragment shader decides every pixel.

```text
@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let grid = vec2<f32>(params.cols, params.rows);
  let cell = floor(in.uv * grid);
  let color = textureSample(cells, cellsSamp, (cell + 0.5) / grid).rgb;
  let offset = fract(in.uv * grid) - 0.5;
  let edge = 1.0 - smoothstep(params.radius - 0.05, params.radius, length(offset));
  let coverage = edge * in.alpha * clipCoverage(in.pos.xy);
  return vec4<f32>(color * coverage, coverage);
}
```

Each pixel finds its grid cell, reads that cell's color, and fades out toward the edge of a circle. The result is premultiplied and scaled by the draw's alpha and by `clipCoverage`, which applies a `setClip` shape. Run `npm run gen:shaders` to generate the GLSL for WebGL2 and the reflection file beside the module. The generator builds with `cargo`. A module that uses includes also gets a `.gen.wgsl` file with the includes pasted in, and that file is the WGSL to pass to the engine.

### Draw the quad

`quadShader` bundles the generated files. A {@link DataTexture} holds the colors, and `paramsBytes` is the size of the `Params` block.

```ts
import {
  DataTexture,
  Node2D,
  ShaderQuad,
  quadShader,
} from '@julianagaibler/stargazer'
import type { Canvas } from '@julianagaibler/stargazer'
import vert from './dotField.gen.vert.glsl?raw'
import frag from './dotField.gen.frag.glsl?raw'
import wgsl from './dotField.gen.wgsl?raw'
import reflection from './dotField.reflect.json'

const COLS = 48
const ROWS = 27

const cells = new DataTexture(COLS, ROWS)
const quad = new ShaderQuad({
  shader: quadShader(vert, frag, wgsl, reflection),
  paramsBytes: 16,
  textures: [cells],
})
quad.params.set([COLS, ROWS, 0.35])

class DotField extends Node2D {
  override paint(canvas: Canvas): void {
    canvas.drawShaderQuad(quad, 0, 0, 1920, 1080)
  }
}
```

The field covers the 1920 by 1080 world with 48 by 27 circular dots. One draw replaces 1296 shapes. The dots are black until you write colors into `cells`, because a new `DataTexture` starts black. The first frames show nothing, because a quad draws once its pipelines finish compiling.

### Change params and texels every frame

`quad.params` is a live `Float32Array` over the `Params` block. A `DataTexture` exposes its texels as `data`, in RGBA bytes with texel `(x, y)` at byte `(y * width + x) * 4`. Call `markDirty()` after writing, and the texture uploads on the next draw that binds it.

```ts
import { Node2D } from '@julianagaibler/stargazer'
import type { Canvas } from '@julianagaibler/stargazer'

class PulsingField extends Node2D {
  #time = 0

  override paint(canvas: Canvas): void {
    canvas.drawShaderQuad(quad, 0, 0, 1920, 1080)
  }

  override onUpdate(dt: number): void {
    this.#time += dt
    quad.params[2] = 0.3 + 0.1 * Math.sin(this.#time * 2)
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = (row * COLS + col) * 4
        cells.data[i] = 128 + 127 * Math.sin(this.#time + col * 0.3)
        cells.data[i + 1] = 128 + 127 * Math.sin(this.#time + row * 0.3)
        cells.data[i + 2] = 200
      }
    }
    cells.markDirty()
  }
}
```

The dots change color across the grid and breathe in size. The picture holds the quad by reference. Each replay draws it with the params and texture contents as they are at that moment, so writing them leaves the node's picture as it is. Leave the alpha byte of a texel at 255 unless the shader reads it, because the upload can lose the color channels of a texel with a lower alpha.

## Advanced usage

These sections cover how a shader quad combines with the transform, clips and blend, how textures are ordered, and its limits.

### Combine a quad with transform, alpha, blend and clips

The current transform, rotation included, applies to the quad, and so do `setAlpha`, `setBlend`, `setClip` and `clipPath`.

```ts
canvas.save()
canvas.translate(960, 540)
canvas.rotate(Math.PI / 12)
canvas.setAlpha(0.8)
canvas.drawShaderQuad(quad, -400, -300, 800, 600)
canvas.restore()
```

An 800 by 600 field turns 15 degrees around the middle of the world at 80 percent alpha. For a bitmap outline, sample the bitmap in the shader. A quad drawn under `setClipMask` logs a diagnostic.

### Draw one quad several times

Each draw takes a snapshot of `params`, so one quad drawn twice with different values in between draws both with their own values. A `DataTexture` is shared by every draw that samples it. Those draws all see the contents as they were when the last of them was recorded, so write a texture once per frame, before drawing with it.

### Stay within the limits

A `ShaderQuad` takes up to 4 textures and 256 bytes of params. `paramsBytes` rounds up to a multiple of 16, and the `Params` block in the shader uses the same layout. The constructor throws when a quad asks for more.

## Next step

Keep a frame cheap while a field of shapes grows in [Rendering performance](/guides/performance).

## See also

- {@link ShaderQuad}: the shader, params and textures of one quad
- {@link DataTexture}: texels that code owns and a shader samples
- {@link quadShader}: bundles the generated files and lists the binding contract
- [Drawing](/guides/drawing): `paint`, clips and blend modes
- [Rendering performance](/guides/performance): batches and what breaks them
