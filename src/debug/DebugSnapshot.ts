// Snapshot shapes the HUD reads, plus the helpers that tally stage, 3D world,
// and physics stats for DebugController.snapshotStats.

import type { RetainedCacheStats } from '../render/gfx/RetainedCache'
import type { RenderFailure } from '../render/gfx/RenderFailures'
import type { GfxBackend } from '../render/gfx/GfxDevice'
import type { GpuGfxStats } from '../render/gfx/GpuBatchContext'
import type { Engine, RegisteredPhysicsWorld } from '../engine/Engine'
import type { Stage } from '../render/Stage'
import type { CameraView3D } from '../camera/CameraView3D'
import type { WorldAccents } from './DebugOverlay'
import { MeshNode } from '../nodes/MeshNode'
import { BodyType } from '../physics/types'
import { walkTree } from '../scene/traverse'

/** Flattened view of one active pointer, shaped for the HUD's pointer sections. */
export interface ActivePointerReadout {
  id: number
  kind: 'touch' | 'mouse' | 'pen'
  screen: { x: number; y: number }
  world: { x: number; y: number }
  capturedByNodeId: string | null
}

/** One entry per attached stage, surfaced to the HUD for the chip strip. */
export interface StageChip {
  /** Stable identifier, `'primary'` or `'stage-{N}'`. */
  id: string
  /** Display label, `stage.name ?? \`Stage {N}`` (primary is always "Primary"). */
  label: string
  isActive: boolean
  isPrimary: boolean
}

/**
 * Per-frame GPU pipeline counters for the HUD. A direct alias of
 * {@link GpuGfxStats} (the field `Stage.gpuStats`/`GpuGfx.stats` actually
 * carry), kept as its own exported name so this module's public surface doesn't
 * shift if that one's internal home does.
 */
export type DebugGpuStatsReadout = GpuGfxStats

/**
 * One frame's worth of debug metrics for the active stage. Produced by
 * {@link DebugController.snapshotStats} and consumed by the HUD.
 */
export interface DebugStatsSnapshot {
  /** CPU work-time percentiles (seconds) per frame, headroom, NOT frame cadence. */
  p50: number
  p95: number
  p99: number
  max: number
  count: number
  /**
   * Actual frames per second, from the real post-cap frame interval. Reflects
   * the FPS cap and vsync. `0` when not yet measured.
   */
  fps: number
  /** 2D nodes in the active stage's tree. */
  nodeCount: number
  /** What the 2D walk did last frame: nodes, pictures painted and replayed. */
  compose: { nodes: number; paints: number; replays: number; culled: number }
  /** The pictures that streamed the most bytes to the GPU last frame. */
  streamers: readonly (readonly [string, number])[]
  /** What the renderer's retained caches hold and did last frame. */
  caches: readonly RetainedCacheStats[]
  /** The node classes that painted pictures last frame, most first. */
  composePainters: readonly (readonly [string, number])[]
  composeTotals: {
    frames: number
    framesPainted: number
    paints: number
    stale: number
  }
  /** Per-frame GPU pipeline stats for the active stage. */
  gpu: DebugGpuStatsReadout
  /** Which rendering backend the active stage's device is. */
  backend: GfxBackend
  /** GPU resources the active stage could not build, such as a rejected shader. */
  renderFailures: readonly RenderFailure[]
  cameraMode: 'game' | 'debug'
  cameraFollowing: boolean
  viewport: { x: number; y: number; width: number; height: number }
  screenPxPerWorldUnit: number
  pointerScreen: { x: number; y: number } | null
  pointerWorld: { x: number; y: number } | null
  canvasCss: { w: number; h: number }
  canvasDevice: { w: number; h: number }
  dpr: number
  activePointers: ActivePointerReadout[]
  touchSlopScreen: number
  touchSlopWorld: number
  aliveParticles: number
  /** All currently-attached stages, in order (primary first). */
  stages: StageChip[]
  /** Id of the currently-active stage, matches one entry in `stages`. */
  activeStageId: string
  /** True when the active stage isn't the primary. HUD grays pointer sections. */
  activeIsPrimary: boolean
  /** True when the active stage has its own `InputSystem`. */
  activeHasInput: boolean
  /** One entry per physics world in the active stage, empty when it has none. */
  physics: PhysicsWorldReadout[]
  /** 3D world stats for the active stage, or `null` when it has no 3D content. */
  world3d: World3DReadout | null
  /** Whether the fly camera currently holds the pointer lock (mouse-look on). */
  flyPointerLocked: boolean
  /** The fly camera's persistent scroll-adjustable speed multiplier. */
  flySpeedMultiplier: number
}

/**
 * 3D world + camera metrics for the active stage, shown in the HUD's Rendering
 * (3D subsection) and Camera panels.
 */
export interface World3DReadout {
  nodeCount: number
  meshCount: number
  /** Total triangles across all mesh geometry (not culled). */
  triangleCount: number
  /** Meshes + surfaces actually drawn last frame. */
  visible: number
  /** 3D draw calls last frame (meshes + RTT quads). */
  drawCalls: number
  /** Whether the 3D fly-camera is inspecting the scene. */
  cameraMode: 'game' | 'debug'
  camera: {
    position: { x: number; y: number; z: number }
    projectionness: number
    fovY: number
    near: number
    far: number
    aspect: number
    focalDistance: number
  }
}

