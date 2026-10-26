// Shapes shared by the mesh renderer and the passes it owns: a mesh's GPU
// buffers and the per-light shadow linkage the lights block packs.

import type { IBuffer, VBuffer } from '../GfxDevice'
import type { MeshGeometry } from '../../../nodes/MeshNode'

type VertexBinding = { buffer: VBuffer; offset: number }

export interface GpuMesh {
  posBuf: VBuffer
  normBuf: VBuffer
  /** Always present (zero-filled when the geometry has no UVs). */
  uvBuf: VBuffer
  /** Always present (zero-filled when the geometry has no tangents). */
  tangentBuf: VBuffer
  ibo: IBuffer
  indexCount: number
  /** The vertex buffer bindings of each program, built once per upload. */
  flatBuffers: VertexBinding[]
  pbrBuffers: VertexBinding[]
  shadowBuffers: VertexBinding[]
  gbufferBuffers: VertexBinding[]
  /** Whether the geometry actually had tangents (drives the PBR tangent path). */
  hasTangent: boolean
  /**
   * The geometry these buffers hold, so a node that swaps its geometry gets a
   * re-upload instead of the previous shape. Absent on the shared quad, which
   * has no node and never changes.
   */
  geometry?: MeshGeometry
  /** Drops the node's destroy subscription. Absent on the shared quad. */
  offDestroy?: () => void
}

/** Per-light shadow linkage packed for the shader (see `u_lightShadow`). */
export interface ShadowLink {
  kind: number
  param: number
}
