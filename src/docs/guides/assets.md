---
title: Assets
group: Features
order: 12
---

# Assets

Art usually arrives as SVG or as an image. {@link parseSvgPaths} reads an SVG as vector paths, and {@link rasterizeSvg} draws it to a bitmap. {@link AssetLoader} caches the result, so a scene that loads again repeats no work. After this page you can load an SVG as paths or as a bitmap, register a path you build in code, make hit-test masks, and texture a 3D mesh from vector art.

The GPU renderer draws triangles, so every `Path2D` it fills or strokes needs a registered tessellation. `parseSvgPaths` registers one for you when you pass `tessellate: true`.

## Basic usage

This example loads an SVG map once, then adds one region of it to a scene.

```ts
import {
  AssetLoader,
  Path2DNode,
  parseSvgPaths,
} from '@julianagaibler/stargazer'

const assets = new AssetLoader()

await host.loadScene(async (scene) => {
  const map = await assets.load('map', async () => {
    const svg = await fetch('/map.svg').then((r) => r.text())
    return parseSvgPaths(svg, { tessellate: true })
  })
  const north = map.paths.get('north')
  if (north) {
    scene.root.add(
      new Path2DNode({ path: north.path, bounds: north.bounds, fill: '#88c' }),
    )
  }
})
```

The north region appears in lilac. The first `load` of `'map'` runs the factory. Every later `load` of that key returns the same promise, even after the scene is replaced. Create the loader outside the scene builder, once per app, so it outlives scene changes. A factory that rejects is dropped from the cache, so the next `load` of that key tries again.

### Read paths from an SVG

`parseSvgPaths(svgText, options)` reads every `<path>` in an SVG string. It returns an {@link SvgPathMap}: the SVG's `viewBox` and a map from key to {@link SvgPathEntry}. Set the colors on the node that draws the path, because the SVG's own fills and strokes are left out.

Each path gets its key this way:

1. A `<path>` with an `id` uses that id.
2. Otherwise the nearest ancestor element with an `id`, usually a `<g>`, gives the key. All paths under that ancestor merge into one `Path2D`, with bounds that cover them all. This is how a shape made of several pieces is usually drawn.
3. A path with neither gets `path-<index>`.

Each entry has `path`, a `Path2D`, and `bounds`, its axis-aligned bounds. With `tessellate: true` it also has `contours` and `triangles`.

### Draw an SVG as a bitmap

