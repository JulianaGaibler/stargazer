/**
 * Collision shapes and the {@link Collider} that attaches one to a body.
 *
 * Shapes are plain data in a collider's local space. A collider adds an offset,
 * sensor flag, optional layer/mask override, and material to a shape. Bodies
 * own any number of colliders.
 */

import { DEV } from 'esm-env'
import type { Rect } from '../math/Rect'
import { vec2, vec2Rotate, type Vec2 } from '../math/Vec2'
import {
  polygonArea,
  polygonCentroid,
  polygonComputeNormals,
  polygonMomentOfInertia,
} from '../math/polygon'
import type { Body } from './Body'
import type { Material } from './types'
import { StargazerError } from '../diagnostics/StargazerError'

/** A circle of the given radius, centered on the collider offset. */
export interface CircleShape {
  kind: 'circle'
  radius: number
}

/** An axis-aligned box with the given half-extents. */
export interface AABBShape {
  kind: 'aabb'
  halfW: number
  halfH: number
}

/**
 * A convex polygon wound counter-clockwise in local space. Build one with
 * {@link polygonShape}, which validates and precomputes edge normals.
 */
export interface PolygonShape {
  kind: 'polygon'
  vertices: readonly Vec2[]
  /** Outward unit edge normals, parallel to `vertices`. */
  normals: readonly Vec2[]
}

/** Any collision shape. */
export type Shape = CircleShape | AABBShape | PolygonShape

/**
 * Make a circle shape.
 *
 * @example
 *   body.addCollider({ shape: circleShape(0.5) })
 */
export function circleShape(radius: number): CircleShape {
  return { kind: 'circle', radius }
}

/** Make an axis-aligned box shape from its half-width and half-height. */
export function aabbShape(halfW: number, halfH: number): AABBShape {
  return { kind: 'aabb', halfW, halfH }
}

/**
 * Make a convex polygon shape. Vertices must be convex and wound
 * counter-clockwise. The winding is validated in dev builds. Edge normals are
 * precomputed once here.
 *
 * @example
 *   const tri = polygonShape([vec2(0, -1), vec2(1, 1), vec2(-1, 1)])
 */
export function polygonShape(
  vertices: readonly Readonly<Vec2>[],
): PolygonShape {
  if (DEV) {
    if (vertices.length < 3) {
      throw new StargazerError(
        'SG5007',
        'polygonShape: need at least 3 vertices',
      )
    }
    if (polygonArea(vertices) <= 0) {
      throw new StargazerError(
        'SG5007',

        'polygonShape: vertices must be wound counter-clockwise (positive area)',
      )
    }
  }
  const verts = vertices.map((v) => vec2(v.x, v.y))
  const normals = polygonComputeNormals([], verts)
  return { kind: 'polygon', vertices: verts, normals }
}

/** Signed-positive area of a shape, used for mass distribution. */
export function shapeArea(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return Math.PI * shape.radius * shape.radius
    case 'aabb':
      return 4 * shape.halfW * shape.halfH
    case 'polygon':
      return Math.abs(polygonArea(shape.vertices))
  }
}

/**
 * Moment of inertia of a shape about its centroid, for the given mass and a
 * uniform density.
 */
export function shapeInertia(shape: Shape, mass: number): number {
  switch (shape.kind) {
    case 'circle':
      return 0.5 * mass * shape.radius * shape.radius
    case 'aabb': {
      const w = 2 * shape.halfW
      const h = 2 * shape.halfH
      return (mass * (w * w + h * h)) / 12
    }
    case 'polygon': {
      const c = polygonCentroid(vec2(), shape.vertices)
      return polygonMomentOfInertia(shape.vertices, mass, c)
    }
  }
}

/**
 * A shape plus its placement and surface properties on a body. Create colliders
 * through {@link Body.addCollider} rather than constructing directly.
 */
export interface ColliderDef {
  /** The geometry. Build one with `circleShape`, `aabbShape`, or `polygonShape`. */
  shape: Shape
  /** Local offset from the body origin. Default `(0, 0)`. */
  offset?: Readonly<Vec2>
  /** Sensor: detected and reported via trigger events, never resolved. */
  sensor?: boolean
  /** Layer override, defaults to the owning body's layer. */
  layer?: number
  /** Mask override, defaults to the owning body's mask. */
  mask?: number
  /** Per-collider surface override. Unset fields fall back to the body's. */
  material?: Material
  /** Free slot for the game's own reference. The engine never reads it. */
  userData?: unknown
}

