---
title: Drawing
group: Getting started
order: 5
---

# Drawing

Stargazer draws a scene made of nodes. A built-in node such as {@link ShapeNode} or {@link TextNode} describes what to show through options. When no built-in node fits, you write a custom node that overrides `paint` and records draw commands on a {@link Canvas}. This page draws one card both ways, then covers fills, strokes, text, images, clips, shadows and gradients. Afterwards you can pick the right kind of node for a picture and draw it.

The examples add nodes to `scene.root` and assume a stage with a camera. See [Setup](/guides/setup) for the stage, [Camera](/guides/camera) for the camera and [Scene graph](/guides/scene) for the tree.

## Basic usage

Start with built-in nodes. Write a custom node when one node should draw many things, or when no built-in node draws what you need.

### Draw with built-in nodes

A built-in node takes options and handles bounds, hit testing and stroke scaling. A card is a {@link ShapeNode} with a {@link TextNode} as its child.

```ts
import { ShapeNode, TextNode } from 'stargazer'

const card = new ShapeNode({
  geometry: { kind: 'rect', width: 240, height: 140, radii: 16 },
  fill: '#1c2438',
  stroke: '#ffd34d',
  lineWidth: 2,
})
card.add(
  new TextNode({
    text: 'Ready',
    fontSize: 28,
    fontWeight: 700,
    sizeSpace: 'world',
    color: '#ffffff',
    align: 'center',
    baseline: 'middle',
  }),
)
card.transform.x = 960
card.transform.y = 540
scene.root.add(card)
```

A dark blue rounded rectangle with a 2 pixel yellow border and the word "Ready" at its center appears in the middle of the 1920 by 1080 world. The border stays 2 CSS pixels wide at any camera zoom, because `strokeSpace` is `'screen'` by default. `sizeSpace: 'world'` makes the text scale with the camera, like the rectangle.

### Draw with a custom node

A custom node subclasses {@link Node2D} and overrides `paint`. Declare the values `paint` reads with {@link definePaintProps}, so that writing one repaints the node.

```ts
import { Node2D, definePaintProps } from 'stargazer'
import type { Canvas } from 'stargazer'

class Card extends Node2D {
  declare label: string

  constructor(label: string) {
    super()
    definePaintProps(this, { label })
  }

  override paint(canvas: Canvas): void {
    canvas.fillAndStrokeRoundRect(-120, -70, 240, 140, 16, '#1c2438', {
      color: '#ffd34d',
      width: { screen: 2 },
    })
    canvas.fillText(this.label, 0, 0, {
      font: '700 28px sans-serif',
      color: '#ffffff',
      align: 'center',
      baseline: 'middle',
    })
  }
}

const card = new Card('Ready')
card.transform.x = 960
card.transform.y = 540
scene.root.add(card)
```

The picture is the same as the one from built-in nodes. The engine records the draw commands once into a {@link Picture} and replays it every frame under the node's transform and alpha. Draw commands use the node's own coordinates. The rectangle starts at `(-120, -70)` to center on the node's origin, because `Canvas.fillRect` and its relatives take a top-left corner, while a `ShapeNode` rectangle is centered by default.

Pick built-in nodes for single shapes, text and images. Pick a custom node when one node draws many things, such as a grid, a gauge or a board, because one picture holds all of them.

### Draw on top of a built-in node

A built-in node and a custom node combine. A custom node added as a child of the card draws in the card's local space, so it moves, scales and fades with the card.

```ts
import { Node2D } from 'stargazer'
import type { Canvas } from 'stargazer'

class Badge extends Node2D {
  override paint(canvas: Canvas): void {
    canvas.fillCircle(100, -50, 8, '#ff5a5f')
  }
}

card.add(new Badge())
```

A red dot appears near the top-right corner of the card. To keep the card and the dot in one node, subclass the built-in node and call `super.paint` before your own draw commands.

```ts
import { ShapeNode } from 'stargazer'
import type { Canvas } from 'stargazer'

class ScoreCard extends ShapeNode {
  override paint(canvas: Canvas): void {
    super.paint(canvas)
    canvas.fillCircle(100, -50, 8, '#ff5a5f')
  }
}
```

`ScoreCard` takes the same options as `ShapeNode` and draws the same dot.

### Repaint when state changes

`paint` runs the first time the node is drawn. After that it runs when a paint property changes, including a change made by a tween.

