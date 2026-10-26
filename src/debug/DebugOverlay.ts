// Drawing helpers for the DebugController overlays: the clip mask, the game
// camera rect, the selection highlight, 3D mesh gizmos, and physics world colors.

import type { CameraView2D } from '../camera/CameraView2D'
import type { BitmapMask } from '../assets/BitmapMask'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { DebugLine3DRenderer } from '../render/gfx/DebugLine3DRenderer'
import type { Stage } from '../render/Stage'
import type { PhysicsWorld } from '../physics/PhysicsWorld'
import type { Node2D } from '../scene/Node2D'
import type { Node3D } from '../scene/Node3D'
import { walkTree } from '../scene/traverse'
import { MeshNode } from '../nodes/MeshNode'
import { Light3D } from '../nodes/Light3D'
import { pushObb, drawLightGizmo, pushWireframe } from './DebugGizmo3DRenderer'
import { debugFont } from './debugFont'

// Overlay colors cycled across coexisting physics worlds. Distinct hues so two
// worlds on screen read apart at a glance.
const WORLD_ACCENTS = [
  'rgba(34, 211, 238, 1)', // cyan
  'rgba(232, 121, 249, 1)', // magenta
  'rgba(250, 204, 21, 1)', // amber
  'rgba(74, 222, 128, 1)', // green
  'rgba(248, 113, 113, 1)', // red
  'rgba(129, 140, 248, 1)', // indigo
]

/**
 * Stable overlay color per world, assigned on first sight from a fixed palette.
 * Keying by the world (not a render-time index) keeps a color from shifting
 * when another world is removed.
 */
export class WorldAccents {
  readonly #accents = new Map<PhysicsWorld, string>()

  /** Stable overlay color for a world, assigned from the palette on demand. */
  get(world: PhysicsWorld): string {
    let c = this.#accents.get(world)
    if (!c) {
      c = WORLD_ACCENTS[this.#accents.size % WORLD_ACCENTS.length]
      this.#accents.set(world, c)
    }
    return c
  }
}

/**
 * Paint the inspected clip mask over the frame as a translucent red fill,
 * clipped to the mask itself. Works by installing a world->device base
 * transform + `gfx.setClipMask(mask)` so `fillRect` uses local (world) coords
 * for the mask UVs, same coord system the mask's `worldRect` is in.
 */
export function drawClipMaskOverlay(
  gfx: Gfx2D,
  camera: CameraView2D,
  dpr: number,
  mask: BitmapMask,
): void {
  const S = camera.getScreenAffine()
  gfx.setBlend('source-over')
  gfx.setAlpha(1)
  gfx.setBaseTransform(
    S.a * dpr,
    S.b * dpr,
    S.c * dpr,
    S.d * dpr,
    S.e * dpr,
    S.f * dpr,
  )
  gfx.setClipMask(mask)
  const wr = mask.worldRect
  gfx.fillRect(wr.x, wr.y, wr.width, wr.height, 'rgba(255, 80, 80, 0.4)')
  gfx.setClipMask(null)
}

export function drawGameCameraRect(
  gfx: Gfx2D,
  activeCam: CameraView2D,
  gameCam: CameraView2D,
): void {
  // Game camera's world-space viewport rect (dashed) as seen through the
  // currently-active (debug) camera.
  const g = gameCam.viewport
  const pts = new Float32Array(8)
  for (let i = 0; i < 4; i++) {
    const cx = i === 0 || i === 3 ? g.x : g.x + g.width
    const cy = i < 2 ? g.y : g.y + g.height
    const s = activeCam.worldToScreen(cx, cy)
    pts[i * 2] = s.x
    pts[i * 2 + 1] = s.y
  }
  gfx.strokePolyline(pts, 4, {
    color: 'rgba(255, 215, 77, 0.9)',
    width: 1,
    dash: [6, 4],
    closed: true,
  })

  const anchor = activeCam.worldToScreen(g.x, g.y)
  gfx.fillText('game camera', anchor.x + 4, anchor.y + 12, {
    font: debugFont(11),
    color: 'rgba(255, 215, 77, 0.9)',
  })
}

/**
 * Outline a node's bounds (through its world transform) and label it with the
 * node id. Falls back to a small ring at the node origin when the node has no
 * bounds.
 */
export function drawNodeHighlight(
  gfx: Gfx2D,
  cam: CameraView2D,
  node: Node2D,
): void {
  // Bright line over a dark halo so the highlight reads on any background.
  const color = 'rgba(255, 255, 255, 0.98)'
  const halo = 'rgba(0, 0, 0, 0.85)'
  const m = node.transform.world
  const b = node.bounds
  if (!b) {
    const o = cam.worldToScreen(m.e, m.f)
    gfx.strokeCircle(o.x, o.y, 6, { color: halo, width: 4 })
    gfx.strokeCircle(o.x, o.y, 6, { color, width: 1.5 })
    labelWithHalo(gfx, node.id, o.x + 9, o.y - 4, color)
    return
  }
  const pts = new Float32Array(8)
  const corners = [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x + b.width, b.y + b.height],
    [b.x, b.y + b.height],
  ]
  for (let i = 0; i < 4; i++) {
    const lx = corners[i][0]
    const ly = corners[i][1]
    const s = cam.worldToScreen(
      m.a * lx + m.c * ly + m.e,
      m.b * lx + m.d * ly + m.f,
    )
    pts[i * 2] = s.x
    pts[i * 2 + 1] = s.y
  }
  gfx.strokePolyline(pts, 4, { color: halo, width: 4, closed: true })
  gfx.strokePolyline(pts, 4, { color, width: 2, dash: [4, 3], closed: true })
  labelWithHalo(gfx, node.id, pts[0] + 4, pts[1] - 4, color)
}

