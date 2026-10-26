---
title: Lottie
group: Features
order: 13
---

# Lottie

Lottie files describe vector animations as JSON. A {@link LottieNode} plays one in the scene, and the animation draws and batches with the rest of the frame. After this guide you can load an animation or a `.lottie` archive, control playback, change colors with themes, and check what the engine skipped. The `lottie` demo (`?demo=lottie`) shows these features.

## Basic usage

Fetch a file with {@link loadLottie}, give the result to a `LottieNode` and add the node to the scene.

```ts
import { LottieNode, loadLottie } from 'stargazer'
import type { SceneTree } from 'stargazer'

declare const scene: SceneTree

const spinner = new LottieNode({
  animation: await loadLottie('/spinner.json'),
  width: 96,
  height: 96,
})
spinner.transform.x = 200
scene.root.add(spinner)
```

The spinner plays and loops from the first frame. The node's origin is the top-left corner of a 96 by 96 box, and the animation scales to fit inside the box and sits at its center. Leave out `width` and `height` to use the animation's own size. {@link parseLottie} turns JSON text or an object you already have into the same animation.

### Control playback

The node has a method for each common control. Frames count from 0 at the animation's first frame.

```ts
spinner.pause()
spinner.seek(30)
spinner.play()
spinner.setSegment(0, 59) // play only frames 0 to 59
spinner.setMarker('idle') // play only the range of a named marker
spinner.setMarker(null) // play the whole animation again
spinner.stop() // return to the first frame
```

`currentFrame`, `totalFrames`, `durationMs` and `markers` describe the playback. The node's `player` is a {@link LottiePlayer} with the events and the remaining controls.

```ts
spinner.player.events.on('loop', ({ count }) => console.log('loops', count))
spinner.player.events.on('complete', () => console.log('done'))
spinner.player.setSpeed(2)
```

The events are listed in {@link LottiePlayerEvents}.

### Load a `.lottie` file

A `.lottie` file is a zip archive with a manifest, animations, themes, and the images and fonts they use. {@link loadDotLottie} opens one.

```ts
import { LottieNode, loadDotLottie } from 'stargazer'

const file = await loadDotLottie('/mascot.lottie')
const mascot = new LottieNode({
  animation: file.getAnimation(),
  assetResolver: (image) => file.getImage(image.path) ?? '',
})
mascot.setTheme(file.getTheme('dark'))
scene.root.add(mascot)
```

`getAnimation()` returns the manifest's first animation, and `getAnimation('id')` picks another. The `assetResolver` reads image layers from the archive. `setTheme` applies a theme from the file, and `setTheme(null)` returns to the file's own colors.

### Check what was not drawn

When an animation looks different from the design tool, read the node's `diagnostics`. Each entry has a stable `code`, a `message` and, when one layer is concerned, its `layer` name.

```ts
for (const d of spinner.diagnostics) console.warn(d.code, d.layer, d.message)
```

A feature the engine skips appears in this list, and the animation plays on. {@link LottieDiagnostic} describes the codes.

## Advanced usage

### `LottieNode` options

The constructor takes a {@link LottieNodeOptions} object. This example fits an animation into a 200 by 120 box, plays it back and forth three times and pauses its clock while it is off screen.

```ts
const badge = new LottieNode({
  animation: await loadLottie('/badge.json'),
  width: 200,
  height: 120,
  fit: 'cover',
  alignY: 'start',
  mode: 'bounce',
  loopCount: 3,
  speed: 1.5,
  offscreen: 'freeze',
})
scene.root.add(badge)
```

`width`, `height` and `fit` are also writable properties. With `offscreen: 'freeze'`, the animation stops advancing while the node is culled or hidden and resumes from the same frame. With `'advance'`, the default, time keeps running. In the bounce modes, playback turns around at the end and counts a loop after a full cycle out and back, so one `loop` event fires per cycle.

### Fit and alignment

`fit`, `alignX` and `alignY` place the animation in its box. {@link LayoutFit} lists the fit modes, and an alignment is a name or a number from 0 to 1.

