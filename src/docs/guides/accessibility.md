---
title: Accessibility
group: Features
order: 20
---

# Accessibility

A screen reader reads HTML, so content drawn on a `<canvas>` needs an HTML counterpart. The accessibility layer builds a hidden HTML tree that mirrors the scene nodes you describe. A screen reader reads that tree, and a keyboard moves through it and activates its controls. After this guide you can make a menu readable and operable, announce game events, and hand control to a dialog.

You describe a node with {@link Semantics}: a role, a label and optional state. The engine creates one hidden element per described node inside a mount element that you provide. Your scene and its drawing stay as they are. The layer is an {@link AccessibilityTree}, reached as `engine.a11y`, and the engine creates it the first time you read it. It works on {@link Node2D} nodes.

## Basic usage

Give the engine a mount element right after the canvas element, then describe a node. In Svelte, the {@link a11yRoot} action mounts the element.

```svelte
<main style="position: relative">
  <canvas use:mountEngine={{ onReady }}></canvas>
  <div use:a11yRoot={{ engine: host.engine }}></div>
</main>
```

Add semantics to a node with [`node.a11y()`](/module/scene/node2d#a11y).

```ts
import { ShapeNode } from 'stargazer'

const startButton = new ShapeNode({
  geometry: { kind: 'rect', width: 240, height: 64 },
  fill: '#3a7',
}).a11y({
  role: 'button',
  label: 'Start game',
  onActivate: () => startGame(),
})
startButton.bindPointer({ down: () => startGame() })
panel.add(startButton)
```

The hidden tree gets a `<button>` named "Start game". A screen reader announces it, Tab moves focus to it, and Enter, Space or a click calls `onActivate`. Touch and mouse input go through `bindPointer`, which `.a11y()` leaves as it is. `bindPointer` returns an unbind function, so call it on its own line.

### Mount the hidden root

The mount element belongs to your app. Put it where its reading order next to the canvas element is right, usually the next sibling after the `<canvas>`. The engine styles it so it is hidden on screen and readable to screen readers.

Outside Svelte, call [`engine.a11y.mount(element)`](/module/a11y/accessibilitytree#mount). The engine builds the tree once it has a mount element, and you can describe nodes before or after you mount.

```ts
import type { Engine } from 'stargazer'

declare const engine: Engine

const root = document.createElement('div')
document.body.append(root)
engine.a11y.mount(root)
```

### Describe a node

`node.a11y(semantics)` returns the node, so it chains with `setVisible()` and `setHitEnabled()`. Before the node joins a scene, the engine holds the description and registers the node when it joins. [`engine.a11y.attach(node, semantics)`](/module/a11y/accessibilitytree#attach) registers the node at once and returns a {@link SemanticsHandle}.

```ts
const cell = engine.a11y.attach(cellNode, {
  role: 'gridcell',
  label: 'Column 1, row 1, empty',
  posInSet: 1,
  setSize: 42,
  onActivate: () => dropPiece(0),
  onFocus: () => focusRing.show(cellNode),
  onBlur: () => focusRing.hide(cellNode),
})
```

`onActivate` runs on a click and on Enter or Space while the element has focus. `onFocus` and `onBlur` run when keyboard focus enters and leaves the element, which is the moment to draw or hide a focus ring on the canvas.

A destroyed node leaves the hidden tree by itself. Decorative nodes stay out of the tree when you leave them undescribed.

### Change the description

Call `node.a11y()` again with the fields that changed. The engine merges them into the current semantics and updates the existing element, so focus stays where it is and the screen reader keeps its place.

```ts
muteNode.a11y({
  role: 'button',
  label: 'Mute',
  states: { pressed: false }, // a toggle button, sets aria-pressed
  onActivate: toggleMute,
})

// When the state changes:
muteNode.a11y({ label: 'Unmute', states: { pressed: true } })
```

With a handle, call [`update`](/module/a11y/semanticshandle#update) the same way. [`detach`](/module/a11y/semanticshandle#detach) removes the node from the hidden tree.

### Nested nodes

The hidden tree follows the scene tree, and only described nodes appear in it. A node you leave undescribed, such as a background or a layout container, has no element, and its described children move up under the nearest described ancestor. Take this menu.

```
panel          (Node2D)
├─ background  (ShapeNode)   decorative
├─ titleText   (TextNode)
└─ buttonRow   (Node2D)      layout only
   ├─ startButton   (ShapeNode)
   └─ optionsButton (ShapeNode)
```

Describe the four nodes that carry meaning.

```ts
import { Node2D, ShapeNode, TextNode } from 'stargazer'

const geometry = { kind: 'rect', width: 240, height: 64 } as const

const panel = new Node2D().a11y({ role: 'group', label: 'Main menu' })
const background = new ShapeNode({ geometry, fill: '#12233f' })
const buttonRow = new Node2D()
const titleText = new TextNode({ text: 'Welcome' }).a11y({
  role: 'heading',
  headingLevel: 1,
  label: 'Welcome',
})
const startButton = new ShapeNode({ geometry }).a11y({
  role: 'button',
  label: 'Start game',
  onActivate: startGame,
})
const optionsButton = new ShapeNode({ geometry }).a11y({
  role: 'button',
  label: 'Options',
  onActivate: openOptions,
})
panel.add(background, titleText, buttonRow)
buttonRow.add(startButton, optionsButton)
```

The engine creates this hidden HTML. The buttons sit directly under the group, because `background` and `buttonRow` have no element.

```html
<div role="group" aria-label="Main menu">
  <h1>Welcome</h1>
  <button>Start game</button>
  <button>Options</button>
</div>
```

Children read in the order the scene draws them. To change the order among siblings, set `order` on their semantics. Lower values come first and the default is `0`.

### Keyboard navigation

Each control is its own Tab stop. The composite roles `grid`, `radiogroup`, `listbox` and `toolbar` are the exception: the whole group is one Tab stop, and the arrow keys move focus between its members. Right and Down go to the next member, Left and Up to the previous one, and Home and End to the first and last. Focus wraps around at the ends.

A board of 42 cells in a `grid` is one Tab stop. The arrow keys follow reading order, so Down moves to the next cell in the list, which in a row-by-row grid is the cell to its right.

### Announce events

For messages that belong to no node, such as "Your turn", use [`announce`](/module/a11y/accessibilitytree#announce). It writes into a live region that the screen reader reads. The live regions exist once the root is mounted.

```ts
engine.a11y.announce('Red played column 3') // waits for a pause
engine.a11y.announce('Red wins!', 'assertive') // interrupts
```

The same message twice in a row is announced twice.

## Advanced usage

### Describe values and state

A {@link Semantics} object takes a `role` and any of `label`, `description`, `value`, `valueText`, `states`, `disabled`, `posInSet`, `setSize` and more. This example describes a volume readout.

```ts
engine.a11y.attach(volumeNode, {
  role: 'status',
  label: 'Volume',
  value: 3,
  valueText: 'Medium',
  live: 'polite',
})
```

A `status` element shows `valueText`, then `value`, then `label` as its text, and `live: 'polite'` makes the screen reader read each change. Other roles write `value` to `aria-valuenow` and `valueText` to `aria-valuetext`. `label` becomes `aria-label`, or the text of a `heading` or `status`. The type lists every field and the attribute it sets.

`states.current` takes `true` or `'page'`, `'step'` and `'location'`.

### Choose a role

The {@link A11yRole} decides which element the engine creates. `button` creates a `<button>`, `heading` creates `<h1>` to `<h6>` from `headingLevel` (`<h2>` by default), and `link` creates an `<a>` with `role="link"`. Every other role creates a `<div>` with that `role`.

The interactive roles such as `button`, `checkbox` and `gridcell` take focus. Any other role takes focus too once it has an `onActivate`, and the engine handles Enter and Space for it. Changing the role replaces the element. Every other change updates it in place.

### Link to HTML overlays

HTML overlays attached with `domAnchor` are normal HTML, so screen readers read them where they sit in the page. To connect a canvas node to an overlay, add a link.

```ts
engine.a11y.attach(helpButtonNode, {
  role: 'button',
  label: 'How to play',
  links: [{ relation: 'controls', target: '#help-panel' }],
  onActivate: openHelp,
})
```

The button now has `aria-controls="help-panel"`. {@link A11yRelation} lists the relations, each of which sets the matching `aria-*` attribute. An {@link A11yLink} `target` is an id string such as `'help-panel'` or `'#help-panel'`, or an `HTMLElement`. Prefer the id string, which leaves your HTML as it is. An element without an id gets one assigned.

An id for an element that appears later, such as an overlay inside an `{#if}` block, works. The browser resolves it when the element appears. Several links with the same relation share one attribute. The overlay stays in its own part of the page, so reading order and focus order stay the same.

### Modal dialogs

When your app opens a dialog, call [`setInert(true)`](/module/a11y/accessibilitytree#setinert). It sets `inert` and `aria-hidden` on the mount element, which hides the hidden tree from screen readers and from Tab. Call `setInert(false)` when the dialog closes.

```ts
function openPause() {
  engine.a11y.setInert(true)
  pauseDialog.focus()
}
function closePause() {
  engine.a11y.setInert(false)
}
```

### How the hidden tree updates

The engine rebuilds the hidden tree on its `frame` event, once after you attach, update, detach or mount, or after a described node is destroyed. A still scene costs nothing per frame, because screen readers ignore node positions. The rebuild moves existing elements, and it restores focus afterward, so focus stays on the element the user was on.

To change the reading order, move a described node to another parent or reorder siblings, then make any of the calls above. The next rebuild reads the scene tree again. Nodes in the primary scene read first, then nodes in other stages' scenes.

`engine.destroy()` disposes the layer and removes its elements from the mount element.

### Common problems

A screen reader reads the page in the wrong order. Reading order across the page follows DOM order. Put the mount element right after the canvas element and your overlays after that.

A disabled control still reacts. `disabled` sets `aria-disabled` and nothing else, so the engine still calls `onActivate`. Check your own state in the handler.

```ts
engine.a11y.attach(fireNode, {
  role: 'button',
  label: 'Fire',
  disabled: !canFire,
  onActivate: () => {
    if (canFire) fire()
  },
})
```

A screen reader stops reading the page and passes arrow keys to the canvas. The node has `role: 'application'`. Use that role on a small part that needs raw arrow keys, because it switches off the screen reader's reading mode.

A role announces with an unfamiliar name. `roleDescription` replaces the role name users know, so set it only when the standard name misleads.

Automated checks such as axe-core find wrong structure and attributes. Check reading order and announcements with a real screen reader such as NVDA, VoiceOver or TalkBack.

## Next step

Pin HTML to scene nodes in [HTML overlays](/guides/html-overlays), and link those overlays back to canvas nodes with the `links` field shown earlier on this page.

## See also

- {@link AccessibilityTree}: the hidden tree, reached as `engine.a11y`
- {@link Semantics}: the description of one node
- {@link SemanticsHandle}: update or detach a described node
- {@link A11yRole}: the supported roles
- {@link A11yLink}: links to HTML outside the hidden tree
- {@link a11yRoot}: the Svelte action that mounts the hidden root
- [HTML overlays](/guides/html-overlays): HTML elements pinned to scene nodes
- [Input](/guides/input): pointer handling with `bindPointer`