/** Draw label text on a dark backplate so it stays legible on any color. */
function labelWithHalo(
  gfx: Gfx2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  // 11px monospace advance is ~6.6px. No measureText on Gfx2D, so approximate.
  const w = text.length * 6.6
  gfx.fillRect(x - 2, y - 10, w + 4, 14, 'rgba(0, 0, 0, 0.65)')
  gfx.fillText(text, x, y, { font: debugFont(11), color })
}

/** Push the bounding box of every mesh in `stage` into `lines`. */
export function pushMeshBounds(lines: DebugLine3DRenderer, stage: Stage): void {
  walkTree(stage.tree.root, (n) => {
    if (n instanceof MeshNode) {
      const b = n.localBounds()
      if (b)
        pushObb(lines, b.min, b.max, n.worldMatrix, [0.4, 0.9, 1, 0.9], false)
    }
  })
}

/** Push the triangle edges of every visible mesh in `stage` into `lines`. */
export function pushMeshWireframes(
  lines: DebugLine3DRenderer,
  stage: Stage,
): void {
  walkTree(stage.tree.root, (n) => {
    if (n instanceof MeshNode && n.geometry && n.visible) {
      pushWireframe(lines, n)
    }
  })
}

/**
 * Push the selection gizmo for a 3D node: its mesh bounds, its light shape, or
 * a unit box for anything else. Drawn as an always-visible overlay.
 */
export function pushNodeHighlight3D(
  lines: DebugLine3DRenderer,
  node: Node3D,
): void {
  const c: [number, number, number, number] = [1, 1, 0.3, 1]
  if (node instanceof MeshNode) {
    const b = node.localBounds()
    if (b) pushObb(lines, b.min, b.max, node.worldMatrix, c, true)
  } else if (node instanceof Light3D) {
    drawLightGizmo(lines, node)
  } else {
    pushObb(
      lines,
      { x: -0.5, y: -0.5, z: -0.5 },
      { x: 0.5, y: 0.5, z: 0.5 },
      node.worldMatrix,
      c,
      true,
    )
  }
}
