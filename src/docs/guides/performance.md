---
title: Rendering performance
group: Features
order: 11
---

# Rendering performance

When a picture replays, the renderer appends its draws to per-program buffers, and at the end of the frame it submits them in painter order. A program is one of the renderer's built-in draw types, such as shapes and text, strokes or path fills. Draws that follow each other with the same program, texture and blend mode form one batch, and a long batch costs one draw call. This page shows how to keep batches long, what the renderer keeps on the GPU between frames, and how to read the cost in the debug HUD.

The examples use custom nodes. See [Drawing](/guides/drawing) for how a node records a picture.

## Basic usage

Each habit in this part keeps batches long. A change of program, texture or blend mode starts a new batch. Alpha, color and transform stay inside a batch, because the renderer stores them per instance.

### Fade with alpha

A node's `alpha` and `setAlpha` are stored per instance, so a fade replays the picture and repaints nothing.

```ts
import { Node2D } from 'stargazer'
import type { Canvas } from 'stargazer'

const TILE = '#2a3550'

class Board extends Node2D {
  override paint(canvas: Canvas): void {
    for (let row = 0; row < 20; row++) {
      for (let col = 0; col < 30; col++) {
        canvas.fillRoundRect(col * 36, row * 36, 32, 32, 6, TILE)
      }
    }
  }
}

const board = new Board()
scene.root.add(board)
board.play({ alpha: 0.4 }, { duration: 0.3 })
```

The board draws 600 tiles with one color string and fades to 40 percent over 0.3 seconds. The tiles share one batch for the whole fade. Writing a new color string repaints the node, and for text it rasterizes the label again.

### Build colors once

{@link mixColor} and {@link withAlpha} return new strings. Call them once at module load, and pass the same strings to every draw.

```ts
import { Node2D, definePaintProps, mixColor } from 'stargazer'
import type { Canvas } from 'stargazer'

const BACKGROUND = '#0d1a2c'
const INK = '#ffd34d'
const DIM = mixColor(BACKGROUND, INK, 0.4)

class Dots extends Node2D {
  declare lit: number
  readonly xs = new Float32Array(100)

  constructor() {
    super()
    definePaintProps(this, { lit: 0 })
  }

  override paint(canvas: Canvas): void {
    for (let i = 0; i < this.xs.length; i++) {
      canvas.fillCircle(this.xs[i], 40, 6, DIM)
      canvas.setAlpha(this.lit)
      canvas.fillCircle(this.xs[i], 40, 6, INK)
      canvas.setAlpha(1)
    }
  }
}
```

The dots cross-fade from dim to yellow as `lit` goes from 0 to 1. Each dot draws the old color first and the new color over it at the alpha `lit`, so no color string is built while the value changes.

### Draw overlapping translucent parts as one color

A translucent shape drawn as two overlapping parts, such as a plus sign made of two bars, blends twice where the parts overlap and reads as a dark patch. Mix the color once into an opaque color that looks the same.

```ts
import { Node2D, mixColor } from 'stargazer'
import type { Canvas } from 'stargazer'

const PLUS = mixColor('#0d1a2c', '#ffd34d', 0.5)

class Plus extends Node2D {
  override paint(canvas: Canvas): void {
    canvas.fillRect(-30, -8, 60, 16, PLUS)
    canvas.fillRect(-8, -30, 16, 60, PLUS)
  }
}
```

The plus sign looks like the yellow at 50 percent over the dark blue background, with an even color in the middle. To animate such a shape in, scale its node. A fade would reveal the overlap again.

### Group images by texture

Each switch between images from different sources starts a new batch. Draw all the images of one source, then all the images of the next.

```ts
import { Node2D } from 'stargazer'
import type { Canvas } from 'stargazer'

declare const grass: ImageBitmap
declare const treeImage: ImageBitmap

class Forest extends Node2D {
  readonly tiles: { x: number; y: number }[] = []
  readonly trees: { x: number; y: number }[] = []

  override paint(canvas: Canvas): void {
    for (const tile of this.tiles) {
      canvas.drawImage(grass, tile.x, tile.y, 32, 32)
    }
    for (const tree of this.trees) {
      canvas.drawImage(treeImage, tree.x, tree.y, 32, 48)
    }
  }
}
```

The two loops make two batches, where alternating tiles and trees would make one batch per switch. Text, small images and atlas sprites use fixed texture units, so they interleave with each other and with shapes in one batch.

### Read the cost in the debug HUD