`LottieNode` implements {@link Measurable}, so it can sit in a layout container such as {@link Row} or {@link Column}, and the container sets its box.

{@link computeLayout} is the function the node uses, and you can call it to place other content the same way.

```ts
import { computeLayout } from 'stargazer'
import type { LottieAnimation } from 'stargazer'

declare const anim: LottieAnimation

const { scaleX, scaleY, x, y } = computeLayout(
  anim.width,
  anim.height,
  320,
  200,
  'contain',
  'center',
  'center',
)
```

The result scales content of the animation's size to fit a 320 by 200 box, and `x` and `y` are its offset inside the box.

### How the node draws

Each layer of the animation becomes a child node of the `LottieNode`, and a precomposition holds its layers as child nodes. A layer's matrix is its node's transform, so a layer that only moves, scales or rotates repaints nothing, and a layer whose shapes stay the same paints once.

The node evaluates the animation when the playback frame or its box changes and the node is drawn. A paused animation or one that is culled costs only its draws. A layer repaints when something it paints is animated: a shape, a color, a stroke, its opacity or a repeater.

Masks, track mattes, blend modes and exact layer opacity use offscreen surfaces, built from the node properties [`compositeGroup`](/module/scene/node2d#compositegroup), [`compositeBlend`](/module/scene/node2d#compositeblend) and [`matte`](/module/scene/node2d#matte). The animation is clipped to its own bounds, and each precomposition to its bounds. A layer with a single add mask at full opacity is clipped to the mask's shape directly, and every other mask uses a surface. The [Drawing guide](/guides/drawing) describes these surfaces.

`opacityMode` decides how layer opacity applies. This example trades the surface for a cheaper approximation.

```ts
const glow = new LottieNode({
  animation: await loadLottie('/glow.json'),
  opacityMode: 'fold',
})
```

The default `'exact'` draws a partly transparent layer that has several fills or strokes into a surface and fades the surface, so overlapping shapes in the layer share one opacity. `'fold'` multiplies the opacity into every shape and needs no surface. The two differ only for layers whose shapes overlap. `transform.alpha` on the node fades the whole animation, like alpha on any node.

### What is drawn

The engine draws shape, solid, null, precomposition, text and image layers, with masks, track mattes, blend modes and the common shape modifiers. A property that has an expression plays the keyframes stored in the file. The {@link LottieNode} documentation lists the drawn features, and a feature outside that list appears in `diagnostics`.

### Text layers

A text layer draws each character from the glyph outlines the file embeds, which is what a design tool exports when it converts fonts to outlines. It uses the document's fill color, size, tracking, line height and justification. The document that applies is the last one whose frame has passed.

When a line has a character with no outline, the whole line draws with the platform font the file names, through the engine's text renderer. Load that font before the animation draws, for example with `document.fonts.load`. The bytes of the fonts inside a `.lottie` archive are in `file.fonts` for you to register. The [Text guide](/guides/text) describes font loading.

### Image layers

An image layer draws its picture once it has loaded. For each image, the node calls `assetResolver` with the file name (`path`), the folder (`dir`) and whether the file embeds the image as a data URI (`embedded`). The resolver returns a URL, a `Blob` or bytes, and `imageDecoder` turns that into something drawable.

```ts
const hero = new LottieNode({
  animation: await loadLottie('/hero.json'),
  baseUrl: '/lottie/hero/',
})
```

By default, an embedded data URI is used as it is. Any other image is fetched from `baseUrl` plus the folder plus the file name and decoded with `createImageBitmap`. An image that fails to load leaves its layer empty and adds an `image-missing` diagnostic.

### Diagnostic codes

Codes that start with `unsupported-` come from the renderer, after it builds the layers. The other codes come from the parser, and `image-missing` comes from the node.

```ts
const skipped = hero.diagnostics.filter((d) =>
  d.code.startsWith('unsupported-'),
)
```

The `diagnostics` of a {@link LottieAnimation} hold the parser's codes, and the node's `diagnostics` hold all of them. {@link LottieDiagnostic} lists each code and its meaning.

### Themes and slots

A slot is a property that the animation gives an id. A theme is a list of rules that set slots, and `setSlots` sets them by hand.

```ts
mascot.setTheme(file.getTheme('dark'))
mascot.setSlots({ 'body-main': { type: 'Color', value: [1, 0.2, 0] } })
mascot.resetSlots()
```

A value is a {@link LottieSlotValue}. A `Color` is `[r, g, b, a?]` with each part from 0 to 1, a `Scalar` is a number, `Vector` and `Position` are lists of numbers, and a `Gradient` is a list of `{ offset, color }` stops. The first four types take `keyframes` instead of a `value`. A color slot takes the red, green and blue parts of its value. `setSlots` returns how many properties changed and skips unknown ids.

A theme rule with an `animations` list applies to those animations when you pass an animation id as the second argument of `setTheme`. When you pass no id, every rule applies. `setTheme` resets every slot to the file's values before it applies the new theme, so each theme starts from the file's own values.

A theme changes the {@link LottieAnimation} object the node holds. Two nodes that should look different each need their own parse, and `getAnimation` and `loadLottie` return a fresh parse on every call.

{@link applyTheme}, {@link setSlotValue}, {@link resetSlots} and {@link parseTheme} do the same work on an animation directly.

### Archives and loading

{@link loadDotLottie} fetches and opens an archive, and {@link parseDotLottie} opens bytes you already have. Both return a {@link DotLottie} with the manifest, the `animationIds` and `themeIds`, the raw `images` and `fonts`, and `getAnimation(id?)`, `getTheme(id)` and `getImage(path)`. `getAnimation` and `getTheme` throw for an unknown id. Both archive layouts open: the `animations/`, `themes/` and `images/` folders, and the shorter `a/`, `t/`, `i/` and `f/`.

Calls to `loadLottie` or `loadDotLottie` for the same URL share one fetch, and the next call retries a failed fetch. Both take a `fetch` option to replace the browser's `fetch`.

```ts
const anim = await loadLottie('/spinner.json', {
  fetch: (url) => fetch(url, { credentials: 'include' }),
})
```

Archive entries stored with deflate are read through the browser's `DecompressionStream('deflate-raw')`, and reading one throws in a browser that lacks it. A ZIP64 or encrypted archive throws when it opens. `parseLottie` accepts JSON text or an object and throws when the file has no usable composition, meaning a size, a frame rate and a frame range.

### The player on its own

{@link LottiePlayer} is the clock inside the node, and you can use it to drive your own drawing. It runs on the time you give it. Call `advance(dtMs)` once per frame and read the frame it returns.

```ts
import { LottiePlayer, parseLottie } from 'stargazer'

declare const json: string
declare const dtMs: number
declare function drawFrame(frame: number): void

const anim = parseLottie(json)
const player = new LottiePlayer(anim, { looping: true, autoplay: true })

// Once per frame:
const { frame, changed } = player.advance(dtMs)
if (changed) drawFrame(frame)
```

`frame` counts from 0 at the animation's first frame. `changed` is `false` when nothing moved since the last call. A standalone player starts paused and plays once, so pass `autoplay` and `looping` for the node's behavior. {@link LottiePlayerOptions} also takes `marker`, the name of a marker to play, which takes precedence over `segment`. A marker with no length is a point, and `setMarker` seeks to it. `setController` installs a hook that runs at the start of every `advance`, for example a state machine that changes segments.

## Next step

Place an animation in a row or column with the [Layout guide](/guides/layout).

## See also

- {@link LottieNode}: play an animation in the scene
- {@link LottiePlayer}: the playback clock
- {@link loadLottie}: fetch and parse Lottie JSON
- {@link loadDotLottie}: fetch and open a `.lottie` archive
- {@link DotLottie}: an opened archive
- {@link LottieTheme}: a parsed theme
- {@link computeLayout}: fit content into a box
- [Drawing](/guides/drawing): surfaces, mattes and blend modes
- [Layout](/guides/layout): containers that size the node
- [Text](/guides/text): fonts for text layers
