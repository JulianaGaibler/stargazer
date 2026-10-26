---
title: Layout
group: Features
order: 9
---

# Layout

Layout sizes and places a group of nodes so that it fills the window and reflows when the window resizes. Use it for menus, heads-up displays, panels and page frames. Place game objects by setting `transform.x` and `transform.y`.

You build a tree of containers such as {@link Row}, {@link Column} and {@link Box}, give it to a {@link LayoutRoot}, and add the root to a scene. The engine then measures and places the tree to fill the visible area, and does it again after every resize. Layout is opt-in and costs nothing until you add a `LayoutRoot`. After this page you can build a responsive screen, keep freeform content inside it, and write your own layout node.

Each parent tells its children the minimum and maximum size they may take. Each child reports the size it wants within those limits. Then each parent places its children. All sizes and positions are in world units.

## Basic usage

This example fills the screen with a column: a title bar at the top, a footer at the bottom, and a body that takes the height left over.

```ts
import { LayoutRoot, Column, Expanded } from 'stargazer'

const root = new LayoutRoot()
root.setContent(
  new Column({
    gap: 16,
    crossAxisAlign: 'stretch',
    children: [
      titleBar, // nodes you built
      new Expanded({ child: body }),
      footer,
    ],
  }),
)
host.engine.tree.root.add(root)
```

The root fills the visible world rect of the view that places it. That is the camera's view, unless the root sits under a {@link Layer} with a space of its own. When the canvas resizes, the layout runs again and the column follows. `crossAxisAlign: 'stretch'` makes each child as wide as the column.

To fill a fixed region instead of the view, pass a `bounds` function. The root calls it on every layout pass.

```ts
new LayoutRoot({ bounds: () => myRegionRect })
```

