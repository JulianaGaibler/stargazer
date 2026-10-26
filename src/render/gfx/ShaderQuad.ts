import type { ShaderReflection } from './GfxDevice'
import { StargazerError } from '../../diagnostics/StargazerError'

/**
 * A shader quad's compiled sources: WGSL (the source of truth, for WebGPU), the
 * GLSL ES 300 generated from it (for WebGL2), and the reflection sidecar, all
 * produced by `crates/shader-gen` and imported `?raw` / as JSON. The module
 * holds its own `vs_main` and `fs_main`.
 */
export interface QuadShaderSource {
  readonly glsl: { vertex: string; fragment: string }
  readonly wgsl: { code: string; vertexEntry: string; fragmentEntry: string }
  readonly reflection: ShaderReflection
}

/**
 * Build a {@link QuadShaderSource} from a shader module's generated artifacts.
 * Pass the `.gen.wgsl` file when the module uses includes.
 *
 * @remarks
 *   The WGSL module has `vs_main` and `fs_main` and declares these bindings:
 *
 *   - Group 0, binding 0 is the `Frame` block, copied from an existing shader such
 *       as `maskedRadialGradient.wgsl`. Binding 8 is the `Clip` block, which
 *       `include/clipUniform.inc.wgsl` declares along with `clipCoverage`.
 *   - Vertex input `a_unit` at location 0 is the quad's corner in `0..1`.
 *       `a_originAxisX` at location 1 is a `vec4` of the origin in device
 *       pixels and the x edge vector. `a_axisYAlpha` at location 2 holds the y
 *       edge vector, then the draw's alpha.
 *   - Group 1, binding 10 is the `Params` block, written from `quad.params`. Group
 *       1, bindings 0 to 3 are the textures, each with its sampler at the
 *       texture's binding plus 16.
 *
 *   The vertex shader places a corner at `origin + axisX * unit.x + axisY *
 *   unit.y`, projects it with `frame.proj`, and passes `unit` on as the UV. The
 *   fragment shader returns a premultiplied color and multiplies in the draw's
 *   alpha and `clipCoverage`.
 */
export function quadShader(
  vertex: string,
  fragment: string,
  wgsl: string,
  reflection: ShaderReflection,
): QuadShaderSource {
  return {
    glsl: { vertex, fragment },
    wgsl: { code: wgsl, vertexEntry: 'vs_main', fragmentEntry: 'fs_main' },
    reflection,
  }
}

/** Textures one {@link ShaderQuad} can bind, at bindings 0 to 3. */
const MAX_QUAD_TEXTURES = 4

/** Largest `Params` block a {@link ShaderQuad} can declare, in bytes. */
export const MAX_QUAD_PARAMS_BYTES = 256

/** Options for creating a {@link DataTexture}. */
export interface DataTextureOptions {
  /** Sampling filter. Default `'nearest'`. */
  filter?: 'nearest' | 'linear'
}

/**
 * An `rgba8` texture whose texels the CPU owns, for feeding a {@link ShaderQuad}
 * data that changes while it runs.
 *
 * Write into `data`, then call {@link DataTexture.markDirty}. The texture
 * uploads on the next draw that binds it, once per version however many draws
 * share it. Texel `(x, y)` is at byte `(y * width + x) * 4`, and row 0 samples
 * at `v = 0`.
 *
 * Upload goes through an `ImageData`, so a texel with alpha below 255 can lose
 * its colour channels. `data` starts opaque, so leave alpha alone unless the
 * shader reads it.
 *
 * Uploads are not ordered against draws already recorded this frame. Every draw
 * that samples the texture sees the contents as they stood when the last of
 * them was recorded, so write the texture once per frame before drawing.
 */
export class DataTexture {
  readonly width: number
  readonly height: number
  readonly filter: 'nearest' | 'linear'
  readonly data: Uint8ClampedArray
  #version = 1

  constructor(width: number, height: number, opts: DataTextureOptions = {}) {
    this.width = Math.max(1, Math.floor(width))
    this.height = Math.max(1, Math.floor(height))
    this.filter = opts.filter ?? 'nearest'
    this.data = new Uint8ClampedArray(this.width * this.height * 4)
    this.data.fill(255)
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = 0
      this.data[i + 1] = 0
      this.data[i + 2] = 0
    }
  }

  /** Increments on every {@link DataTexture.markDirty}. */
  get version(): number {
    return this.#version
  }

  /** Flag `data` as changed so the next draw that binds it re-uploads. */
  markDirty(): void {
    this.#version++
  }
}

/** Options for creating a {@link ShaderQuad}. */
export interface ShaderQuadOptions {
  shader: QuadShaderSource
  /** Byte size of the shader's `Params` block, std140. `0` for none. */
  paramsBytes?: number
  /** Up to 4, bound at `u_tex0` to `u_tex3`. */
  textures?: readonly DataTexture[]
  /** Debug label surfaced in backend error messages. */
  label?: string
}

/**
 * A rectangle drawn with the caller's own shader. Draw it with
 * `Gfx2D.drawShaderQuad`.
 *
 * `params` is a live view of the shader's `Params` block. Each draw snapshots
 * it, so one quad drawn twice with different values in between renders both.
 */
export class ShaderQuad {
  readonly shader: QuadShaderSource
  readonly paramsBytes: number
  readonly textures: readonly DataTexture[]
  readonly label: string
  readonly params: Float32Array

  constructor(opts: ShaderQuadOptions) {
    const textures = opts.textures ?? []
    if (textures.length > MAX_QUAD_TEXTURES) {
      throw new StargazerError(
        'SG2024',

        `ShaderQuad: ${textures.length} textures, the limit is ${MAX_QUAD_TEXTURES}`,
      )
    }
    const paramsBytes = Math.ceil((opts.paramsBytes ?? 0) / 16) * 16
    if (paramsBytes > MAX_QUAD_PARAMS_BYTES) {
      throw new StargazerError(
        'SG2024',

        `ShaderQuad: ${paramsBytes} bytes of params, the limit is ${MAX_QUAD_PARAMS_BYTES}`,
      )
    }
    this.shader = opts.shader
    this.paramsBytes = paramsBytes
    this.textures = textures
    this.label = opts.label ?? 'shaderQuad'
    this.params = new Float32Array(this.paramsBytes / 4)
  }
}
