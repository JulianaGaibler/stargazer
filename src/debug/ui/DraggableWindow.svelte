<script lang="ts">
  // `storageId` is both the `localStorage` key and the id that `spawnedBy`
  // refers to. The caller picks ids that do not clash with other apps on the
  // same origin.

  import type { Snippet } from 'svelte'
  import { onMount } from 'svelte'
  import {
    placeNextTo,
    registerWindow,
    resetChildrenOf,
    unregisterWindow,
  } from './windowRegistry'

  interface Props {
    visible: boolean
    /** The header text. */
    title: string
    /** The `localStorage` key for the saved position. */
    storageId: string
    /**
     * Default anchor when no saved position exists. Changing at runtime resets
     * the saved position so "open on the other side" wins over an earlier
     * drag.
     */
    side?: 'left' | 'right'
    /** Width in CSS px. The default comes from the debug styles. */
    width?: number
    /**
     * StorageId of the spawning parent. First open with no saved position
     * auto-places adjacent via `placeNextTo`. Ignored once dragged.
     */
    spawnedBy?: string
    /** Called when the close button is pressed. */
    onClose?: () => void
    children: Snippet
  }

  let {
    visible,
    title,
    storageId,
    side = 'left',
    width,
    spawnedBy,
    onClose,
    children,
  }: Props = $props()

  let isDragging = $state(false)
  let dragStartX = 0
  let dragStartY = 0
  let panelElement = $state<HTMLDivElement | undefined>(undefined)
  let position = $state<{ x: number; y: number } | null>(null)
  // The close button ignores clicks within CLOSE_COOLDOWN_MS of the window
  // opening, so the tap that opened it can't also close it.
  const CLOSE_COOLDOWN_MS = 250
  let openedAtMs = 0

  $effect(() => {
    if (visible) openedAtMs = performance.now()
  })

  // Clears the saved and in-memory position, so the next open uses `side` or
  // `spawnedBy` again. The registry also calls this when the parent window
  // changes side.
  function resetPosition(): void {
    localStorage.removeItem(storageId)
    position = null
  }

  // A new `side` clears the saved position, and the positions of the windows
  // we spawned, since those were placed relative to the old one. `prevSide` is
  // not reactive so that this effect does not trigger itself.
  let prevSide: 'left' | 'right' | undefined
  $effect(() => {
    if (prevSide !== undefined && prevSide !== side) {
      resetPosition()
      resetChildrenOf(storageId)
    }
    prevSide = side
  })

  // The position on open comes from, in order: a saved drag, `spawnedBy`, then
  // the CSS for `side`. `placeNextTo` does nothing when a drag is saved. It
  // runs in the same effect as the storage read so that its write lands first.
  $effect(() => {
    if (!visible) return
    if (position !== null) return
    if (spawnedBy) {
      placeNextTo(spawnedBy, storageId, { childWidth: width })
    }
    const saved = localStorage.getItem(storageId)
    if (saved) {
      try {
        position = JSON.parse(saved)
      } catch {
        // ignore bad JSON
      }
    }
  })

  onMount(() => {
    const handleResize = (): void => {
      if (!position || !panelElement) return
      const padding = 10
      const maxX = window.innerWidth - panelElement.offsetWidth - padding
      const maxY = window.innerHeight - panelElement.offsetHeight - padding
      const needsAdjustment =
        position.x > maxX ||
        position.y > maxY ||
        position.x < padding ||
        position.y < padding
      if (needsAdjustment) {
        const boundedX = Math.max(padding, Math.min(position.x, maxX))
        const boundedY = Math.max(padding, Math.min(position.y, maxY))
        position = { x: boundedX, y: boundedY }
        localStorage.setItem(storageId, JSON.stringify(position))
      }
    }

    window.addEventListener('resize', handleResize)
    registerWindow(
      storageId,
      () => panelElement?.getBoundingClientRect() ?? null,
      resetPosition,
      spawnedBy,
    )
    return () => {
      window.removeEventListener('resize', handleResize)
      unregisterWindow(storageId)
    }
  })

  function handlePointerDown(e: PointerEvent): void {
    if (!panelElement) return
    isDragging = true
    const rect = panelElement.getBoundingClientRect()
    dragStartX = e.clientX - rect.left
    dragStartY = e.clientY - rect.top
    e.preventDefault()
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!isDragging || !panelElement) return
    const x = e.clientX - dragStartX
    const y = e.clientY - dragStartY
    const padding = 10
    const maxX = window.innerWidth - panelElement.offsetWidth - padding
    const maxY = window.innerHeight - panelElement.offsetHeight - padding
    position = {
      x: Math.max(padding, Math.min(x, maxX)),
      y: Math.max(padding, Math.min(y, maxY)),
    }
  }

  function handlePointerUp(): void {
    if (!isDragging) return
    isDragging = false
    if (position) {
      localStorage.setItem(storageId, JSON.stringify(position))
    }
  }

  function handleCloseAndReset(e: Event): void {
    e.stopPropagation()
    // Swallow taps that arrive too soon after open. See CLOSE_COOLDOWN_MS.
    if (performance.now() - openedAtMs < CLOSE_COOLDOWN_MS) return
    resetPosition()
    // Deliberately does not reset children here. Closing the parent doesn't
    // move it, so a child spawned next to it is still in the right place
    // relative to where the parent will reappear. Also, at this point the
    // parent's panel element is about to unmount, so `placeNextTo` would
    // fail to measure it and the child would fall back to its default CSS
    // anchor (jumping across the screen). The cascade only fires on
    // actual re-anchoring (see the `side`-change effect above).
    onClose?.()
  }
</script>

<svelte:window
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
/>

{#if visible}
  <div
    bind:this={panelElement}
    class="debug-panel {side}"
    class:dragging={isDragging}
    data-draggable-window={storageId}
    style:width={width ? `${width}px` : undefined}
    style:left={position ? `${position.x}px` : undefined}
    style:top={position ? `${position.y}px` : undefined}
    style:right={position ? 'auto' : undefined}
    style:bottom={position ? 'auto' : undefined}
  >
    <!-- Drag handle; pointer events so touch drags too. -->
    <div class="header" role="banner" onpointerdown={handlePointerDown}>
      <span class="title">{title}</span>
      <button
        class="close-button"
        onclick={handleCloseAndReset}
        title="Close and reset position"
        aria-label="Close {title} window"
      >
        ×
      </button>
    </div>

    {@render children()}
  </div>
{/if}
