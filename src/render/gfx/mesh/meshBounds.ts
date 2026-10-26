// World-space bounds math for meshes and shadow casters: boxes, frustum
// rejection, the caster set's extent and a light's forward axis.

import type { MeshNode } from '../../../nodes/MeshNode'
import type { Light3D } from '../../../nodes/Light3D'
import type { Aabb } from '../../../math/shadowFit'
import { vec3, vec3Normalize, type Vec3 } from '../../../math/Vec3'
import { mat4TransformPoint } from '../../../math/Mat4'
import { boxOutsideFrustum, type FrustumPlanes } from '../../../math/frustum'

const scratchDir: Vec3 = vec3()
const scratchPt: Vec3 = vec3()

/**
 * Write the mesh's world-space box into `out` as min x, y, z then max x, y, z.
 * False when the mesh has no bounds.
 */
export function worldBox(mesh: MeshNode, out: Float64Array): boolean {
  const b = mesh.localBounds()
  if (!b) return false
  const m = mesh.worldMatrix
  // The centre moves by the matrix, and each half extent spreads over the
  // absolute values of its column.
  const cx = (b.min.x + b.max.x) / 2
  const cy = (b.min.y + b.max.y) / 2
  const cz = (b.min.z + b.max.z) / 2
  const ex = (b.max.x - b.min.x) / 2
  const ey = (b.max.y - b.min.y) / 2
  const ez = (b.max.z - b.min.z) / 2
  for (let r = 0; r < 3; r++) {
    const c = m[r] * cx + m[4 + r] * cy + m[8 + r] * cz + m[12 + r]
    const e =
      Math.abs(m[r]) * ex + Math.abs(m[4 + r]) * ey + Math.abs(m[8 + r]) * ez
    out[r] = c - e
    out[3 + r] = c + e
  }
  return true
}

/**
 * Whether the mesh lies wholly outside `frustum`, using `box` as scratch. A
 * mesh without bounds never does.
 */
export function meshOutside(
  mesh: MeshNode,
  frustum: FrustumPlanes,
  box: Float64Array,
): boolean {
  if (!worldBox(mesh, box)) return false
  return boxOutsideFrustum(
    frustum,
    box[0],
    box[1],
    box[2],
    box[3],
    box[4],
    box[5],
  )
}

export function castersFar(
  aabb: Aabb,
  px: number,
  py: number,
  pz: number,
): number {
  let far = 0.1
  for (let i = 0; i < 8; i++) {
    const dx = (i & 1 ? aabb.max.x : aabb.min.x) - px
    const dy = (i & 2 ? aabb.max.y : aabb.min.y) - py
    const dz = (i & 4 ? aabb.max.z : aabb.min.z) - pz
    far = Math.max(far, Math.hypot(dx, dy, dz))
  }
  return far
}

/** The direction a light shines along. Valid until the next call. */
export function lightForward(light: Light3D): Vec3 {
  const w = light.worldMatrix
  return vec3Normalize(scratchDir, vec3(-w[8], -w[9], -w[10]))
}

export function castersAABB(casters: MeshNode[]): Aabb | null {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  let any = false
  for (const c of casters) {
    const b = c.localBounds()
    if (!b) continue
    const w = c.worldMatrix
    for (let i = 0; i < 8; i++) {
      const p = mat4TransformPoint(
        scratchPt,
        w,
        i & 1 ? b.max.x : b.min.x,
        i & 2 ? b.max.y : b.min.y,
        i & 4 ? b.max.z : b.min.z,
      )
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.z < minZ) minZ = p.z
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
      if (p.z > maxZ) maxZ = p.z
    }
    any = true
  }
  if (!any) return null
  return { min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) }
}
