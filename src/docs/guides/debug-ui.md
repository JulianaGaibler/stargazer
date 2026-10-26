---
title: Debug UI
group: Features
order: 23
---

# Debug UI

The debug HUD is built from Svelte components that you can use too. This page describes them and shows how to build a panel for the HUD or a debug window of your own.

Import them from `debug-ui`. The entry loads the debug styles, so an app that never imports it does not ship them. [Debugging](/guides/debugging) describes the HUD and the {@link DebugController}.

```ts
import { DebugSection, DebugRow, DebugSlider } from 'stargazer/debug-ui'
```

## Basic usage

This section builds a panel for the HUD. A panel is a Svelte component. The HUD gives it a `debug` prop, which is the {@link DebugController}, and any `props` you register with it.

```svelte
<!-- BoardPanel.svelte -->
<script lang="ts">
  import type { DebugController } from 'stargazer'
  import { DebugRow, DebugSection, DebugSlider } from 'stargazer/debug-ui'

  interface Props {
    debug: DebugController
    board: { cards: number; speed: number }
  }

  const { debug, board }: Props = $props()

  let speed = $state(board.speed)
</script>

<DebugSection title="Board" open>
  <DebugRow label="Cards" value={board.cards} />
  <DebugRow label="Frames" value={debug.frameStats.count} tone="muted" />
  <DebugSlider
    label="Speed"
    value={speed}
    min={0}
    max={4}
    step={0.1}
    format={(v) => `${v.toFixed(1)}×`}
    onInput={(next) => {
      speed = next
      board.speed = next
    }}
  />
</DebugSection>
```

Register the panel when the game starts and remove it when the game ends:

```ts
const off = host.debug.registerPanel({
  id: 'board',
  title: 'Board',
  component: BoardPanel,
  props: { board },
})
// Later:
off()
```

