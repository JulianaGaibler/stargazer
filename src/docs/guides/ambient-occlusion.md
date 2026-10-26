---
title: Ambient occlusion
group: 3D
order: 22
---

# Ambient occlusion

Ambient occlusion (AO) darkens the places that light has trouble reaching: the crease where a wall meets the floor, or the seam where one object rests on another. Stargazer estimates it in screen space each frame from the depth and normals of the 3D pass, so it works on any geometry, including glTF models, with no baking. This page shows how to turn AO on, tune its look and cost, and fix the common problems.

AO applies to the 3D pass, so you need a 3D scene with a camera first. See [3D](/guides/3d). The primary stage's {@link AmbientOcclusion} controller is [`engine.ambientOcclusion`](/module/engine/engine#ambientocclusion), and a secondary stage's is [`stage.ambientOcclusion`](/module/render/stage#ambientocclusion).

## Basic usage

Turn AO on for the primary stage:

```ts
engine.ambientOcclusion.enabled = true
```

From the next frame, lit flat meshes and PBR meshes darken in their creases and contact seams. The stage creates the controller on first access and runs the AO passes while `enabled` is `true`. AO is off by default.

### Pick a preset

A preset sets the sample budget and a default strength. Higher presets show finer contact detail and cost more:

```ts
engine.ambientOcclusion.preset = 'high'
```

The default is `'medium'`. {@link AoPreset} lists the presets with their sample counts and default strengths.

### Render at half resolution

At half resolution, the AO passes run at half the width and height, about a quarter of the cost:

```ts
engine.ambientOcclusion.resolution = 'half'
```

The mesh pass stretches the result over the full frame. Occlusion is soft, so most scenes look close to full resolution. On a high-density display the pixel count sets most of the cost, so this setting saves more than a lower preset. The default is `'full'`, and {@link AoResolution} lists both values.

### Tune the look

Three fields change the look of the current preset. You can set them at any time:

```ts
const ao = engine.ambientOcclusion
ao.intensity = 4 // strength of the darkening
ao.radius = 0.6 // how far a surface looks for occluders, in world units
ao.directStrength = 0.5 // how much AO also dims direct light, 0 to 1
```

Creases darken more, and the darkening also reaches surfaces under direct light. `intensity` and `radius` override the preset's values until you set them again. Raise `intensity` until creases read, and lower it when the darkening looks smudged. A stylized look can push it much higher than the presets do.

A small `radius` catches tight contact seams. A large one also darkens broad hollows, with less precision.

## Advanced usage

The sections that follow cover how AO combines with lighting, what it costs, how the engine lowers it on a slow GPU, and how to fix common problems.

### Direct light

`directStrength` (`0` to `1`, default `0`) decides whether AO also dims direct light. At `0`, AO scales only the ambient light. That matches how light behaves, and a crevice under a bright direct light stays bright, so AO can be hard to see on well-lit ground.

```ts
engine.ambientOcclusion.directStrength = 0.6
```

Creases now darken under direct light as well. `directStrength` applies AO to the diffuse part of direct light, and specular highlights keep their brightness. Treat it as an artistic setting.

The ambient light is a small constant, because the engine has no image-based lighting. A scene lit mostly by direct light shows AO faintly until you raise `intensity` or `directStrength`.

### What receives AO

The PBR shader takes the darker of the screen-space AO and the material's `occlusionTex`, and applies it to the ambient light. Emissive light is added after AO and keeps its brightness. Lit flat meshes receive AO. Unlit meshes show their color unchanged.

Opaque and alpha-`MASK` meshes write the depth and normals that AO reads. A `MASK` mesh writes its whole geometry, cutout included. A `BLEND` mesh samples the AO texture at its pixels, so it shows the occlusion of the opaque surface behind it.

### Cost

AO adds three steps to every frame, all at the AO resolution:

1. A depth and normal prepass over the opaque meshes.
2. A horizon scan that estimates occlusion.
3. A two-pass blur that follows depth edges.

On WebGPU the scan and the blur run as compute dispatches. On WebGL2 they run as fullscreen fragment passes. Both use the same math. The preset's sample budget and the resolution are the settings that change the cost. Drop to `'low'`, or to `'half'` on a dense display, when AO shows up in a frame budget.

The controller allocates its targets on the first frame after you enable it and frees them when you disable it. The targets follow the stage size.

### Automatic quality

When the GPU falls behind, the engine lowers quality one step at a time, and AO is part of that order. It lowers AO to half resolution first, then to the `'low'` preset, and turns AO off later in the order. Each change sets the fields on this controller and emits `qualitychange`. {@link RenderQuality} lists the steps in order. Set `quality: { adaptive: false }` to keep the settings you chose. See [Engine setup](/guides/setup).

### How it runs

The stage runs AO before the frame opens, in the same window as the shadow prepass. The mesh shaders then sample the blurred result while they shade each fragment in the main pass. The 2D content drawn over the 3D pass keeps its colors, because AO is applied inside the mesh shaders.

The debug HUD's Quality panel sets the preset, resolution, `intensity`, `radius` and `directStrength` live. Its Rendering panel has a render mode, "3D ambient occlusion (raw)", that shows the AO texture. The dev demo `?demo=ao` shows AO on a test scene. See [Debugging](/guides/debugging).

### Common problems

Fast camera motion shimmers slightly. Each frame's AO is computed on its own and cleaned up by a spatial blur, with no reuse of earlier frames.

A foreground mesh over a distant background shows a soft dark fringe a pixel or two wide at its outline. At `resolution = 'half'` the stretch to full size is a plain linear filter that ignores depth. Set `resolution` to `'full'` to remove the fringe.

A foreground mesh shows a faint dark rim at its outline. The AO texture has a single sample while the main pass can use MSAA. AO is soft and blurred, so the rim is usually hard to see.

## See also

- {@link AmbientOcclusion}: the per-stage AO controller
- {@link AoPreset}: the sample budget presets
- {@link AoResolution}: full or half resolution
- {@link MeshMaterial}: `occlusionTex` and the other material inputs
- [3D](/guides/3d): meshes, lights and the 3D pass
- [Engine setup](/guides/setup): automatic quality reduction
- [Debugging](/guides/debugging): the Quality and Rendering panels
