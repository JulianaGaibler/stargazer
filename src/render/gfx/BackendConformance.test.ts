import { describe, expect, it } from 'vitest'
import { MeshRenderer } from './MeshRenderer'
import { MockGfxDevice } from './mock/mockGfxDevice'
import type { GfxBackend } from './GfxDevice'
import { Camera3D } from '../../camera/Camera3D'
import { SceneTree } from '../../scene/SceneTree'
import { Node3D } from '../../scene/Node3D'
import { MeshNode, createBoxGeometry } from '../../nodes/MeshNode'
import { DirectionalLight3D } from '../../nodes/Light3D'
import { RenderQuality } from '../RenderQuality'

/**
 * Cross-backend coordinate conformance for the backend-neutral 3D code. It
 * renders one golden scene against a mock standing in for each backend and
 * asserts the coordinate parts that must differ per backend (clip-Z, shadow
 * reconciliation) and the parts that must stay the same (front-face winding,
 * depth, cull). `MockGfxDevice(backend)` reports that backend's real `ndc`, so
 * these run the same `device.ndc`-driven branches the live devices do.
 */

const TARGET = {
  format: 'linear' as const,
  samples: 1,
  depthStencil: 'depth' as const,
}
const SHADOW_FRAME_BYTES = 272

async function untilReady(r: MeshRenderer): Promise<void> {
  for (let i = 0; i < 100 && !r.ready; i++) await Promise.resolve()
}

/** A PBR caster + a shadow-casting directional light, drawn on `backend`. */
async function renderGoldenScene(backend: GfxBackend) {
  const device = new MockGfxDevice(backend)
  const renderer = new MeshRenderer(device, TARGET, new RenderQuality())
  await untilReady(renderer)
  const world = new SceneTree(new Node3D('world3d-root'))
  const camera = new Camera3D()
  camera.transform.setPosition(0, 0, 5)
  camera.setAspect(1)

  world.add(
    new MeshNode(createBoxGeometry(1), {
      lit: true,
      color: [1, 1, 1, 1],
      pbr: true,
    }),
  )
  world.add(new DirectionalLight3D({ shadowEnabled: true }))
  world.updateTransforms()

  renderer.renderShadows(world.root)
  renderer.render(camera, world.root)
  return { device, camera }
}

/** The most recent shadow-frame UBO upload as a float view. */
function shadowFrame(device: MockGfxDevice): Float32Array {
  for (let i = device.uniformUploads.length - 1; i >= 0; i--) {
    const u = device.uniformUploads[i]
    if (u.data.byteLength === SHADOW_FRAME_BYTES)
      return new Float32Array(u.data.buffer, u.data.byteOffset, 68)
  }
  throw new Error('no shadow-frame upload')
}

describe('backend coordinate conformance', () => {
  it('camera projection uses the backend clip-Z range', async () => {
    const gl = await renderGoldenScene('webgl2')
    const gpu = await renderGoldenScene('webgpu')
    // The renderer drives the camera's clip-Z from `device.ndc`, so depth lands
    // in the range each backend keeps: WebGL clips `[-1,1]`, WebGPU `[0,1]`.
    expect(gl.camera.clipDepth).toBe('neg-one-to-one')
    expect(gpu.camera.clipDepth).toBe('zero-to-one')
  })

  it('3D pipelines keep ccw winding on both backends (cull parity)', async () => {
    // The winding does NOT flip between backends for this engine's setup: a
    // Z-only projection change leaves framebuffer-space winding alone, so both
    // declare `'ccw'`. Flipping it (a tempting "fix") culls the wrong faces.
    for (const backend of ['webgl2', 'webgpu'] as const) {
      const { device } = await renderGoldenScene(backend)
      const culled = device.pipelines.filter((p) => p.desc.cull !== 'none')
      expect(culled.length).toBeGreaterThan(0)
      for (const p of culled) expect(p.desc.frontFace).toBe('ccw')
    }
  })

  it('depth-tested 3D pipelines test depth on both backends', async () => {
    for (const backend of ['webgl2', 'webgpu'] as const) {
      const { device } = await renderGoldenScene(backend)
      const meshes = device.pipelines.filter(
        (p) => p.desc.color !== null && p.desc.cull === 'back',
      )
      expect(meshes.length).toBeGreaterThan(0)
      for (const p of meshes) expect(p.desc.depth?.test).toBe(true)
    }
  })

  it('shadow-sample reconciliation flags match the backend conventions', async () => {
    // mesh_pbr reconciles the light-space depth and the shadow-map row order
    // from these two flags: `.z` (word 66) = 1 when the light projection keeps
    // depth in `[0,1]`, `.w` (word 67) = 1 when the map is stored top-down.
    // Both hold on WebGPU, neither on WebGL2.
    const gl = shadowFrame((await renderGoldenScene('webgl2')).device)
    const gpu = shadowFrame((await renderGoldenScene('webgpu')).device)
    expect([gl[66], gl[67]]).toEqual([0, 0])
    expect([gpu[66], gpu[67]]).toEqual([1, 1])
  })
})
