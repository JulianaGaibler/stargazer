---
title: Debug UI
group: Features
order: 23
---

# Debug UI

The debug HUD is built from Svelte components that you can use too. This page shows how to build a panel for the HUD, a debug window of your own, and how the components fit together. [Debugging](/guides/debugging) describes the HUD and the {@link DebugController}.

Import the components from `@julianagaibler/stargazer/debug-ui`. The entry loads the debug styles, so an app imports them only where it shows a debug UI.

```ts
import {
  DebugSection,
  DebugRow,
  DebugSlider,
} from '@julianagaibler/stargazer/debug-ui'
```

## Basic usage

A panel for the HUD is a Svelte component. The HUD gives it a `debug` prop, which is the {@link DebugController}, plus any `props` you register with it.

```svelte
<!-- BoardPanel.svelte -->
<script lang="ts">
  import type { DebugController } from '@julianagaibler/stargazer'
  import {
    DebugRow,
    DebugSection,
    DebugSlider,
  } from '@julianagaibler/stargazer/debug-ui'

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

The HUD lists each registered panel as a button in the hub, and the button opens the panel in its own window. See [Custom panels](/guides/debugging#custom-panels).

### Your own debug window

Put the components in a `DraggableWindow` anywhere in your app, whether or not the HUD is mounted. A settings menu, an operator screen or a level editor can use it.

```svelte
<script lang="ts">
  import {
    DebugSection,
    DraggableWindow,
    ToggleButton,
  } from '@julianagaibler/stargazer/debug-ui'

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

The header drags the window, and the window stays inside the viewport. It saves its position in `localStorage` under `storageId`. Give each window its own id, and start it with the name of your app, because apps on one origin share storage.

## Advanced usage

These sections list the components by purpose, then describe tones, tooltips, window placement and styles.

### Layout

| Component         | Use                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DraggableWindow` | A window with a header, a close button and a saved position. See [Window placement](#window-placement).                                                        |
| `DebugPanel`      | A `DraggableWindow` with a smaller set of props: `visible`, `side`, `title`, `onClose`. It derives `storageId` from the title.                                 |
| `DebugSection`    | A collapsible section. Bind `open`. Set `maxHeight` to cap the body and scroll it. `summary` is a snippet shown next to the title while the section is closed. |
| `StatGrid`        | A grid of `StatCard`s. `columns` sets the column count.                                                                                                        |
| `DebugTree`       | An indented, expandable list. Give it `nodes` (see `TreeNode`) and `onToggle`. `renderContent` draws each row.                                                 |

### Controls

| Component          | Use                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ToggleButton`     | An on/off button. `hint` shows a keyboard key chip.                                                                                                            |
| `DebugToggleGroup` | A `ToggleButton` that shows its children only while it is on.                                                                                                  |
| `DebugSlider`      | A slider with a readout. `onInput` fires while dragging and `onChange` fires on release.                                                                       |
| `DebugSelect`      | A dropdown. `options` is a list of `{ value, label }` and `{ divider: true }`.                                                                                 |
| `HoldButton`       | A button that is down while a pointer is held on it. It releases on any pointer up, on window blur and on unmount, so a touch screen always sends the release. |
| `StageSelector`    | Chips for choosing between stages.                                                                                                                             |
| `QualityKnob`      | A selector for a quality setting that shows what each choice costs.                                                                                            |

`ToggleButton` and `StageSelector` leave keyboard focus where it was when clicked, so the debug camera keys (`W`, `A`, `S`, `D`, `Q`, `E`) keep working after a tap.

### Readouts

| Component     | Use                                                                                     |
| ------------- | --------------------------------------------------------------------------------------- |
| `DebugRow`    | A label and a value. `tone` is a `Tone`, `accent` or `muted`.                           |
| `MetricRow`   | A label and a value colored by a `Tone`, with an optional bar and a tooltip.            |
| `StatCard`    | A large value with a unit, a note and an optional sparkline of recent values.           |
| `Gauge`       | A bar with good, warning and bad zones and an optional mark for the highest value seen. |
| `Sparkline`   | A line graph of a `SeriesSource`, for example a {@link RingSeries}.                     |
| `FrameGraph`  | A bar graph of frame times from a {@link FrameStats}.                                   |
| `ProgressBar` | A bar for a percentage from 0 to 100.                                                   |
| `Pill`        | A short colored label.                                                                  |
| `HealthChip`  | A summary chip that lists the readings outside their good range.                        |

`Sparkline` and `FrameGraph` redraw when `revision` changes. Increase it once per frame from a `requestAnimationFrame` loop or a `frame` handler, as the HUD does.

### Tones

A tone is `neutral`, `good`, `warn` or `bad`. `TONE_COLORS` maps each tone to a color. `toneFor(threshold, value)` picks the tone for a reading from a `Threshold`, which has a `good` limit and a `warn` limit. A threshold with `lowIsBad` runs the other way, for readings like a cache hit rate.

```ts
import { toneFor, type Threshold } from '@julianagaibler/stargazer/debug-ui'

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
<script lang="ts">
  import { MetricRow } from '@julianagaibler/stargazer/debug-ui'
</script>

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

A window opens in the corner named by `side`. A window opened from another window sets `spawnedBy` to the other window's `storageId`, and a first open places it next to that window.

```svelte
<script lang="ts">
  import { DebugRow, DraggableWindow } from '@julianagaibler/stargazer/debug-ui'

  let detailsVisible = $state(true)
  let selected = $state('Card 3')
</script>

<DraggableWindow
  visible={detailsVisible}
  title="Details"
  storageId="my-game-details"
  spawnedBy="my-game-level-tools"
  side="right"
  width={360}
  onClose={() => (detailsVisible = false)}
>
  <DebugRow label="Selected" value={selected} />
</DraggableWindow>
```

The details window opens to the right of the level tools window, or to its left or below it, whichever fits first. A position saved by dragging always wins. Changing `side` clears the window's saved position, and the windows spawned by it clear theirs and follow it. `visible`, `title`, `storageId` and `onClose` work as in the first example, and `width` is in CSS pixels.

The close button ignores a click in the first 250 ms after the window opens, so the tap that opened a window on a touch screen leaves it open.

`placeNextTo(parentStorageId, childStorageId, options)` places a window that you position yourself the same way. It saves a start position when the window has none.

### Styles

The components use global CSS classes from the debug styles, such as `.debug-panel`. They are plain CSS with fixed colors and a monospace font, and buttons are sized for touch. Importing `@julianagaibler/stargazer/debug-ui` loads them.

## Next step

Read the numbers the HUD shows and decide which to track in [Debugging](/guides/debugging).

## See also

- [Debugging](/guides/debugging): the HUD, hotkeys and custom panels
- {@link DebugController}: `registerPanel`, `frameStats` and the active stage
- {@link DebugPanelSpec}: what `registerPanel` takes
- {@link FrameStats} and {@link RingSeries}: the data behind `FrameGraph` and `Sparkline`