The HUD shows each registered panel as its own window, which opens from the hub. See [Custom panels](/guides/debugging#custom-panels).

### Your own debug window

You don't need the HUD to use the components. Put them in a `DraggableWindow` anywhere in your app. A settings menu, an operator screen or a level editor can all use it.

```svelte
<script lang="ts">
  import {
    DebugSection,
    DraggableWindow,
    ToggleButton,
  } from 'stargazer/debug-ui'

  let visible = $state(false)
  let showGrid = $state(false)
</script>

<DraggableWindow
  {visible}
  title="Level tools"
  storageId="my-game-level-tools"
  onClose={() => (visible = false)}
>
  <DebugSection title="View" open>
    <ToggleButton
      label="Grid"
      active={showGrid}
      onToggle={() => (showGrid = !showGrid)}
    />
  </DebugSection>
</DraggableWindow>
```

The window can be dragged by its header. It stays inside the viewport. It saves its position in `localStorage` under `storageId`, so give each window its own id. Ids from different apps on one origin share storage, so start yours with the name of your app.

## Advanced usage

This section lists every component by purpose, then describes window placement and tooltips.

### Layout

| Component         | Use                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DraggableWindow` | A window with a header, a close button and a saved position. Its props are described below.                                                                                |
| `DebugPanel`      | A `DraggableWindow` with a smaller set of props: `visible`, `side`, `title`, `onClose`. It derives `storageId` from the title.                                             |
| `DebugSection`    | A collapsible section. `open` can be bound. `maxHeight` limits the body to 300 px and scrolls. `summary` is a snippet shown next to the title while the section is closed. |
| `StatGrid`        | A grid of `StatCard`s. `columns` defaults to 2.                                                                                                                            |
| `DebugTree`       | An indented, expandable list. Give it `nodes` (see `TreeNode`) and `onToggle`. `renderContent` draws each row.                                                             |

### Controls

| Component          | Use                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ToggleButton`     | An on/off button. `hint` shows a keyboard key chip.                                                                                                        |
| `DebugToggleGroup` | A `ToggleButton` that shows its children only while it is on.                                                                                              |
| `DebugSlider`      | A slider with a readout. `onInput` fires while dragging and `onChange` fires on release.                                                                   |
| `DebugSelect`      | A dropdown. `options` is a list of `{ value, label }` and `{ divider: true }`.                                                                             |
| `HoldButton`       | A button that is down while a pointer is held on it. It releases on any pointer up, on window blur and on unmount, so a touch screen can't leave it stuck. |
| `StageSelector`    | Chips for choosing between stages.                                                                                                                         |
| `QualityKnob`      | A selector for a quality setting that shows what each choice costs.                                                                                        |

`ToggleButton` and `StageSelector` do not take keyboard focus when clicked. This keeps the debug camera keys (`W`, `A`, `S`, `D`, `Q`, `E`) working after a tap.

### Readouts

| Component     | Use                                                                                     |
| ------------- | --------------------------------------------------------------------------------------- |
| `DebugRow`    | A label and a value. `tone` is `default`, `warning`, `error`, `accent` or `muted`.      |
| `MetricRow`   | A label and a value colored by a `Tone`, with an optional bar and a tooltip.            |
| `StatCard`    | A large value with a unit, a note and an optional sparkline of recent values.           |
| `Gauge`       | A bar with good, warning and bad zones and an optional mark for the highest value seen. |
| `Sparkline`   | A line graph of a `SeriesSource`, for example a {@link RingSeries}.                     |
| `FrameGraph`  | A bar graph of frame times from a {@link FrameStats}.                                   |
| `ProgressBar` | A bar for a percentage from 0 to 100.                                                   |
| `Pill`        | A short colored label.                                                                  |
| `HealthChip`  | A summary chip that lists the readings that are not good.                               |

`Sparkline` and `FrameGraph` draw only when `revision` changes. Increase it once per frame from a `requestAnimationFrame` loop or a `frame` handler, as the HUD does.

### Tones

A tone is `neutral`, `good`, `warn` or `bad`. `TONE_COLORS` maps each tone to a color. `toneFor(threshold, value)` picks the tone for a reading from a `Threshold`, which has a `good` limit and a `warn` limit. A threshold with `lowIsBad` runs the other way, for readings like a cache hit rate.

```ts
import { toneFor, type Threshold } from 'stargazer/debug-ui'

const frameTime: Threshold = {
  label: 'Frame time',
  good: 16.7,
  warn: 33,
  tip: 'Time between frames in milliseconds.',
}
toneFor(frameTime, 20) // 'warn'
```

### Tooltips

`Tooltip` wraps content and shows a `TipSpec` on hover. `MetricRow`, `StatCard`, `Gauge`, `Pill` and `QualityKnob` take a `tip` prop that does the same. A tip given as a string is plain text. A `TipSpec` can add a title, a reading, a list of facts, a table and a picture of a threshold scale with the reading marked on it.

```svelte
<MetricRow
  label="Cards"
  value="12"
  tip={{
    title: 'Cards',
    body: 'Cards in play. More than 40 slows the board layout.',
    facts: [{ label: 'Limit', value: '40' }],
  }}
/>
```

### Window placement

`DraggableWindow` takes these props:

| Prop        | Meaning                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `visible`   | Shows or hides the window.                                                                                                  |
| `title`     | The header text.                                                                                                            |
| `storageId` | The `localStorage` key for the saved position.                                                                              |
| `side`      | `'left'` or `'right'`. The corner the window opens in when it has no saved position. Changing it clears the saved position. |
| `width`     | A width in CSS pixels. The default comes from the debug styles.                                                             |
| `spawnedBy` | The `storageId` of the window that opened this one. A first open places the window next to it.                              |
| `onClose`   | Called when the close button is pressed.                                                                                    |

The close button ignores a click in the first 250 ms after the window opens. This stops the tap that opened a window from closing it again on a touch screen.

A position saved by dragging always wins. Without one, a window with `spawnedBy` opens to the right of its parent, or to the left, or below it, whichever fits first. When the parent changes `side`, its children clear their saved positions as well and follow it.

`placeNextTo(parentStorageId, childStorageId, options)` does the same placement for a window that you position yourself. It saves a start position and does nothing when one is already saved.

### Styles

The components use global CSS classes from the debug styles, such as `.debug-panel`. They are plain CSS with fixed colors and a monospace font. Importing `debug-ui` loads them. Buttons are sized for touch.

## See also

- [Debugging](/guides/debugging): the HUD, hotkeys and custom panels
- {@link DebugController}: `registerPanel`, `frameStats` and the active stage
- {@link DebugPanelSpec}: what `registerPanel` takes
- {@link FrameStats} and {@link RingSeries}: the data behind `FrameGraph` and `Sparkline`