/** A collision shape attached to a {@link Body}. */
export class Collider {
  readonly shape: Shape
  /** Local offset from the body origin, rotated with the body. */
  readonly offset: Vec2
  /**
   * A sensor reports overlaps through trigger events but is never resolved, so
   * bodies pass straight through it.
   */
  sensor: boolean
  /** Layer override. `undefined` means inherit from the body at query time. */
  layer: number | undefined
  /** Mask override. `undefined` means inherit from the body at query time. */
  mask: number | undefined
  /** Surface overrides. Unset fields fall back to the body's values. */
  material: Material
  /** Free slot for the game's own reference. The engine never reads it. */
  userData: unknown
  /** Set when the collider is added to a body. */
  body!: Body

  constructor(def: ColliderDef) {
    this.shape = def.shape
    this.offset = vec2(def.offset?.x ?? 0, def.offset?.y ?? 0)
    this.sensor = def.sensor ?? false
    this.layer = def.layer
    this.mask = def.mask
    this.material = def.material ?? {}
    this.userData = def.userData
  }

  /** Effective layer: the collider override, or the body's layer. */
  effectiveLayer(): number {
    return this.layer ?? this.body.layer
  }
  /** Effective mask: the collider override, or the body's mask. */
  effectiveMask(): number {
    return this.mask ?? this.body.mask
  }
  /** Effective bounciness: the material override, or the body's. */
  effectiveRestitution(): number {
    return this.material.restitution ?? this.body.restitution
  }
  /** Effective friction: the material override, or the body's. */
  effectiveFriction(): number {
    return this.material.friction ?? this.body.friction
  }

  /**
   * World-space AABB of this collider given the owning body's transform,
   * written into `out`.
   */
  computeWorldAABB(out: Rect): Rect {
    const { position, rotation } = this.body
    const shape = this.shape
    // Collider offset rotated into world.
    const off = vec2Rotate(SCRATCH_OFF, this.offset, rotation)
    const cx = position.x + off.x
    const cy = position.y + off.y
    if (shape.kind === 'circle') {
      out.x = cx - shape.radius
      out.y = cy - shape.radius
      out.width = 2 * shape.radius
      out.height = 2 * shape.radius
      return out
    }
    if (shape.kind === 'aabb') {
      // AABB shapes stay axis-aligned in world space. Only the center follows
      // the rotated offset. Rotating boxes should use polygonShape.
      out.x = cx - shape.halfW
      out.y = cy - shape.halfH
      out.width = 2 * shape.halfW
      out.height = 2 * shape.halfH
      return out
    }
    // Polygon: transform each vertex by the body rotation, take min/max.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const verts = shape.vertices
    for (let i = 0; i < verts.length; i++) {
      const wv = vec2Rotate(SCRATCH_V, verts[i], rotation)
      const wx = cx + wv.x
      const wy = cy + wv.y
      if (wx < minX) minX = wx
      if (wy < minY) minY = wy
      if (wx > maxX) maxX = wx
      if (wy > maxY) maxY = wy
    }
    out.x = minX
    out.y = minY
    out.width = maxX - minX
    out.height = maxY - minY
    return out
  }
}

const SCRATCH_OFF = vec2()
const SCRATCH_V = vec2()
const AABB_CORNERS = [vec2(), vec2(), vec2(), vec2()]

/** Four local corners of an AABB shape, reused. */
export function aabbCorners(shape: AABBShape): Vec2[] {
  const { halfW, halfH } = shape
  AABB_CORNERS[0].x = -halfW
  AABB_CORNERS[0].y = -halfH
  AABB_CORNERS[1].x = halfW
  AABB_CORNERS[1].y = -halfH
  AABB_CORNERS[2].x = halfW
  AABB_CORNERS[2].y = halfH
  AABB_CORNERS[3].x = -halfW
  AABB_CORNERS[3].y = halfH
  return AABB_CORNERS
}