The debug HUD shows what a frame costs. Open it with `?debug=hud` in the page's address, or with the `debug` option of {@link EngineHostOptions}.

```ts
import { createEngineHost } from 'stargazer'

const host = createEngineHost({ canvas, debug: 'hud' })
```

The HUD opens on boot. Its Rendering panel shows draw calls, repaints, upload bytes per frame, and the Batching section with program switches, texture binds, blend switches, merged runs and uniform slices. A draw-call count that grows with the number of objects means batches are breaking. Per-object colors, interleaved textures and clip changes inside a loop are the usual causes.

The tooltip on the Uploaded card breaks the upload down by program. The Caches section lists the pictures that send the most bytes every frame. A picture that uploads kilobytes every frame while it looks still is worth a look. The Textures section shows the atlas and the label page. A label page reset means the page filled and was cleared, which rasterizes every label again in one frame. That is the most expensive thing the text cache does.

`?debug=perf` also wraps each node's update and draw in `performance` marks, so the browser profiler shows a per-node timeline. [`Engine.lastFrameWorkSec`](/module/engine/engine#lastframeworksec) is the CPU work inside the frame, not the time between frames. See [Debugging](/guides/debugging).

## Advanced usage

These sections cover what breaks a batch beyond the habits, what the renderer keeps between frames, and what stops it from keeping content.

### Know what else ends a batch

The renderer merges runs of the same program and state when no draw between them overlaps them, so interleaving programs leaves their draws batched. A clip is part of the state. Shapes, text and path fills store the clip as an index per primitive, so changing the clip leaves their batch intact. Strokes, gradient programs, shader quads and path shadows start a new batch when the clip changes. Draw strokes that share a clip together.

The buffers grow when a frame needs more room and shrink after they sit mostly empty for a while. A scene with thousands of separate runs pays in upload bytes and uniform slices, which the HUD shows.

A translucent stroke with several segments paints each pixel once, through the stencil buffer, so a dashed translucent polyline shows no beads at its joins. An outline-rendered border is one filled shape and needs no such step. See [Combined depth and stencil](/combined-depth-stencil) for the stencil bits.

### Let the renderer keep content

A picture at rest is replayed every frame. The renderer keeps on the GPU what it builds from the picture, so a still scene uploads little per frame. Something is kept once it is drawn the same way on two frames in a row, and only where keeping it costs no extra draw call.

```ts
import { Node2D } from 'stargazer'
import type { Canvas } from 'stargazer'

class Coastline extends Node2D {
  readonly points = new Float32Array(2 * 2000)

  override paint(canvas: Canvas): void {
    canvas.strokePolyline(this.points, 2000, {
      color: '#7cc4ff',
      width: { screen: 2 },
    })
  }
}
```

The coastline stroke has 2000 segments. While the node rests, the renderer keeps the stroke on the GPU, and each frame draws it with one call and uploads nothing. Long strokes, the tessellation of a large registered `Path2D`, the filled shape of a `strokePath` with a gradient or `exactJoins`, the outline of a registered `Path2D` stroke, the flattened form of a `GfxPath`, text, small images and path shadow masks are kept. The thresholds are documented on {@link registerPathTessellation} and in the renderer source. A flat fill, or a gradient fill that shares its gradient with another fill, draws in one call with its neighbors and needs no keeping. Kept content is freed when it goes undrawn for a while or when its cache passes its memory budget, and is built again on its next draw.

Paths whose bounding boxes sit apart share draws. Paths that overlap draw in order, each with its own passes.

### Know what rebuilds kept content

These actions free or rebuild kept content, and the Caches section of the HUD shows their effect.

Repainting frees what was kept for the old recording. A kept stroke is held in device pixels with the alpha it was drawn at, so a node that moves, scales, rotates or fades every frame builds its strokes again each frame, even when its picture rests. Dashes are cut again on every draw. Editing a `GfxPath` every frame rebuilds its kept forms.

Content that changes on every frame suits [immediate drawing](/guides/drawing#draw-immediately-with-draw), which records nothing.

## Next step

Draw a field of shapes with one draw call in [Custom shaders](/guides/custom-shaders).

## See also

- [Drawing](/guides/drawing): pictures, `paint` and the draw commands
- [Debugging](/guides/debugging): the debug HUD, performance marks and draw modes
- [Text](/guides/text): the label cache that text and small images share
- {@link Canvas}: the recorder a node's `paint` draws into
- {@link mixColor}, {@link withAlpha}: color helpers that return new strings
- [Combined depth and stencil](/combined-depth-stencil): the stencil bit layout
