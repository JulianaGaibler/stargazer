// Uploads each mesh node's geometry to GPU buffers on demand and frees them
// when the node is released or destroyed.

import type { GfxDevice, IndexType } from '../GfxDevice'
import type { MeshNode } from '../../../nodes/MeshNode'
import type { GpuMesh } from './meshTypes'

export class MeshGeometryCache {
  readonly #device: GfxDevice
  readonly #onRelease: (mesh: MeshNode) => void
  #cache = new WeakMap<MeshNode, GpuMesh>()
  readonly #uploaded = new Set<MeshNode>()

  /** `onRelease` runs after a mesh's buffers are freed. */
  constructor(device: GfxDevice, onRelease: (mesh: MeshNode) => void) {
    this.#device = device
    this.#onRelease = onRelease
  }

  /** Forget every upload without freeing, for a lost context. */
  reset(): void {
    this.#cache = new WeakMap()
    this.#uploaded.clear()
  }

  ensure(mesh: MeshNode): GpuMesh | null {
    const geom = mesh.geometry
    if (!geom) return null
    const existing = this.#cache.get(mesh)
    // Keyed by node, so a node handed different geometry has to re-upload
    // rather than keep drawing the shape it was built with.
    if (existing) {
      if (existing.geometry === geom) return existing
      this.release(mesh)
    }

    const device = this.#device
    const vertCount = geom.positions.length / 3
    const posBuf = device.createVertexBuffer(geom.positions.byteLength)
    device.updateBufferSubData(posBuf, 0, geom.positions)
    const normBuf = device.createVertexBuffer(geom.normals.byteLength)
    device.updateBufferSubData(normBuf, 0, geom.normals)

    const indexType: IndexType =
      geom.indices instanceof Uint32Array ? 'u32' : 'u16'
    const ibo = device.createIndexBuffer(geom.indices.byteLength, indexType)
    device.updateIndexBufferSubData(ibo, 0, geom.indices)

    // UV + tangent are always allocated (zero-filled when absent) so one vertex
    // layout serves every mesh. The shader gates their use by flags.
    const uvSrc = geom.uvs ?? new Float32Array(vertCount * 2)
    const uvBuf = device.createVertexBuffer(uvSrc.byteLength)
    device.updateBufferSubData(uvBuf, 0, uvSrc)
    const tanSrc = geom.tangents ?? new Float32Array(vertCount * 4)
    const tangentBuf = device.createVertexBuffer(tanSrc.byteLength)
    device.updateBufferSubData(tangentBuf, 0, tanSrc)

    const gpu: GpuMesh = {
      posBuf,
      normBuf,
      uvBuf,
      tangentBuf,
      ibo,
      indexCount: geom.indices.length,
      flatBuffers: [
        { buffer: posBuf, offset: 0 },
        { buffer: normBuf, offset: 0 },
        { buffer: uvBuf, offset: 0 },
      ],
      pbrBuffers: [
        { buffer: posBuf, offset: 0 },
        { buffer: normBuf, offset: 0 },
        { buffer: uvBuf, offset: 0 },
        { buffer: tangentBuf, offset: 0 },
      ],
      shadowBuffers: [{ buffer: posBuf, offset: 0 }],
      gbufferBuffers: [
        { buffer: posBuf, offset: 0 },
        { buffer: normBuf, offset: 0 },
      ],
      hasTangent: !!geom.tangents,
      geometry: geom,
      // `#uploaded` holds meshes strongly so `destroy` can free them all, which
      // means a destroyed node would otherwise keep its buffers for the life of
      // the renderer. `destroy` fires once per node.
      offDestroy: mesh.events.on('destroy', () => this.release(mesh)),
    }
    this.#cache.set(mesh, gpu)
    this.#uploaded.add(mesh)
    return gpu
  }

  release(mesh: MeshNode): void {
    const gpu = this.#cache.get(mesh)
    if (!gpu) return
    gpu.offDestroy?.()
    this.#device.deleteBuffer(gpu.posBuf)
    this.#device.deleteBuffer(gpu.normBuf)
    this.#device.deleteBuffer(gpu.uvBuf)
    this.#device.deleteBuffer(gpu.tangentBuf)
    this.#device.deleteIndexBuffer(gpu.ibo)
    this.#cache.delete(mesh)
    this.#uploaded.delete(mesh)
    this.#onRelease(mesh)
  }

  destroy(): void {
    for (const mesh of this.#uploaded) this.release(mesh)
  }
}
