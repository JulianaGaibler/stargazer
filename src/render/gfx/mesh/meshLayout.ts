// Attribute locations, uniform block sizes, texture units and vertex buffer
// layouts shared by the mesh, shadow and G-buffer programs. Each value must
// match the block or binding it names in the mesh shaders.

import type { VertexBufferLayout } from '../GfxDevice'

const LOC_POSITION = 0
const LOC_NORMAL = 1
const LOC_UV = 2
const LOC_TANGENT = 3

/** Fixed size of the PBR shader's light array. Excess lights are dropped. */
export const MAX_LIGHTS = 8
/** Depth-array layers / `u_shadowMat[]` size (matches the PBR shader). */
export const MAX_SHADOW_LAYERS = 4

// std140 block byte sizes. Each must match its UBO block in the mesh shaders.
export const FLAT_FRAME_BYTES = 208
export const FLAT_OBJECT_BYTES = 96
export const PBR_FRAME_BYTES = 176
export const LIGHTS_BYTES = 656
export const SHADOW_FRAME_BYTES = 272
export const PBR_OBJECT_BYTES = 224
export const SHADOW_CAM_BYTES = 64
export const CUBE_CAM_BYTES = 96
export const SHADOW_OBJECT_BYTES = 64
// AO G-buffer prepass blocks: frame = view-projection + view (two mat4) +
// near/far (vec4), object = model (one mat4). The view matrix + near/far turn
// window depth into the linear view depth the prepass writes.
export const GBUFFER_FRAME_BYTES = 144
export const GBUFFER_OBJECT_BYTES = 64

// Texture units (globally unique with the UBO bindings, the WebGL2 backend
// flattens bind groups to these numbers). Flat `u_texture` shares unit 0 with
// the PBR material base slot but they never coexist in one draw.
export const U_TEX = 0
export const U_AO = 2 // screen-space AO texture in the frame group (sampler at +16 = 18)
export const U_SHADOW_ARRAY = 8
export const U_SHADOW_CUBE = 9
export const U_PBR_TEX_BASE = 10 // baseColor..diffuseTransmission -> 10..15

/**
 * The 3D pass's fallback lighting: a single directional light used when the
 * scene has no {@link Light3D} nodes, plus the ambient term applied in every
 * case.
 */
export const FALLBACK_LIGHT = {
  direction: [-0.4, -1, -0.6],
  color: [1, 1, 1],
  ambient: [0.25, 0.25, 0.3],
} as const

export function posLayout(): VertexBufferLayout {
  return {
    arrayStride: 12,
    stepMode: 'vertex',
    attributes: [{ location: LOC_POSITION, format: 'float32x3', offset: 0 }],
  }
}

export function normalLayout(): VertexBufferLayout {
  return {
    arrayStride: 12,
    stepMode: 'vertex',
    attributes: [{ location: LOC_NORMAL, format: 'float32x3', offset: 0 }],
  }
}

export function flatVertexLayout(): VertexBufferLayout[] {
  return [
    posLayout(),
    {
      arrayStride: 12,
      stepMode: 'vertex',
      attributes: [{ location: LOC_NORMAL, format: 'float32x3', offset: 0 }],
    },
    {
      arrayStride: 8,
      stepMode: 'vertex',
      attributes: [{ location: LOC_UV, format: 'float32x2', offset: 0 }],
    },
  ]
}

export function pbrVertexLayout(): VertexBufferLayout[] {
  return [
    ...flatVertexLayout(),
    {
      arrayStride: 16,
      stepMode: 'vertex',
      attributes: [{ location: LOC_TANGENT, format: 'float32x4', offset: 0 }],
    },
  ]
}
