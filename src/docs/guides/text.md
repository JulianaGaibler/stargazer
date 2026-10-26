---
title: Text
group: Features
order: 8
---

# Text

A {@link TextNode} puts a string in the scene. [`fillText`](/module/scene/canvas#filltext) on a {@link Canvas} draws one line from inside a node's `paint`. The browser shapes the text, so kerning, ligatures, complex scripts and emoji look as they do on a web page. Each line is rasterized once into a cached texture, so a label stays sharp and costs little while it moves, rotates or fades.

After this page you can add labels, fit text into a box, mix weights and icons in a paragraph, and load fonts so that the first frame is right. Read [Drawing](/guides/drawing) first if you haven't written a `paint` method before.

## Basic usage

A `TextNode` takes its string and style as options. Every option is a public field, so assigning a new value shows on the next frame.

```ts
import { TextNode } from 'stargazer'

const label = new TextNode({
  text: 'Ready',
  x: 100,
  y: 40,
  fontSize: 24,
  fontWeight: 700,
  color: '#fdf6e3',
})
scene.root.add(label)

label.text = 'Go'
```

A bold cream label reads "Ready" near the top-left corner, then "Go" on the next frame. `x` and `y` place the anchor in the parent's space. By default the anchor is the left end of the text's baseline. Set `align: 'center'` and `baseline: 'middle'` to center the text on the anchor. A tween can drive the numeric options.

### Draw text in `paint`

A node that paints itself calls `fillText` on its `Canvas`. Declare the string with {@link definePaintProps} so that changing it repaints the node.

```ts
import { Node2D, definePaintProps } from 'stargazer'
import type { Canvas } from 'stargazer'

class ScoreLabel extends Node2D {
  declare score: number

  constructor() {
    super()
    definePaintProps(this, { score: 0 })
  }

  override paint(canvas: Canvas): void {
    canvas.fillText(`Score: ${this.score}`, 0, 0, {
      font: '700 32px Inter, sans-serif',
      align: 'center',
      baseline: 'middle',
      color: '#fdf6e3',
    })
  }
}
```

`(x, y)` is the anchor in the node's local space. `align` places the text horizontally around it and `baseline` vertically. One call draws one line. To draw a paragraph, break it into lines first.

### Fit text to a width

[`wrapText`](/module/render/wraptext) breaks a string into lines that fit a width. Draw the lines at increasing `y` values.

```ts
import { wrapText } from 'stargazer'

const font = '400 18px Inter, sans-serif'
const lines = wrapText(rules, font, 300, 4)
lines.forEach((line, i) => {
  canvas.fillText(line, 0, 24 + i * 22, { font, color: '#fdf6e3' })
})
```

The fourth argument limits the lines. When the text needs more, the last line ends with an ellipsis.

### Use a webfont

Load every font face before the first frame that uses it, then build the scene.

```ts
await Promise.all([
  document.fonts.load('400 18px Inter'),
  document.fonts.load('700 18px Inter'),
])
```

The engine caches text by its font string, so text drawn before its face arrives keeps the fallback face. A family the page has no `@font-face` for draws with the next family in the font stack. If a face can still arrive after the first frame, see "Fonts that load late" under Advanced usage.

## Advanced usage

These sections cover the options of a `TextNode`, measuring and fitting text, mixed weights and inline icons, fonts that load late, and the cache that keeps text cheap.

### `TextNode` options

The constructor takes a {@link TextNodeOptions} object. This title is two lines, centered on the middle of the world, and grows and shrinks with the camera.

```ts
const title = new TextNode({
  text: 'Game\nOver',
  x: 960,
  y: 540,
  align: 'center',
  baseline: 'middle',
  fontFamily: 'Inter, sans-serif',
  fontWeight: 700,
  fontSize: 64,
  sizeSpace: 'world',
  color: '#ffd34d',
})
```

`sizeSpace` decides how `fontSize` is read, in the same way that `strokeSpace` works for a {@link ShapeNode}. With `'screen'`, the default, `fontSize` is in CSS pixels and the text keeps its size on screen when the camera zooms. With `'world'`, `fontSize` is in world units and the text scales with the camera.

A `\n` in the string starts a new line, and `baseline` anchors the whole block. `'top'` puts the block's top at `y`, `'middle'` centers it and `'bottom'` puts its bottom at `y`. `'alphabetic'` and `'hanging'` act like `'top'` for a block. `lineHeight` is a multiple of the font's own line height. To wrap a paragraph to a width, use `wrapText`.

`TextNode` implements {@link Measurable}, so it can sit in a layout container such as {@link Box}, {@link Row} or {@link Column}. The container measures the text at `fontSize` and places it in the box it assigns. `align` and `baseline` then pick the point inside that box. See [Layout](/guides/layout).

### `fillText` style

The fourth argument of `fillText` is a {@link GfxTextStyle}. Every field is optional.

```ts
canvas.fillText('Level 3', 0, 0, {
  font: '700 24px Inter, sans-serif',
  align: 'right',
  baseline: 'top',
  color: '#ffd34d',
})
```

The color is part of the rasterized bitmap, not a tint. Any CSS color string works, and a multi-color emoji keeps its own colors. The node's alpha and [`setAlpha`](/module/scene/canvas#setalpha) apply on top of it. To crop text to a shape, use [`setClip`](/module/scene/canvas#setclip).

The same text in many colors costs one bitmap per color. To share one, pass `tint: true` to `fillText`. The engine rasterizes the text in white and multiplies it by `color` when it draws, so every color of that string, font and size draws from the same bitmap. A multi-color emoji comes out in the one color.

```ts
canvas.fillText('Round over', 0, 0, {
  font: titleFont,
  color: teamColor,
  tint: true,
})
```

### Measure text

The measuring functions take a CSS font string and return sizes in the local units that `fillText` draws in. They cache their results, so calling them from `paint` is cheap. This example sizes a name to fit a 240-unit box and cuts it if the smallest size is still too wide.

```ts
import { ellipsize, fitFontSize } from 'stargazer'

const makeFont = (size: number) => `600 ${size}px Inter, sans-serif`
const size = fitFontSize(name, [28, 24, 20, 16], makeFont, 240)
const shown = ellipsize(name, makeFont(size), 240)
canvas.fillText(shown, 0, 0, { font: makeFont(size) })
```

`fitFontSize` returns the largest size whose line fits. Pass the sizes largest first. When none fits, it returns the last size in the list, and `ellipsize` holds the box edge. {@link textMetrics} returns the ascent, descent, cap height and advance of a string. {@link fontMetrics} returns the font's own figures. {@link measureText} returns the full {@link LabelMetrics} for a `GfxTextStyle`.

{@link textWidth} and {@link textAdvance} are different numbers. `textWidth` is the width of the label's bitmap box, which includes transparent padding around the glyphs. Fit text into a box with it. `textAdvance` is the pen step. To draw a second run right after the first, add the advance to `x`.

```ts
import { textAdvance } from 'stargazer'

const bigFont = '700 40px Inter, sans-serif'
const smallFont = '400 20px Inter, sans-serif'
canvas.fillText('42', x, y, { font: bigFont })
canvas.fillText('k', x + textAdvance('42', bigFont), y, { font: smallFont })
```

`wrapText` breaks lines at whitespace. A word wider than `maxWidth` stays whole on its own line, so pass that line through `ellipsize` when the box edge must hold. {@link wrapTextInfo} returns the same lines plus whether the text was cut.

### Vertical metrics

{@link textMetrics} reports the ink of one string. Its `ascent` and `descent` bound that exact text, so `"acme"` and `"Ajax"` differ. {@link fontMetrics} reports the font. Use its `lineHeight` to space lines and its `capHeight` to center text optically.

To center a row of text on `cy`, put the baseline at `cy` plus half the cap height and draw with `baseline: 'alphabetic'`. This example draws a large number and a small unit on one baseline.

```ts
import { textMetrics } from 'stargazer'

const bigFont = '700 40px Inter, sans-serif'
const smallFont = '400 20px Inter, sans-serif'
const big = textMetrics('42', bigFont)
const baseline = cy + big.capHeight / 2
canvas.fillText('42', x, baseline, { font: bigFont, baseline: 'alphabetic' })
canvas.fillText('k', x + big.advance, baseline, {
  font: smallFont,
  baseline: 'alphabetic',
})
```

Both runs sit on one baseline, and the number is centered on `cy`. A block of `n` lines is `n - 1` line gaps plus one line box, and {@link fitTextBlock} computes that for you. It tries each size from the list and returns a {@link TextBlock} with the chosen `size`, `lineHeight`, `firstBaselineY` and `height`. `truncated` is true when even the smallest size had to drop words.

This example centers a block of text vertically in a box.

```ts
import { fitTextBlock } from 'stargazer'

const mkFont = (size: number) => `400 ${size}px Inter, sans-serif`
const block = fitTextBlock(text, [20, 18, 16, 14], mkFont, box)
const top = box.y + (box.height - block.height) / 2
block.lines.forEach((line, i) => {
  canvas.fillText(
    line,
    box.x,
    top + block.firstBaselineY + i * block.lineHeight,
    {
      font: mkFont(block.size),
      baseline: 'alphabetic',
    },
  )
})
```

The optional fifth argument, `lineHeightRatio`, scales the font's own line height.

### Mixed weights in one paragraph

`fillText` takes one font per call, so a line such as "add 2k to the budget", with "2k" in bold, is drawn as several runs. {@link wrapRichText} takes a list of {@link TextSpan} objects, each `{ text, bold? }`, and a `makeFont(bold)` callback. It breaks lines at whitespace and returns {@link RichLine} objects whose runs carry their `x` offsets.

```ts
import { wrapRichText, type TextSpan } from 'stargazer'

const spans: TextSpan[] = [
  { text: 'add ' },
  { text: '2k', bold: true },
  { text: ' to the budget' },
]
const font = (bold: boolean) => `${bold ? 700 : 400} 18px Inter, sans-serif`
let y = box.y
for (const line of wrapRichText(spans, font, box.width)) {
  for (const run of line.runs) {
    if (run.kind === 'text') {
      canvas.fillText(run.text, box.x + run.x, y, { font: font(run.bold) })
    }
  }
  y += 22
}
```

Neighboring pieces with the same weight join into one run, so a line costs one `fillText` and one cached label per weight change, not one per word. Like `wrapText`, `wrapRichText` takes an optional `maxLines`.

{@link fitRichTextBlock} is the rich version of `fitTextBlock`. Its `makeFont` takes `(size, bold)`, and it returns a {@link RichBlock} with the same fields as a `TextBlock`. A span sets a weight, so a line has one size. To mix sizes on one line, place the runs yourself with `textMetrics`, as in the vertical metrics example.

### Icons in a paragraph

A span can also be an {@link InlineBox}: a rectangle that the engine measures, wraps and positions, and your code paints. It has a name, a height in em (`heightEm`) and a width-to-height ratio (`aspect`).

```ts
import { wrapRichText, type TextSpan } from 'stargazer'

const font = (bold: boolean) => `${bold ? 700 : 400} 18px Inter, sans-serif`
const spans: TextSpan[] = [
  { text: 'costs 3 ' },
  { box: 'coin', heightEm: 1.2, aspect: 1, alt: 'coins' },
]
let y = box.y
for (const line of wrapRichText(spans, font, box.width)) {
  for (const run of line.runs) {
    if (run.kind === 'box') {
      canvas.drawImage(
        icons[run.box],
        box.x + run.x,
        y + run.y,
        run.width,
        run.height,
      )
    } else {
      canvas.fillText(run.text, box.x + run.x, y, { font: font(run.bold) })
    }
  }
  y += 22
}
```

The line shows "costs 3" followed by the coin icon at 1.2 times the font size. Sizes are in em, so a box follows whatever size `fitRichTextBlock` picks. A box run's `y` is measured from the text's baseline and is negative. The box is centered on the font's cap height, level with the digits next to it.

A box attaches to the word next to it, so a badge stays with the number it qualifies. Add a space span, or set `leadEm` or `trailEm` on the box, where you want a gap. A box splits runs: `text box text` is three runs and three labels. A box taller than the text raises the line height of the whole block, so fewer lines fit and `fitRichTextBlock` can fall back to a smaller size.

{@link richText} joins spans back into one string and uses each box's `alt` text. Use it for a log line, a tooltip or a screen reader label.

### Fonts that load late

The renderer caches each label by its font string. The measurement caches work the same way, so `fontMetrics` and the wrap functions keep sizes and line breaks that came from the fallback face. When a face can arrive after the first frame, clear all three caches as it does.

```ts
import { clearFontMetricsCache, clearTextLayoutCaches } from 'stargazer'

document.fonts.addEventListener('loadingdone', () => {
  clearFontMetricsCache()
  clearTextLayoutCaches()
  engine.invalidateText()
})
```

[`invalidateText`](/module/engine/engine#invalidatetext) drops the rasterized labels on every stage, and the next frame rasterizes them again with the real face. A node that took a font string or a measurement once, in its constructor, keeps it. Rebuild those nodes after the clear.

### Sharpness

The picture records the `fillText` call. The renderer rasterizes the label when it replays the picture, at the size the text has on screen, taken from the scale of the transform the text is drawn under. Text at rest draws one texel per device pixel. The pen starts on a whole texel and an unrotated label snaps to a whole device pixel, so stems and baselines stay crisp.

### The label cache

Shaping and uploading a label are the costs to keep out of the frame loop, so the renderer caches each label by its text, its font family and weight, `align`, `baseline`, `color` and its size in device pixels. Moving, rotating and fading reuse the cached label. A fade is free because alpha is applied when the label is drawn.

```ts
await label.tween({ alpha: 0 }, { duration: 0.3 })
```

Color is baked into the bitmap, so tweening `color` rasterizes a new label on every frame the value changes. Fade with alpha instead, or draw the text with `tint: true`, whose color changes without a new raster.

Text whose device size keeps changing, such as world-space text during a zoom or a tween of `fontSize`, draws from the smallest raster it has that is at least as large, up to twice the size, which stays sharp. Without one it keeps drawing its last raster while that raster is close enough in size, which is soft while it is smaller than the text. It rasterizes at the exact size once the size holds still or leaves that range. Text that comes to rest within a few percent of a size it already has a raster for, up to 3% smaller or 1.5% larger, keeps that raster, so text that settles a hair off its last size, as the tail of an ease often leaves it, does not rasterize again. Screen-space text keeps its device size when the camera zooms, so a zoom rasterizes nothing. The renderer limits the new rasters per frame, so the first frame of a text-heavy scene pays for all its text and later frames cost less.

Text that grows from a raster it is drawn larger than is soft until it settles, and then sharpens at once. When the size a zoom ends at is known, warm it at the start: `canvas.warmText` under a scale that takes the text to that size rasterizes it there without drawing anything. The zoom then draws from the warmed raster from its first frame, sharp all the way, and lands on it. Text that shrinks draws from its larger starting raster, which stays sharp, and warming its end lets it land on the exact raster rather than wait to settle. A raster that is there already costs only a lookup, so a node can warm the end of a zoom in every frame of it.

```ts
override paint(canvas: Canvas): void {
  // `scale` is the scale the text is at now, `to` the one the zoom ends at.
  const k = this.to / this.scale
  canvas.save()
  canvas.scale(k, k)
  canvas.warmText(this.text, { font: this.font })
  canvas.restore()
  canvas.fillText(this.text, 0, 0, { font: this.font })
}
```

The cache has a fixed capacity and drops the oldest labels, and spares those drawn in the last few frames. Labels share one texture page, so they draw in one batch. A very large label gets a texture of its own and ends the batch. When the page has no room, the renderer frees a limited number of unused labels. If that is not enough, it clears the page at the start of the next frame, and every label on screen rasterizes again in that frame. A string so long, or a zoom so deep, that the texture would exceed the maximum size is rasterized at a lower scale, which softens it.

### Read the label cache

The rendering panel of the debug HUD shows how full the label cache is and how often the page was cleared. The texture inspector lists each cached label and the page's free space, and counts evictions, page clears and reduced-scale rasters. A page clear is the expensive event. See [Debugging](/guides/debugging).

## Common problems

Each of these has a symptom you can see on screen and a one-line fix.

### Text keeps the fallback font

The face arrived after the text was first drawn. Wait for `document.fonts.load` before you build the scene, or clear the caches when a late face arrives, as in "Fonts that load late".

### Centered text sits too low

`baseline: 'middle'` centers the em box, which includes room for descenders. Two sizes centered that way on one row also end up on different baselines. Put the baseline at the center plus half the cap height and draw with `baseline: 'alphabetic'`, as in "Vertical metrics".

### A long word runs past the box

`wrapText` keeps a word whole. Pass the line through `ellipsize` to hold the edge.

### Color animation stutters

An animated `color` rasterizes a new label on every changed frame. Tween `alpha` instead, or draw the text with `tint: true`.

## See also

- {@link TextNode}: a scene node that draws a string
- {@link Canvas}: `fillText` and the other draw calls
- {@link GfxTextStyle}: the style of one `fillText` call
- {@link wrapText}: break a string into lines
- {@link fitTextBlock}: fit a paragraph into a box
- {@link wrapRichText}: lay out mixed weights and inline boxes
- [Drawing](/guides/drawing): painting with a canvas
- [Layout](/guides/layout): placing text in containers
- [Debugging](/guides/debugging): the rendering panel and texture inspector