[`setContent`](/module/layout/layoutroot#setcontent) replaces any earlier content. The old content is removed from the tree and stays alive, so destroy it when you are done with it.

### Rows and columns

A `Row` places its children left to right, and a `Column` places them top to bottom. Each child takes its own size along that direction, called the main axis. The other direction is the cross axis.

```ts
new Row({
  gap: 12,
  mainAxisAlign: 'spaceBetween',
  crossAxisAlign: 'center',
  children: [avatar, label, badge],
})
```

The avatar sits at the left edge, the badge at the right edge and the label between them, all centered vertically. `mainAxisAlign` decides where the leftover space on the main axis goes. `crossAxisAlign` places each child on the cross axis, and `'stretch'` makes every child fill it. The other values are listed in {@link FlexOptions}.

### Grow a child

To make a child take the leftover space, wrap it in {@link Expanded}. Several expanded children split the space by their `flex` weight, which is `1` unless you set it. {@link Spacer} is empty space that grows the same way. Use it to push neighbors apart.

```ts
new Row({
  children: [
    logo,
    new Spacer(), // pushes the button to the right edge
    playButton,
  ],
})

new Row({
  children: [
    new Expanded({ child: left, flex: 2 }), // two thirds
    new Expanded({ child: right, flex: 1 }), // one third
  ],
})
```

A {@link Flexible} child gets the same share as an `Expanded` one in a row or column, so write `Expanded`.

### Boxes and spacing

`Box` holds one child. Give it a fixed `width` and `height` or `padding`, and the child gets the whole interior inside the padding. A box with no `width` or `height` takes the child's size plus the padding on that axis.

{@link SizedBox} is a box of a fixed size, and reserves empty space when it has no child. {@link Padding} adds space around a child. {@link edgeInsets} builds the padding the way CSS shorthand does.

```ts
import { Box, SizedBox, Padding, edgeInsets } from 'stargazer'

new Box({ width: 480, padding: edgeInsets(24), child: content })
new SizedBox({ width: 96, height: 96, child: icon })
new Padding({ insets: edgeInsets(8, 16), child: label })

edgeInsets(16) // all four edges
edgeInsets(8, 16) // top and bottom 8, left and right 16
edgeInsets(4, 8, 12, 16) // top, right, bottom, left
```

The first box is 480 wide with 24 units of padding on every side. The second reserves a 96 by 96 square for the icon. The third wraps the label in 8 units above and below and 16 on each side.

### Place a child in a larger area

{@link Align} fills the space its parent offers and places one child inside it with `alignX` and `alignY`, which take `'start'`, `'center'`, `'end'` or `'stretch'`. {@link Center} is `Align` with both set to `'center'`.

```ts
new Center({ child: board })
new Align({ alignX: 'end', alignY: 'start', child: closeButton })
```

{@link AspectRatio} fits the largest box with a given width-to-height `ratio` into the offered space, and places the child in that box. A ratio of 1 keeps a board square as the window changes shape. `alignX` and `alignY` place the box.

```ts
new AspectRatio({ ratio: 1, child: board })
```

### Stack and Scaffold

{@link Stack} puts its children on top of each other in one box. It draws them in child order, so the last child is on top. `alignX` and `alignY` place every child. The stack is the size of its largest child, and `fit: 'expand'` makes it fill the space its parent offers.

{@link Scaffold} is a page frame. It has a `header`, a `content` area that fills the height between, a `footer` and a `gap`. The header and footer are optional.

```ts
new Stack({
  alignX: 'end',
  alignY: 'start',
  children: [thumbnail, unreadBadge],
})

new Scaffold({
  header: titleBar,
  content: new Center({ child: board }),
  footer: toolbar,
})
```

The badge sits in the top-right corner of the thumbnail. The scaffold shows the title bar on top, the toolbar at the bottom and the board centered in the space between.

### Text, shapes and animations in a layout

{@link TextNode}, {@link ShapeNode} and {@link LottieNode} work as layout children directly.

```ts
new Row({
  gap: 8,
  crossAxisAlign: 'center',
  children: [
    new ShapeNode({ geometry: { kind: 'circle', radius: 12 }, fill: '#4c8' }),
    new TextNode({ text: 'Online', fontSize: 24, color: '#fdf6e3' }),
  ],
})
```

A green dot appears next to the word "Online". A `TextNode` measures the width of its widest line and the height of all its lines. It then uses its `align` and `baseline` to place the text inside the box it gets. A `TextNode` draws the lines in its string, so break long text with {@link wrapText} first. A `ShapeNode` keeps its own size, a circle's diameter or a rect's `width` and `height`, and sits centered in its box unless the rect has `centered: false`. A `LottieNode` takes the full size of the box it gets.

Layout reads a `TextNode`'s size when a pass runs. After you change its `text`, call [`root.requestLayout()`](/module/layout/layoutroot#requestlayout) when the new size matters.

### Change a layout

Change a layout through its containers' methods. They keep the existing nodes, so running tweens and other state on those nodes survive. Each call schedules one layout pass on the next frame.

```ts
row.add(child)
row.insert(1, child)
row.remove(child)
row.setChildren([a, b, c])
box.setChild(child)
```

`Row` and `Column` have all four list methods. `Stack` has `add` and `remove`. `Box`, `SizedBox` and `Padding` have `setChild`. A removed child stays alive, so destroy it when you are done with it.

Container options such as `gap`, `width` or `alignX` are plain fields. After you set one, call [`markLayoutDirty()`](/module/layout/layoutnode#marklayoutdirty) on that container.

```ts
row.gap = 24
row.markLayoutDirty()
```

### Animate inside a layout

Tween the transform. A layout pass reads sizes, not `transform`, so a tween of `x`, `y`, `scaleX` or `scaleY` costs no layout work. A change to a layout size causes a new pass. To make a card pop, tween its scale, not its width.

```ts
await card.tween({ scaleX: 1.1, scaleY: 1.1 }, { duration: 0.15 })
```

A layout pass writes `x` and `y`, so a tween of position inside a layout lasts until the next resize or change.

## Advanced usage

These sections cover the root's bounds, freeform content inside a layout, placing a box without a layout tree, writing a layout node, and when the pass runs.

### Root bounds and views

A {@link LayoutRootOptions} object has `bounds`, `camera` and `id`. `bounds` returns the world rect to fill. When you leave it out, the root fills the visible world rect of a view. `camera` picks that view, and it defaults to the view that places the root.

```ts
new LayoutRoot({ camera: hudView })
```

Under a `Layer` with space `'screen'`, one unit is one CSS pixel and the root fills the canvas. Under a frame layer, the frame is fitted into the canvas, and the visible rect is the frame plus any extra area around it when the canvas has a different shape. See [Scene graph](/guides/scene) for layers and [Camera](/guides/camera) for the visible world rect.

### Freeform content in a layout

Some content positions itself, such as a physics field or a grid drawn from its own geometry. A {@link LayoutBuilder} keeps it inside a layout. It takes a place in the layout like any other child, and reports the rect it gets to an `onLayout` callback. The rect is in world coordinates, so content anywhere in the scene can use it.

```ts
import { LayoutBuilder, Center, AspectRatio } from 'stargazer'

const field = new LayoutBuilder({ onLayout: (rect) => board.fit(rect) })
root.setContent(
  new Center({ child: new AspectRatio({ ratio: 1, child: field }) }),
)
```

The board fits the largest square in the root and follows it on every resize. The builder reuses the rect object on every pass, so copy the fields you want to keep. [`contentRect`](/module/layout/layoutbuilder#contentrect) holds the rect from the last pass.

A node that is not {@link Measurable} also works inside a `Row`, `Column` or `Stack`. The container leaves it out of measuring and arranging. The node still draws, culls and receives pointer events, and stays where its own `transform` puts it.

A `LayoutBuilder` fills a box when its parent gives it an exact size, as a `LayoutRoot`, `AspectRatio` or `Expanded` does. To use one in a row or column, wrap it in one of those or in a `SizedBox`, or give it a fixed `width` and `height`.

### Align without a layout tree

{@link alignWithin} places a box inside a rect without any layout tree and returns the top-left point. Use it for a node, a rect of your own, or an HTML overlay.

```ts
import { alignWithin } from 'stargazer'

const { x, y } = alignWithin(rightMargin, 120, 48, 'center', 'center')
badge.transform.x = x
badge.transform.y = y
```

The badge is centered in `rightMargin`. `'stretch'` acts like `'start'` here, because the function returns a point. {@link alignOffset} does the same for one axis.

### Write a layout-aware node

A node takes part in layout when it implements {@link Measurable}. Extend {@link LayoutNode} for a container. It creates `measuredSize` and adds `markLayoutDirty()`, which walks up to the root and schedules a pass. In `arrange`, call `place`, which sets the node's `transform.x` and `transform.y` and its `boundsOverride`.

```ts
import { LayoutNode, BoxConstraints, type Size } from 'stargazer'

class FixedBox extends LayoutNode {
  w: number
  h: number

  constructor(w: number, h: number) {
    super('fixed-box')
    this.w = w
    this.h = h
  }

  measure(c: BoxConstraints): Size {
    this.measuredSize.w = c.constrainW(this.w)
    this.measuredSize.h = c.constrainH(this.h)
    return this.measuredSize
  }
  arrange(x: number, y: number, w: number, h: number): void {
    this.place(x, y, w, h)
  }
}
```

`FixedBox` asks for `w` by `h` and takes the closest size its parent allows. A {@link BoxConstraints} holds `minW`, `maxW`, `minH` and `maxH`. A maximum can be `Infinity`. On such an axis, size the node to its content. `constrainW` and `constrainH` clamp a value into range.

Follow these rules in a custom node:

- In `arrange`, write `transform.x` and `transform.y` and leave scale alone. `place` does this.
- Set `boundsOverride` to the arranged box, so culling and hit tests use the right area. `place` does this too.
- Call `markLayoutDirty()` whenever something that affects your size changes.
- Copy a child's `measuredSize` into local variables right after `measure`. A later `measure` call on that child overwrites it.
- Read the constraints you receive during `measure`. The parent reuses the object for the next child.

Moving a node in `arrange` leaves its picture as it is. If what a node draws depends on its size, call `markNeedsPaint()` from `arrange` when the size changes.

### When the pass runs

A `LayoutRoot` registers itself with the engine when you add it to a scene that belongs to an engine. It runs a pass when it is marked dirty. Adding the root, calling `setContent` or `requestLayout`, a `resize` event from the engine, and a container's list method or `markLayoutDirty` all mark it dirty.

The pass runs at most once per frame, after every node's `onUpdate` and before world transforms are computed. Positions written in `arrange` show on the same frame. A `markLayoutDirty` call during a pass schedules another pass on the next frame. The full order of the engine frame is in [Architecture](/guides/architecture).

## Common problems

Most layout problems show up as an error that names the node, or as a child with no size.

### A layout throws about an unbounded main axis

A `Row` or `Column` with an `Expanded`, `Flexible` or `Spacer` child needs a bounded size on its main axis. Under an unbounded axis it throws an error. Put the row or column inside a `LayoutRoot`, a `SizedBox` or an `Expanded`, which all give it a bounded size.

### An AspectRatio throws

An `AspectRatio` needs at least one bounded axis. Give it a parent that bounds one, such as a `LayoutRoot`, a `Center` or a `SizedBox`.

### A layout throws about a non-finite size

A node reported a size of `Infinity` or `NaN`, and the error names the node. A node measured on an unbounded axis sizes to its content, not to the constraint's maximum.

### A LayoutBuilder has no size

A bare `LayoutBuilder` in a row or column measures to the parent's minimum, which is 0, and logs a warning on an unbounded axis. Wrap it in `Expanded`, `AspectRatio` or `SizedBox`, or give it a `width` and `height`.

### Children should share a width

A container sizes each child on its own in a single pass. To give several children the same width, wrap each in a `Box` with that `width`.

### Content spills out of its box

A child larger than its box draws past the box edge. Size the child to fit, for example with `wrapText` for text, before you pass it in.

### Content next to a builder is the wrong size

Content that reads a `LayoutBuilder`'s rect lives outside the layout. Only your `onLayout` callback keeps the two in step, so size that content there.

## See also

- {@link LayoutRoot}: the node that runs a layout and fills the view
- {@link Row}: children left to right
- {@link Column}: children top to bottom
- {@link LayoutBuilder}: a layout slot for freeform content
- {@link LayoutNode}: base class for your own containers
- {@link BoxConstraints}: the size limits a parent passes to a child
- [Scene graph](/guides/scene): the node tree that layout builds on, and layers
- [Camera](/guides/camera): the view whose visible rect a root fills
- [Text](/guides/text): `TextNode` options
- [Animation](/guides/animation): tweens and cancellation