```ts
import { Node2D, definePaintProps } from 'stargazer'
import type { Canvas } from 'stargazer'

class Gauge extends Node2D {
  declare value: number

  constructor() {
    super()
    definePaintProps(this, { value: 0.4 })
  }

  override paint(canvas: Canvas): void {
    canvas.fillRoundRect(0, 0, 200, 24, 12, '#1c2438')
    canvas.fillRoundRect(0, 0, 200 * this.value, 24, 12, '#ffd34d')
  }
}

const gauge = new Gauge()
scene.root.add(gauge)
gauge.value = 0.8
```

The gauge draws a dark track with a yellow bar over 40 percent of it. Writing `gauge.value = 0.8` paints the node again on the next frame. Moving, scaling, rotating or fading the gauge through `transform` replays the picture and leaves `paint` alone.

A node also paints again when a resource declared with [`canvas.use`](/module/scene/canvas#use) changes its `version`, when code calls [`markNeedsPaint()`](/module/scene/node2d#markneedspaint), and when `paint` read the scale or the view and that value changed.

### Fill shapes

Each fill call takes its color as an argument. A color is a CSS color string.

```ts
override paint(canvas: Canvas): void {
  canvas.fillRect(0, 0, 320, 200, '#101522')
  canvas.fillCircle(160, 100, 40, '#7cc4ff')
  canvas.fillRoundRect(20, 20, 80, 32, [8, 8, 0, 0], '#3a2d5c')
}
```

The node draws a dark panel, a light blue circle in its middle and a purple tab with rounded top corners. `fillRoundRect` takes the CSS `border-radius` shorthand: `24`, `[0, 32, 0, 0]` or `[tl, tr, br, bl]`. A radius at or above half the shorter side gives a capsule. Circles and rounded rectangles are drawn as signed distance fields in local space, so they stay crisp at any zoom or rotation. The other fill calls are listed on {@link Canvas}.

### Stroke lines and borders

A stroke takes a full style object on every call. Keep a style that stays the same in a module-level constant.

```ts
import { Node2D } from 'stargazer'
import type { Canvas } from 'stargazer'

const RULE = { color: '#2a3550', width: { screen: 1 } }

class Ruled extends Node2D {
  override paint(canvas: Canvas): void {
    for (let i = 0; i <= 8; i++) {
      canvas.strokeLine(0, i * 40, 320, i * 40, RULE)
    }
  }
}
```

The node draws nine horizontal lines, 1 CSS pixel wide, 40 units apart. A stroke width is a number in the node's local units, or `{ screen: n }` for `n` CSS pixels at any zoom. The renderer resolves a screen width each frame, so the picture stays as it is when the camera zooms. Dash lengths are in local units. The style type is {@link CanvasStrokeStyle}.

A shape with a fill and a border uses one call, so a translucent border blends against the fill once.

```ts
canvas.fillAndStrokeRoundRect(0, 0, 240, 140, 16, '#1c2438', {
  color: 'rgba(255, 211, 77, 0.5)',
  width: { screen: 2 },
})
```

### Draw text and images

`fillText` draws one line of text at a point. See [Text](/guides/text) for `TextNode`, wrapping and measuring. `drawImage` draws an image into a rectangle.

```ts
canvas.fillText('Score', 16, 16, {
  font: '600 24px sans-serif',
  color: '#ffffff',
  baseline: 'top',
})
canvas.drawImage(portrait, 0, 48, 240, 160, { smoothing: false })
```

The label appears at the top-left corner and the image under it. `{ smoothing: false }` selects nearest filtering, for pixel art. Text and small images share one label page. They are rasterized for the scale the node is drawn at when the picture replays, so zooming a node leaves its picture as it is.

An {@link ImageNode} draws a loaded image, such as an `<img>` element, an `ImageBitmap` or a canvas element, as a rectangle.

```ts
import { ImageNode } from 'stargazer'

const logo = new Image()
logo.src = '/logo.png'
await logo.decode()

scene.root.add(new ImageNode({ image: logo, x: 16, y: 16, height: 40 }))
```

The logo is drawn 40 units high at `(16, 16)`, with the width that keeps its proportions. Give both `width` and `height` to stretch it, or neither to draw it at its natural size. Assigning a new `image` shows on the next frame.

### Clip to a shape

[`setClip`](/module/scene/canvas#setclip) crops every following draw to a circle or a rounded rectangle, with an anti-aliased edge. Bracket it with `save` and `restore`.

```ts
canvas.save()
canvas.setClip({ kind: 'roundRect', x: 0, y: 0, w: 240, h: 160, radius: 16 })
canvas.drawImage(portrait, 0, 0, 240, 160)
canvas.restore()
```

The image shows only inside the rounded rectangle. A rounded rectangle clip takes `radii` in place of `radius` for different corners, in the same shorthand as `fillRoundRect`. `setClip(null)` clears the clip, and `restore` does too.

To clip a whole subtree of nodes, set [`clip`](/module/scene/node2d#clip) on the parent node. Setting `clip` repaints nothing.

```ts
panel.clip = { x: 0, y: 0, width: 320, height: 200 }
```

Everything under `panel` is cropped to that rectangle, in the panel's local space.

### Add shadows

A rectangle, rounded rectangle or circle gets an analytic shadow from `shadowRoundRect`, `shadowCircle` or the `shadow` option of {@link ShapeNode}. Draw the shadow first, then the shape.

```ts
canvas.shadowRoundRect(0, 0, 240, 140, 16, {
  color: 'rgba(20, 16, 40, 0.35)',
  offsetY: 8,
  blur: 32,
})
canvas.fillRoundRect(0, 0, 240, 140, 16, '#1c1c22')
```

A soft dark shadow appears under the card. The style is {@link GfxShadowStyle}. `offsetX`, `offsetY`, `blur` and `spread` are lengths in the node's local units. `blur` is the CSS blur radius, and the shadow's Gaussian sigma is half of it. `inset: true` draws the shadow inside the shape, as CSS `box-shadow` does.

`ShapeNode` takes the same style in its `shadow` option and draws in CSS order: outset shadows, the fill, inset shadows, then the border. An outset shadow is cut out from under the shape, so the shadow stays hidden behind a translucent fill. {@link Path2DNode} takes a `shadow` option too, described next.

### Shadows on paths

A path has no closed-form distance, so {@link Path2DNode} draws its shadow from a cached mask. The mask is a small texture of the path's blurred coverage. The engine bakes it once and reuses it every frame.

```ts
import { Path2DNode, parseSvgPaths } from 'stargazer'
import type { Scene } from 'stargazer'

declare const scene: Scene
declare const svgText: string

const { paths } = parseSvgPaths(svgText, { tessellate: true })
const country = paths.get('france')
if (country) {
  scene.root.add(
    new Path2DNode({
      path: country.path,
      fill: '#88c',
      shadow: { color: 'rgba(0, 0, 0, 0.5)', offsetY: 6, blur: 24 },
    }),
  )
}
```

The first frame shows a hard-edged copy of the silhouette under the path. A frame or two later the blurred shadow replaces it. An inset shadow draws nothing until its mask is ready.

Animating `offsetX` and `offsetY` is free, because the mask is placed at the offset when it is drawn. An animated `blur` or `spread` bakes a new mask, and so does a camera zoom that crosses into a new scale bucket. Each bake costs time, so see [Rendering performance](/guides/performance#budget-path-shadow-masks) for the limits.

A `'screen'` blur is a CSS length, so under a zoom its value in local units changes on every frame and every frame bakes again. Set `strokeSpace: 'world'` on a node the camera zooms. The blur then keeps one value, and one mask serves a whole scale bucket.

```ts
import { Path2DNode } from 'stargazer'
import type { Scene } from 'stargazer'

declare const scene: Scene
declare const path: Path2D

scene.root.add(
  new Path2DNode({
    path,
    fill: '#88c',
    strokeSpace: 'world',
    shadow: { color: 'rgba(0, 0, 0, 0.5)', blur: 24 },
  }),
)
```

With `'world'` the shadow grows and shrinks with the path. Use `'screen'` for a shadow on a node the camera keeps at one scale.

To bake the masks for a zoom before the camera gets there, call {@link Stage.warmPathShadows}. Each factor is a multiple of the scale the shadows draw at now. {@link Stage.pendingPathShadowWarmups} counts the masks still waiting to bake.

```ts
import type { EngineHost } from 'stargazer'

declare const host: EngineHost

const stage = host.engine.primaryStage
stage.warmPathShadows([2])
```

The call prepares a camera that is about to zoom to twice its scale. A factor that stays inside the current scale bucket warms nothing. A shadow so small that it draws as a hard silhouette warms nothing either.

### Fill with a gradient

A fill is a CSS color string or a gradient. A linear gradient has an axis from `(x0, y0)` to `(x1, y1)` in the current local space.

```ts
canvas.fillRoundRect(20, 20, 160, 32, 8, {
  kind: 'linear',
  x0: 0,
  y0: 20,
  x1: 0,
  y1: 52,
  stops: [
    { offset: 0, color: '#3a2d5c' },
    { offset: 1, color: '#1d1d2b' },
  ],
})
```

The bar shades from purple at its top to near black at its bottom. A point at the start of the axis reads `stops[0]`, and a point past the far end reads the last stop, as in CSS `linear-gradient`. A gradient works as the `color` of a stroke too. The radial gradient and a builder for CSS angles are in [Use radial and CSS gradients](#use-radial-and-css-gradients).

## Advanced usage

These sections cover the rules `paint` follows, drawing in a changing view, paths, exact borders, smooth corners, clips, groups, layers and pixel snapping.

### Follow the rules for `paint`

`paint` is a function of the node's declared state. It reads declared paint properties and resources declared with `canvas.use`. A node whose content changes every frame, such as a growing bar, calls `markNeedsPaint()` from `onUpdate`.

```ts
import { Node2D } from 'stargazer'
import type { Canvas } from 'stargazer'

class Bar extends Node2D {
  progress = 0

  override onUpdate(dt: number): void {
    this.progress = Math.min(1, this.progress + dt)
    this.markNeedsPaint()
  }

  override paint(canvas: Canvas): void {
    canvas.fillRect(0, 0, 200 * this.progress, 12, '#ffd34d')
  }
}
```

The bar grows over one second. In development the engine paints two clean nodes again each frame and warns when the result differs from the picture it kept. That is how an undeclared dependency of `paint` shows up.

Read the clock, the node's own transform and the camera in `onUpdate`, and store what `paint` needs in a declared property. Call `markNeedsPaint()` from `onUpdate` too, because in development it throws while a node paints. Content that moves or turns on a clock belongs in a small child node whose transform the update writes. [Common problems](#a-picture-lags-the-clock) shows an example.

The `Canvas` copies arguments when it records them, so a scratch array or a style object that the caller reuses can change afterwards while the picture keeps what was recorded. Images and paths are kept by reference. Use the `Canvas` inside `paint`. In development a call after `paint` returns throws.

### Read the scale and the view

[`canvas.screenScale()`](/module/scene/canvas#screenscale) returns the world size of one CSS pixel. Use it for a screen-sized length that is not a stroke width, such as a shadow offset.

```ts
const px = canvas.screenScale()
canvas.shadowRoundRect(0, 0, 240, 140, 16, {
  color: 'rgba(20, 16, 40, 0.35)',
  offsetY: 8 * px,
  blur: 32 * px,
})
```

The shadow keeps its size on screen at any zoom. Reading the scale makes the picture repaint whenever that size changes, so prefer `{ screen: n }` where it fits.

[`canvas.visibleWorldRect()`](/module/scene/canvas#visibleworldrect) returns the world rectangle the camera shows. Reading it makes the picture repaint every time the camera moves, so use it only for a node that draws to the edges of the screen.

```ts
const view = canvas.visibleWorldRect()
canvas.fillRect(view.x, view.y, view.width, view.height, '#0d1a2c')
```

### Transform, fade and blend

`save` and `restore` bracket a change to the transform, alpha, blend or clip. `translate`, `rotate`, `scale` and `transform(a, b, c, d, e, f)` multiply onto the current transform, as in Canvas 2D.

```ts
override paint(canvas: Canvas): void {
  for (const card of this.cards) {
    canvas.save()
    canvas.translate(card.x, card.y)
    canvas.rotate(card.tilt)
    canvas.setAlpha(card.fade)
    this.paintFace(canvas)
    canvas.restore()
  }
}
```

Inside `paint` these calls change the recorded geometry. The engine applies the node's own transform and alpha when it replays the picture.

[`setAlpha`](/module/scene/canvas#setalpha) is relative to the node. It multiplies into the alpha the node gets from its own `transform.alpha` and its ancestors, so a picture drawn at `setAlpha(0.5)` under a node at alpha 0.5 draws at 0.25. Within one picture a later `setAlpha` replaces an earlier one, like `globalAlpha`.

[`setBlend`](/module/scene/canvas#setblend) takes `'source-over'` (the default) or `'lighter'` (additive). Another mode draws as `'source-over'` and logs one warning per mode. Blend modes for a whole node are in [Group, blend and matte nodes](#group-blend-and-matte-nodes).

### Build paths that change

A {@link GfxPath} is a path you build in code and edit at any time. `fillPath` and `strokePath` record it as a dependency, so editing the path repaints the node that drew it.

```ts
import { GfxPath, Node2D } from 'stargazer'
import type { Canvas } from 'stargazer'

const blob = new GfxPath()
blob.moveTo(0, 0)
blob.cubicTo(40, -30, 90, -30, 120, 0)
blob.cubicTo(150, 40, 60, 80, 0, 50)
blob.close()

class Blob extends Node2D {
  override paint(canvas: Canvas): void {
    canvas.fillPath(blob, '#7cc4ff')
    canvas.strokePath(blob, { color: '#ffffff', width: { screen: 3 } })
  }
}
```

The node draws a light blue blob with a white outline. Every edit increases the path's `version`. `clear()` keeps the path's storage, so refilling it every frame allocates nothing. Call `release()` when the path's owner is destroyed.

`fillPath` takes a fill rule, `'nonzero'` (the default) or `'evenodd'`, as in Canvas 2D. A star drawn as one self-crossing outline fills solid under `'nonzero'` and has a hole in the middle under `'evenodd'`. Fills that resolve overlap use the stencil buffer, which the stage's main surface has.

`strokePath` cuts a `dash` pattern of any length, starting `dashOffset` into the pattern, and strokes each dash with the style's caps. With a gradient `color` or `exactJoins: true`, it draws the stroke as one filled shape, so sharp bends keep exact joins. That shape honors `cap`, `join` and `miterLimit`.

### Use radial and CSS gradients

A radial gradient has `kind: 'radial'`, a center, a radius and an optional focal point.

```ts
canvas.fillPath(blob, {
  kind: 'radial',
  cx: 60,
  cy: 60,
  r: 60,
  fx: 45,
  fy: 45,
  stops: [
    { offset: 0, color: '#ffffff' },
    { offset: 1, color: '#2255ff' },
  ],
})
```

Offset 0 is at the focal point and offset 1 is on the circle. A focal point on or outside the circle is pulled just inside. The circle is in the current local space, so under a rotation, a skew or an uneven scale its rings are ellipses, as with a CSS or SVG gradient under the same transform.

A radial gradient works on `fillRect`, `fillPath`, `fillConvexPoly`, `fillPath2D` and a `strokePath` border. `fillRoundRect` and `fillCircle` draw it as its middle stop in one flat color and warn. A gradient stroke on `strokeCircle`, `strokeRoundRect` or the border of a fill-and-stroke call draws in the gradient's first stop.

{@link cssLinearGradient} builds the linear gradient that CSS `linear-gradient(<angle>, ...)` paints over a box, so a design given in CSS carries over directly.

```ts
import { cssLinearGradient } from 'stargazer'

// linear-gradient(75deg, #ffeb49 -30%, #ff6600 120%) on a 330 by 330 box
const fill = cssLinearGradient(330, 330, 75, [
  { offset: -0.3, color: '#ffeb49' },
  { offset: 1.2, color: '#ff6600' },
])
canvas.fillRect(0, 0, 330, 330, fill)
```

The angle follows CSS: `0` runs bottom to top and `90` runs left to right. Offsets are the CSS positions as fractions, and like CSS positions they may lie before `0` or past `1`. Reuse one `stops` array across frames, for example a module-level constant. The renderer then finds the gradient's ramp row instead of building its key from a new array.

### Align borders and join corners exactly

A stroke is centered on its path by default, half inside and half outside. Set `align` to `'inside'` or `'outside'` to move it.

```ts
canvas.strokeRoundRect(0, 0, 240, 140, 16, {
  color: '#1d1d2b',
  width: 3,
  align: 'outside',
})
```

The border sits fully outside the rectangle. On `strokeRoundRect` and `strokeCircle`, alignment offsets the distance field, so it costs nothing extra.

On `strokeLine`, `strokeQuadratic`, `strokePolyline` and `strokePath2D`, three things switch the stroke to the outline renderer: an `align` other than `'center'`, `exactJoins: true` and a gradient `color`. The outline renderer builds the border as one filled shape with exact miter, round or bevel joins and caps. The default renderer draws one piece per segment with round caps and no join geometry, and adjacent pieces overlap enough to cover a gentle bend.

```ts
canvas.strokePolyline(points, count, {
  color: '#1d1d2b',
  width: 3,
  join: 'miter',
  miterLimit: 4,
  exactJoins: true,
})
```

`miterLimit` defaults to 4, which is the SVG default. Canvas 2D uses 10. The outline renderer ignores `dash` on these four calls.

An aligned border needs a closed contour with a clear winding. An open polyline falls back to `'center'` with a one-time console warning, and so does a zero-area shape. The outline of a `strokePath2D` call is cached per path. Outlines from `strokePolyline`, `strokeLine` and `strokeQuadratic` are built again on every draw, so register a `Path2D` for an aligned border that stays the same.

Under a translucent border, a very short segment or a sharp inner corner shows a slightly darker patch where the outline overlaps itself. A round join or a longer segment avoids it.

### Round corners smoothly

A rounded rectangle can have smooth corners, as with the corner smoothing setting in Figma. A smooth corner eases from the straight side into its curve, so the outline reads as continuous. `smoothing` runs from 0, a circular corner, to 1. {@link IOS_CORNER_SMOOTHING} matches the iOS app icon shape.

```ts
import { IOS_CORNER_SMOOTHING, ShapeNode } from 'stargazer'

const icon = new ShapeNode({
  geometry: {
    kind: 'rect',
    width: 120,
    height: 120,
    radii: 27,
    smoothing: IOS_CORNER_SMOOTHING,
  },
  fill: '#ffffff',
})
```

The icon draws as a smooth-cornered square. A smooth corner uses `(1 + smoothing)` times its radius of each side. When a side is too short for that, smoothing is reduced before the radius is, the way Figma fits corners. Inside `paint`, `fillRoundRect`, `strokeRoundRect`, `fillAndStrokeRoundRect` and `shadowRoundRect` take `smoothing` as their last parameter.

The analytic shadow has circular corners. A smooth-cornered shape's shadow uses the circular radius that cuts the same area off each corner. The two match once the blur is large enough, as documented on {@link Gfx2D.shadowRoundRect}.

To mask other content, such as a photo, to a smooth-cornered shape, use a squircle `ShapeNode` as the content's [`matte`](/module/scene/node2d#matte), which gives an anti-aliased edge. For a cheaper hard-edged clip, set the parent's `clip` to an outline from {@link squirclePath}.

```ts
import { GfxPath, IOS_CORNER_SMOOTHING, squirclePath } from 'stargazer'

card.clip = squirclePath(
  new GfxPath(),
  0,
  0,
  200,
  120,
  24,
  IOS_CORNER_SMOOTHING,
)
```

Everything under `card` is clipped to the 200 by 120 shape. {@link squircleSvgPath} gives the same outline as SVG path data, and {@link squirclePath2D} gives it as a `Path2D` that a {@link Path2DNode} can draw.

### Clip to paths and bitmaps

The `Canvas` has three clips. `setClip` takes a circle or a rounded rectangle. [`clipPath`](/module/scene/canvas#clippath) takes any `GfxPath`. [`setClipMask`](/module/scene/canvas#setclipmask) samples a {@link BitmapMask}.

`clipPath(path, rule?)` limits every following draw to the inside of a `GfxPath`, exactly per pixel under any transform. `restore()` undoes it. Clips nest, each one narrowing the last, and a path clip combines with `setClip`.

```ts
canvas.save()
canvas.clipPath(blob)
canvas.fillRect(0, 0, 400, 400, '#7cc4ff')
canvas.restore()
```

Only the part of the rectangle inside `blob` is drawn. The stencil buffer holds path clips, up to 7 levels deep. A deeper clip is ignored with a warning.

`setClipMask(mask)` masks by a `BitmapMask`'s alpha. It masks fills and uploads the mask as a texture, so use it when the shape cannot be a circle, a rounded rectangle or a path.

A `setClip` shape keeps the local space it was set in, together with the transform. Shape, fill, text and image draws measure each pixel against it there, so a circle clip under an uneven scale becomes the matching ellipse. Strokes, gradient programs, shader quads and path shadows measure the clip in device space, which approximates a circle under an uneven scale and a rounded rectangle under rotation.

A node's `clip` works on the whole subtree. A rectangle `clip` on an axis-aligned node clips in the shader. A path clip, a rectangle clip inside another clip and a clip on a rotated node use the stencil buffer.

### Group, blend and matte nodes

Inside one picture, a translucent group fades per draw. Alpha multiplies into each draw separately, so overlapping parts show through each other.

A subtree that fades as one flat image sets [`compositeGroup`](/module/scene/node2d#compositegroup) to `true` on its root node. The engine draws the node and its subtree into an offscreen surface, then composites the surface once with the node's cascaded `alpha`. Use it where parts overlap while translucent. A group that holds an inset view fades per draw instead.

[`compositeBlend`](/module/scene/node2d#compositeblend) sets how a node composites into what is under it. A value other than `'source-over'` makes the node a group. The supported modes are listed on the property. Another mode composites as `'source-over'` and warns once.

[`matte`](/module/scene/node2d#matte) takes another node whose drawing scales this one's, as a track matte. The engine draws the node and its subtree into one surface, and the matte node and its subtree into another over the same area. The node then composites through the matte by [`matteMode`](/module/scene/node2d#mattemode): `'alpha'`, `'inverted-alpha'`, `'luma'` or `'inverted-luma'`.

```ts
import { ShapeNode } from 'stargazer'

const reveal = new ShapeNode({
  geometry: { kind: 'circle', radius: 80 },
  fill: '#ffffff',
})
photo.matte = reveal
photo.matteMode = 'alpha'
parent.add(reveal, photo)
```

`photo` shows only inside the circle. The matte node draws only through the node it serves. It usually sits next to that node, so both share the parent's transform. A hidden matte is empty, which hides the node, or shows all of it with an inverted mode.

A mask made of several shapes is a matte whose children are groups with `compositeBlend` set. `'destination-out'` subtracts a shape from the coverage so far, `'destination-in'` intersects with it, and `'xor'` keeps what lies in only one of them.

### Place content in layers

A {@link Layer} is a node that gives its subtree its own placement, its own post-processing effects, or a kept render.

```ts
import { Layer } from 'stargazer'

const hud = new Layer({
  space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
})
scene.root.add(hud)
hud.add(scoreLabel)
```

The layer fits a 1920 by 1080 frame into the canvas element and follows its own view instead of the camera, so `scoreLabel` stays put while the camera pans. The `space`, `effects` and `cache` options and the rules for when a cached layer renders again are described on {@link Layer}. See [Scene graph](/guides/scene) for layers in a scene and [Post-processing](/guides/post-processing) for effects.

### Snap to device pixels

Two tools keep edges crisp, one for sizes and one for positions. [`canvas.snap(length)`](/module/scene/canvas#snap) rounds a local length to a whole number of device pixels at the scale the node is drawn at. Use it on sizes. A grid of equal cells then keeps equal cell widths, and the block keeps one shared subpixel offset, so it still slides smoothly.

```ts
override paint(canvas: Canvas): void {
  const cell = canvas.snap(this.boxWidth / 16)
  for (const run of this.runs) {
    canvas.fillRect(
      run.x * cell,
      run.row * cell,
      run.len * cell,
      cell,
      run.color,
    )
  }
}
```

The picture repaints once the scale stops at a new value, because a snapped length rounds differently at each scale.

[`pixelSnap`](/module/scene/node2d#pixelsnap) set to `true` on a node rounds the node's origin to a whole device pixel when it is drawn. It moves the node by less than half a pixel and repaints nothing. Sharp edges and nearest-filtered images then land on pixel boundaries at rest.

### Set bounds for culling and hit testing

A node's [`bounds`](/module/scene/node2d#bounds) is the local box of what its picture drew. The `Canvas` works it out while recording, so ordinary drawing needs no setup. The engine uses bounds to skip a node whose world box is outside the view, for the default `hitTest` and for the debug outline. Screen-width strokes and shadows reach a little past the box, and culling and hit testing allow for that.

`fillPath2D`, `strokePath2D` and `shadowPath2D` give a picture no bounds, because a `Path2D` has no bounds of its own. Such a node draws every frame wherever the camera is, until you set [`boundsOverride`](/module/scene/node2d#boundsoverride) to its local box.

```ts
import { Node2D } from 'stargazer'

class Panel extends Node2D {
  constructor() {
    super()
    this.boundsOverride = { x: 0, y: 0, width: 200, height: 24 }
  }
}
```

`boundsOverride` replaces `bounds` for hit testing and the debug outline. Culling uses it together with the picture's bounds, so a node stays visible while part of what it paints is in view. A container with no picture of its own sets it to take taps over a region. {@link Path2DNode} takes the box as its `bounds` option.

### Draw immediately with `draw`

Immediate drawing runs the draw commands again every frame, through {@link Gfx2D}. Use it for content that changes on every frame, when recording a picture each frame would cost more than drawing directly. A `Node2D` that has no `paint` method overrides [`draw(gfx, camera, dt)`](/module/scene/node2d#draw) instead.

```ts
import { Node2D } from 'stargazer'
import type { Gfx2D } from 'stargazer'

class Scope extends Node2D {
  readonly samples = new Float32Array(128)

  override draw(gfx: Gfx2D): void {
    gfx.strokePolyline(this.samples, 64, { color: '#7cc4ff', width: 2 })
  }
}
```

The engine calls `draw` every frame with the node's transform and alpha already set on `gfx`, and records nothing. A `draw` node has no picture bounds, so it is culled only when it sets `boundsOverride`. It makes a cached `Layer` above it render every frame.

### Draw with your own shader

When one fragment shader can stand in for many shapes, such as a field of dots, draw a rectangle with `canvas.drawShaderQuad`. See [Custom shaders](/guides/custom-shaders).

## Common problems

### A property never repaints the node

A class field with an initializer defines an own property on the instance, which hides the accessor that `definePaintProps` installs. Writing the field then never reaches the accessor. In development `definePaintProps` throws when it finds one. Declare the field with `declare` and no initializer.

```ts
import { Node2D, definePaintProps } from 'stargazer'

// Hides the accessor, so writes to value never repaint.
class Stuck extends Node2D {
  value = 0.4

  constructor() {
    super()
    definePaintProps(this, { value: 0.4 })
  }
}

class Gauge extends Node2D {
  declare value: number

  constructor() {
    super()
    definePaintProps(this, { value: 0.4 })
  }
}
```

### Content sits half its size off

A `ShapeNode` rectangle is centered on the node's origin by default, while `Canvas.fillRect` takes a top-left corner. Mixing the two shifts content by half its size. Set `centered: false` to give a `ShapeNode` a top-left origin, or draw from `(-width / 2, -height / 2)` in `paint`.

```ts
import { ShapeNode } from 'stargazer'

const panel = new ShapeNode({
  geometry: { kind: 'rect', width: 240, height: 140, centered: false },
  fill: '#1c2438',
})
```

### A picture lags the clock

`paint` that reads the clock, the node's transform or the camera records a picture that goes stale, because the engine replays it until a declared value changes. Put content that moves on a clock in a child node and write the child's transform in `onUpdate`.

```ts
import { Node2D } from 'stargazer'
import type { Canvas } from 'stargazer'

class Hand extends Node2D {
  override paint(canvas: Canvas): void {
    canvas.strokeLine(0, 0, 0, -60, { color: '#ffd34d', width: { screen: 3 } })
  }
}

class Clock extends Node2D {
  readonly hand = new Hand()

  constructor() {
    super()
    this.add(this.hand)
  }

  override onUpdate(dt: number): void {
    this.hand.transform.rotation += dt
  }
}
```

The hand paints once and turns every frame. Painting a rotation into the parent would repaint the parent for the whole turn.

### A path draws nothing

`fillPath2D`, `strokePath2D` and `shadowPath2D` need a `Path2D` with a registered tessellation. {@link parseSvgPaths} registers one for every path it returns, and {@link registerPathTessellation} registers one by hand. See [Assets](/guides/assets).

### An image looks jagged

The GPU samples an image from one resolution, with no mipmaps, so an image drawn at a small fraction of its natural size aliases. Scale the bitmap to the drawn size once.

```ts
const small = await createImageBitmap(logo, {
  resizeWidth: 80,
  resizeHeight: 80,
  resizeQuality: 'high',
})
```

## Next step

Keep frames cheap as the scene grows with [Rendering performance](/guides/performance), which covers what breaks a batch and how to read the cost in the debug HUD.

## See also

- {@link Canvas}: the recorder a node's `paint` draws into
- {@link Node2D}: `paint`, `clip`, groups, mattes and bounds
- {@link ShapeNode}: circles and rectangles with borders and shadows
- {@link Path2DNode}: SVG paths with borders, shadows and hit testing
- {@link GfxPath}: a path you build and edit in code
- {@link ImageNode}: an image drawn as a rectangle
- {@link squirclePath}, {@link squircleSvgPath}, {@link squirclePath2D}: smooth-cornered outlines
- {@link cssLinearGradient}: a linear gradient from CSS `linear-gradient` values
- {@link Layer}: placement, effects and a kept render for a subtree
- {@link definePaintProps}: properties that repaint a node when written
- [Scene graph](/guides/scene): the nodes that draw for you
- [Text](/guides/text): measuring, wrapping and the label cache
- [Assets](/guides/assets): SVG paths, tessellation and bitmap masks
- [Camera](/guides/camera): coordinate spaces and `screenScale`
- [Post-processing](/guides/post-processing): effects on the stage and on a layer
- [Rendering performance](/guides/performance): batches, kept content and the debug HUD
- [Custom shaders](/guides/custom-shaders): your own fragment shader on a rectangle
