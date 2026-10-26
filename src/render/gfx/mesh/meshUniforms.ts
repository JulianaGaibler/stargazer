// Packs the fog, ambient occlusion and lights uniform data the mesh frame
// blocks share. Word offsets follow the std140 blocks in the mesh shaders.

import type { Fog } from '../../Fog'
import { PointLight3D, SpotLight3D, type Light3D } from '../../../nodes/Light3D'
import { FALLBACK_LIGHT, MAX_LIGHTS } from './meshLayout'
import type { ShadowLink } from './meshTypes'

/** Write `u_fogColor` (@word `o`) + `u_fogParams` (@word `o+4`). */
export function writeFog(f: Fog, s: Float32Array, o: number): void {
  const c = f.color
  s[o] = c[0]
  s[o + 1] = c[1]
  s[o + 2] = c[2]
  s[o + 3] = f.enabled ? 1 : 0
  s[o + 4] = f.mode === 'linear' ? 1 : 0
  s[o + 5] = f.density
  s[o + 6] = f.start
  s[o + 7] = f.end
}

/**
 * Write `aoParams` (@word `o`): enabled, flip-uv.y, resW, resH, then
 * `aoParams2` (@word `o+4`): direct-light AO strength.
 */
export function writeAoParams(
  s: Float32Array,
  o: number,
  enabled: boolean,
  pixelW: number,
  pixelH: number,
  directStrength: number,
): void {
  s[o] = enabled ? 1 : 0
  // The fragment position and the AO render target share an FBO origin per
  // backend, so no V-flip is needed. Kept as a param for tuning.
  s[o + 1] = 0
  s[o + 2] = pixelW
  s[o + 3] = pixelH
  s[o + 4] = enabled ? directStrength : 0
  s[o + 5] = 0
  s[o + 6] = 0
  s[o + 7] = 0
}

/** Pack the `Lights` block from the scene's light nodes. */
export function writeLights(
  F: Float32Array,
  I: Int32Array,
  lights: Light3D[],
  shadowByLight: Map<Light3D, ShadowLink>,
): void {
  // Layout (words): count @0 (ivec4), color[] @4, pos[] @36, dir[] @68,
  // cone[] @100, shadow[] @132 (each array is 8 × 4 words = 32 words).
  const COLOR = 4
  const POS = COLOR + MAX_LIGHTS * 4
  const DIR = POS + MAX_LIGHTS * 4
  const CONE = DIR + MAX_LIGHTS * 4
  const SHADOW = CONE + MAX_LIGHTS * 4
  F.fill(0)
  if (lights.length === 0) {
    const l = FALLBACK_LIGHT
    I[0] = 1
    // pos[0] = (0,0,0, type 0), dir[0] = direction, color[0] = color.
    F[DIR + 0] = l.direction[0]
    F[DIR + 1] = l.direction[1]
    F[DIR + 2] = l.direction[2]
    F[COLOR + 0] = l.color[0]
    F[COLOR + 1] = l.color[1]
    F[COLOR + 2] = l.color[2]
    return
  }
  const n = Math.min(lights.length, MAX_LIGHTS)
  I[0] = n
  for (let i = 0; i < n; i++) {
    const light = lights[i]
    const w = light.worldMatrix
    let type = 0
    let range = 0
    let cosInner = 0
    let cosOuter = 0
    if (light instanceof PointLight3D) {
      type = 1
      range = light.range
    } else if (light instanceof SpotLight3D) {
      type = 2
      range = light.range
      cosInner = Math.cos(light.innerConeAngle)
      cosOuter = Math.cos(light.outerConeAngle)
    }
    let dx = -w[8]
    let dy = -w[9]
    let dz = -w[10]
    const len = Math.hypot(dx, dy, dz) || 1
    dx /= len
    dy /= len
    dz /= len
    const c = light.color
    const s = light.intensity
    const sh = shadowByLight.get(light)
    const opacity = sh ? light.shadowOpacity : 0
    const p = i * 4
    F[POS + p] = w[12]
    F[POS + p + 1] = w[13]
    F[POS + p + 2] = w[14]
    F[POS + p + 3] = type
    F[DIR + p] = dx
    F[DIR + p + 1] = dy
    F[DIR + p + 2] = dz
    F[DIR + p + 3] = range
    F[COLOR + p] = c[0] * s
    F[COLOR + p + 1] = c[1] * s
    F[COLOR + p + 2] = c[2] * s
    F[COLOR + p + 3] = opacity
    F[CONE + p] = cosInner
    F[CONE + p + 1] = cosOuter
    F[SHADOW + p] = sh ? sh.kind : 0
    F[SHADOW + p + 1] = sh ? sh.param : 0
    F[SHADOW + p + 2] = light.shadowBias
    F[SHADOW + p + 3] = light.shadowNormalBias
  }
}