/**
 * Live stats for one physics world in the active stage, shown in the HUD's
 * Physics panel. One of these per world, several worlds can coexist in a
 * stage.
 */
export interface PhysicsWorldReadout {
  /** Stable id for keying the HUD list within one snapshot. */
  id: string
  /** The world's label, from its registration. */
  label: string
  /** CSS color used for this world in the panel swatch and the overlay. */
  accent: string
  bodyCount: number
  sleeping: number
  static: number
  dynamic: number
  kinematic: number
  /** Solid contact manifolds from the last step (sensors excluded). */
  contactCount: number
  atRest: boolean
  gravity: { x: number; y: number }
}

/** Registered worlds anchored in `stage`'s scene. */
export function worldsForStage(
  engine: Engine,
  stage: Stage,
): RegisteredPhysicsWorld[] {
  const scene = stage.tree
  return engine.physicsWorlds.filter(
    (e) => (e.spaceNode?.scene ?? null) === scene,
  )
}

/**
 * Tally 3D world + camera stats for a stage, or `null` when it has no 3D.
 * `viewCamera` is only called once the stage is known to have 3D content, since
 * reading the camera can create the lazy default one. `debugActive` is whether
 * the fly camera is driving the stage.
 */
export function snapshotWorld3d(
  stage: Stage,
  viewCamera: () => CameraView3D | null,
  debugActive: boolean,
): World3DReadout | null {
  // Only report 3D when the stage has real 3D content (or the 3D fly-cam is
  // engaged). `has3D` skips intrinsic nodes, so reading it never materializes
  // the lazy default 3D camera on a pure-2D stage.
  if (!stage.tree.has3D && !debugActive) return null
  let nodeCount = 0
  let meshCount = 0
  let triangleCount = 0
  walkTree(stage.tree.root, (n) => {
    nodeCount++
    if (n instanceof MeshNode) {
      meshCount++
      const g = n.geometry
      if (g) triangleCount += g.indices.length / 3
    }
  })
  const s = stage.render3dStats
  const cam = viewCamera()
  // 3D content but no 3D camera yet: no camera readout to report.
  if (!cam) return null
  const eye = cam.eyePosition()
  return {
    nodeCount,
    meshCount,
    triangleCount,
    visible: s?.visible ?? 0,
    drawCalls: s?.draws ?? 0,
    cameraMode: debugActive ? 'debug' : 'game',
    camera: {
      position: { x: eye.x, y: eye.y, z: eye.z },
      projectionness: cam.projectionness,
      fovY: cam.fovY,
      near: cam.near,
      far: cam.far,
      aspect: cam.aspect,
      focalDistance: cam.focalDistance,
    },
  }
}

/** Tally physics stats for every world in a stage. */
export function snapshotPhysics(
  worlds: RegisteredPhysicsWorld[],
  accents: WorldAccents,
): PhysicsWorldReadout[] {
  const out: PhysicsWorldReadout[] = []
  for (let i = 0; i < worlds.length; i++) {
    const { world, label } = worlds[i]
    let sleeping = 0
    let staticCount = 0
    let dynamic = 0
    let kinematic = 0
    for (const b of world.bodies) {
      if (b.sleeping) sleeping++
      if (b.type === BodyType.Static) staticCount++
      else if (b.type === BodyType.Kinematic) kinematic++
      else dynamic++
    }
    out.push({
      id: `world-${i}`,
      label,
      accent: accents.get(world),
      bodyCount: world.bodyCount,
      sleeping,
      static: staticCount,
      dynamic,
      kinematic,
      contactCount: world.contactCount,
      atRest: world.isAtRest(),
      gravity: { ...world.config.gravity },
    })
  }
  return out
}

/** One chip per attached stage, primary first. `active` is null for primary. */
export function snapshotStageChips(
  engine: Engine,
  active: Stage | null,
): StageChip[] {
  const chips: StageChip[] = []
  const primary = engine.primaryStage
  chips.push({
    id: 'primary',
    label: primary.name ?? 'Primary',
    isActive: active === null,
    isPrimary: true,
  })
  let idx = 1
  for (const stage of engine.stages) {
    chips.push({
      id: `stage-${idx}`,
      label: stage.name ?? `Stage ${idx}`,
      isActive: active === stage,
      isPrimary: false,
    })
    idx++
  }
  return chips
}

export function stageIdOf(engine: Engine, stage: Stage): string {
  if (stage === engine.primaryStage) return 'primary'
  let idx = 1
  for (const s of engine.stages) {
    if (s === stage) return `stage-${idx}`
    idx++
  }
  return 'primary' // unreachable fallback
}

/** Resolve a stage id from {@link stageIdOf} back to the Stage, or `null`. */
export function stageById(engine: Engine, id: string): Stage | null {
  if (id === 'primary') return engine.primaryStage
  const m = /^stage-(\d+)$/.exec(id)
  if (!m) return null
  const target = Number(m[1])
  let idx = 1
  for (const s of engine.stages) {
    if (idx === target) return s
    idx++
  }
  return null
}
