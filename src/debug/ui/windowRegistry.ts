/**
 * Tracks the mounted `DraggableWindow` instances by `storageId`, so a window
 * can be placed next to the window that opened it.
 */

type RectGetter = () => DOMRect | null
type ResetFn = () => void

interface WindowEntry {
  getRect: RectGetter
  reset: ResetFn
  spawnedBy?: string
}

const windows = new Map<string, WindowEntry>()

export function registerWindow(
  storageId: string,
  getRect: RectGetter,
  reset: ResetFn,
  spawnedBy?: string,
): void {
  windows.set(storageId, { getRect, reset, spawnedBy })
}

export function unregisterWindow(storageId: string): void {
  windows.delete(storageId)
}

/**
 * Resets every window whose `spawnedBy` is `parentStorageId`. Each child clears
 * its saved and in-memory position, then places itself next to the parent again
 * with `placeNextTo`. Grandchildren reset when their own parent resets.
 */
export function resetChildrenOf(parentStorageId: string): void {
  for (const entry of windows.values()) {
    if (entry.spawnedBy === parentStorageId) {
      entry.reset()
    }
  }
}

export interface PlaceNextToOptions {
  /** Gap in CSS px between parent and child edges. */
  gap?: number
  /**
   * Fallback child width used when the child isn't mounted yet (so its rect
   * can't be measured). Defaults to a mid-sized panel width.
   */
  childWidth?: number
  /** Fallback child height used when the child isn't mounted yet. */
  childHeight?: number
}

/**
 * Saves a start position for the child window next to the parent window. It
 * does nothing when the child already has a saved position. The child goes to
 * the right of the parent if it fits, then the left, then below, and is always
 * kept inside the viewport.
 */
export function placeNextTo(
  parentStorageId: string,
  childStorageId: string,
  opts: PlaceNextToOptions = {},
): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return
  }
  // A position the user chose by dragging always wins.
  if (localStorage.getItem(childStorageId) !== null) return

  const parentRect = windows.get(parentStorageId)?.getRect()
  if (!parentRect) return

  const gap = opts.gap ?? 12
  const padding = 10

  const childRect = windows.get(childStorageId)?.getRect()
  const childW = childRect?.width ?? opts.childWidth ?? 320
  const childH = childRect?.height ?? opts.childHeight ?? 200

  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  let x: number
  let y = parentRect.top

  const rightSlot = parentRect.right + gap
  const leftSlot = parentRect.left - childW - gap

  if (rightSlot + childW + padding <= viewportW) {
    x = rightSlot
  } else if (leftSlot >= padding) {
    x = leftSlot
  } else {
    // Neither side fits.
    x = parentRect.left
    y = parentRect.bottom + gap
  }

  const maxX = Math.max(padding, viewportW - childW - padding)
  const maxY = Math.max(padding, viewportH - childH - padding)
  x = Math.max(padding, Math.min(x, maxX))
  y = Math.max(padding, Math.min(y, maxY))

  localStorage.setItem(childStorageId, JSON.stringify({ x, y }))
}