Use `rasterizeSvg` for artwork that keeps its own colors, such as a detailed illustration or an icon. It returns a canvas that you draw with [`drawImage`](/module/scene/canvas#drawimage) or an {@link ImageNode}.

```ts
import { rasterizeSvg } from '@julianagaibler/stargazer'

const icon = await assets.load('coin', () =>
  rasterizeSvg(coinSvg, { scale: 4 }),
)

// In a paint method:
canvas.drawImage(icon, 0, 0, 32, 32)
```

The icon is drawn in its own colors at 32 by 32 units. `scale` is a multiple of the SVG's `viewBox` size. Pass `width` and `height` instead to set the pixel size directly. Rasterize close to the size the image is drawn at. A canvas is sampled with one bilinear lookup, so a bitmap drawn at a third of its size loses most of its detail.

Use paths for flat vector shapes. Paths stay sharp at any zoom, batch with other fills, and use no texture memory. Use a bitmap when the art has its own colors, gradients or detail that you want to keep out of the node tree.

## Advanced usage

These sections cover how path tessellation works, how to register paths you build in code, SVG and bitmap options, masks, textures for 3D meshes, and sharing assets across stages.

### Why paths need tessellation

`fillPath2D` and `strokePath2D` draw the tessellation that was registered for the `Path2D` object. A browser `Path2D` keeps its path data to itself, so the engine triangulates the path data you give it ahead of time. A {@link Path2DNode} drop shadow reads the triangles, and a stroke of any alignment reads the contours. Parsing with `tessellate: true` provides all of them.

### Register a path built in code

For a `Path2D` you build yourself, flatten the path data to contours, triangulate them, and register the result with the path.

```ts
import {
  flattenSvgPath,
  registerPathTessellation,
  tessellateContours,
} from '@julianagaibler/stargazer'

const d = 'M0 0 L40 0 L40 40 Z'
const contours = flattenSvgPath(d, 0.5)
const path = new Path2D(d)
registerPathTessellation(path, tessellateContours(contours), contours)
```

The path now fills and strokes like one from `parseSvgPaths`. The second argument of {@link flattenSvgPath} is the flattening tolerance, in the path's own units. `strokePath2D` walks the contours, so pass them whenever the path is stroked.

The fourth argument of {@link registerPathTessellation} is one `closed` flag per contour. It is `true` for every contour unless you say otherwise, which matches SVG shapes that end in `Z`. An open curve needs `false`, so that `strokePath2D` draws no closing segment.

```ts
const arc = 'M0 0 Q20 -30 40 0'
const arcContours = flattenSvgPath(arc, 0.5)
const arcPath = new Path2D(arc)
registerPathTessellation(
  arcPath,
  tessellateContours(arcContours),
  arcContours,
  [false],
)
```

`tessellateContours` takes up to 65,535 vertices per shape, so split a larger shape into several paths. Registrations are stored per `Path2D` object and go away when the path is garbage collected. {@link getPathContours} reads back the registered contours, and {@link releasePathTessellation} drops a registration early. Registering the same path again replaces its tessellation.

For geometry that changes every frame, {@link flattenQuadratic} and {@link flattenCubic} subdivide one Bézier curve into a buffer you own. They allocate nothing, so they are safe to call while drawing.

### Holes and hit testing

`tessellateContours` nests contours with the even-odd rule. A contour inside an odd number of other contours is a hole in the one around it. The winding direction is free, because SVG exporters apply it inconsistently.

{@link Path2DNode} uses the same rule for `hitMode: 'fill'`, so a tap inside a hole misses the shape. The engine applies the even-odd rule to every path and ignores the SVG's `fill-rule`. Draw regions that overlap and should both fill as separate paths.

### Retained geometry

The renderer keeps large geometry, such as a map, in static GPU buffers from its first draw and draws it with a model matrix. Pass `retained` in the last argument of `registerPathTessellation` to choose for one path. The size at which geometry counts as large is documented on {@link registerPathTessellation}.

```ts
registerPathTessellation(path, geometry, contours, undefined, {
  retained: true,
})
```

### SVG path options

{@link ParseSvgPathsOptions} sets the tolerance and the scale. This call reads an SVG at twice its size with a finer curve tolerance.

```ts
const { paths } = parseSvgPaths(svg, {
  tessellate: true,
  flattenTol: 0.25,
  scale: 2,
})
```

`flattenTol` is how far a flattened curve may stray from the real curve, in output units. `scale` multiplies every path, its bounds and the `viewBox`, so two drawings can be read on one scale. `parseSvgPaths` throws when the text is not valid XML or has no `<svg>` root.

Two helpers measure a tessellated shape. {@link deepestInteriorPoint} returns the point inside the contours that is farthest from every edge, a good spot for a label or marker. `interiorThickness(entry)` returns the shape's mean width, `2 * area / perimeter`.

```ts
import { deepestInteriorPoint } from '@julianagaibler/stargazer'

const at = deepestInteriorPoint(north.contours ?? [])
if (at) {
  marker.transform.x = at[0]
  marker.transform.y = at[1]
}
```

### Bitmap options

{@link RasterizeSvgOptions} has `scale`, `width`, `height` and `timeoutMs`, the longest wait for the decode. An SVG with a `viewBox` rasterizes at that size times `scale`. An SVG without one is read as 64 by 64.

When the decode fails, `rasterizeSvg` logs a warning and resolves to a blank canvas of the right size, so a missing asset leaves startup intact. {@link isBlankRaster} tells you that happened, for example in a test environment that can't decode images.

```ts
import { isBlankRaster } from '@julianagaibler/stargazer'

const canvas = await rasterizeSvg(coinSvg, { width: 128, height: 128 })
if (isBlankRaster(canvas)) console.warn('coin art did not decode')
```

{@link svgViewBoxSize} reads the `viewBox` size from SVG text, so you can lay out the bitmap at its natural aspect ratio. {@link sizeSvgSource} writes a width and height onto the root element.

### Bitmap masks

`buildBitmapMask({ path, worldRect })` fills a path into a pixel mask and returns a {@link BitmapMask}. Its `contains(worldX, worldY)` answers whether a point is inside the shape with one array lookup.

```ts
import { buildBitmapMask } from '@julianagaibler/stargazer'

const mask = await buildBitmapMask({ path: arena, worldRect: arenaRect })
const inside = mask.contains(piece.transform.x, piece.transform.y, 8)
```

With the third argument, `insetWorld`, `contains` also tests four points that distance away and returns `true` only if all are inside. A piece therefore counts as inside only when its whole edge band is, and the soft edge of the mask does not count.

To crop draws to the shape, pass the mask to [`setClipMask`](/module/scene/canvas#setclipmask). For a circle or rounded rectangle, use [`setClip`](/module/scene/canvas#setclip). See [Drawing](/guides/drawing).

{@link BitmapMaskOptions} sets `resolution`, the longest edge in pixels, and `alphaThreshold`, the alpha above which a pixel counts as inside. Building a mask reads pixels back from a canvas, which can stall on a GPU-backed canvas, so the function is async. Build masks while loading. `dispose()` releases a mask.

### Textures for 3D meshes

`createTexture(source, options)` turns a canvas or an `ImageBitmap` into a {@link MaterialTexture} for a {@link MeshNode} material. With `rasterizeSvg`, it puts vector art on a mesh without a glTF file.

```ts
import {
  MeshNode,
  createQuadGeometry,
  createTexture,
  rasterizeSvg,
} from '@julianagaibler/stargazer'

const quad = createQuadGeometry({ width: 2.5, height: 3.5 })
const face = await createTexture(await rasterizeSvg(cardSvg, { scale: 2 }))
const card = new MeshNode(quad, {
  lit: true,
  pbr: true,
  color: [1, 1, 1, 1],
  baseColorTex: face,
})
```

The card shows the SVG art on a lit quad. {@link CreateTextureOptions} has `srgb`, `mipmap` and `wrap`. Base color and emissive art use the default `srgb: true`. Normal, metallic-roughness and occlusion maps hold linear data, so pass `srgb: false` for them. Pass `mipmap: false` for albedo with an alpha cutout, where filtering softens the cut edge.

The renderer shares GPU textures by {@link TextureImage} identity. Create one texture per picture and give it to every mesh that shows it.

`createTexture` resolves as soon as the pixels can be uploaded. For a canvas source, it also encodes a PNG copy in the background, which the renderer uses to rebuild the texture after a GPU context loss. {@link textureFromImageBitmap} is the synchronous form for a bitmap you already have. Its texture keeps no copy, so it is lost with the GPU context. Passing an `ImageBitmap` to `createTexture` behaves the same way. The renderer closes the bitmap after uploading it, so use the texture from then on.

glTF models load through {@link loadGltf}. See [3D](/guides/3d).

### Sharing across stages

A `Path2D`, a `BitmapMask` and an image hold no GPU handles, so one instance can back nodes on any number of stages. Tessellation registrations are global for the same reason. Each stage owns its nodes and shares the assets.

### Fonts

The browser shapes text from a CSS font string. Load every face before the first frame. See [Text](/guides/text).

## Common problems

These are the problems an asset most often causes in a first project.

### A path draws nothing

The `Path2D` has no registered tessellation, and the renderer skips it without an error. Parse the SVG with `tessellate: true`, or call `registerPathTessellation` for a path you built.

### A tap inside a shape misses

`hitMode: 'fill'` follows the even-odd rule, so a contour inside another one is a hole. Check whether the SVG nests the contour, or draw the pieces as separate paths.

### A rasterized icon looks soft

The bitmap is drawn at a very different size than it was rasterized at. Rasterize close to the size it is drawn at.

### A stroked curve has an extra segment

An open curve was registered with the default `closed` flags. Pass `false` for each open contour.

## See also

- {@link AssetLoader}: cache a load by key
- {@link parseSvgPaths}: read an SVG as paths
- {@link registerPathTessellation}: register a path built in code
- {@link rasterizeSvg}: draw an SVG to a canvas
- {@link buildBitmapMask}: a pixel mask for boundary tests and clipping
- {@link createTexture}: a texture for a 3D material
- {@link Path2DNode}: draw a path in the scene
- [Drawing](/guides/drawing): fills, strokes and clipping
- [3D](/guides/3d): meshes, materials and glTF
- [Text](/guides/text): fonts and labels
