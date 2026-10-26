// Enum maps from the backend-neutral `GfxDevice` vocabulary to the WebGPU
// enums. `GfxDevice` names that match WebGPU ones pass through unconverted.

import type {
  ColorFormat,
  ColorState,
  DepthStencilFormat,
  GfxBlendMode,
  IndexType,
  PipelineDesc,
  StencilFaceState,
  TargetPixelFormat,
  TexturePixelFormat,
} from '../GfxDevice'
import {
  hasDepthAspect,
  hasStencilAspect,
  resolveDepthStencil,
} from '../depthStencil'

/**
 * Color-target format -> WebGPU texture format. `'canvas'` is the format the
 * canvas context was configured with, which the caller passes in.
 */
export function colorFormatToGPU(
  f: ColorFormat,
  canvasFormat: GPUTextureFormat = 'rgba8unorm',
): GPUTextureFormat {
  if (f === 'canvas') return canvasFormat
  return f === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm'
}

/**
 * Pixel-layout override -> WebGPU texture format, for a non-color-managed
 * target (a coverage mask). `'rgba8'` defers to {@link colorFormatToGPU}'s
 * `'linear'` case rather than being a case of its own, so the two stay in
 * sync.
 */
export function targetPixelFormatToGPU(f: TargetPixelFormat): GPUTextureFormat {
  switch (f) {
    case 'rgba8':
      return colorFormatToGPU('linear')
    case 'r8':
      return 'r8unorm'
    case 'rg8':
      return 'rg8unorm'
  }
}

/**
 * A sampled texture's pixel layout -> WebGPU texture format. `srgb` applies to
 * `'rgba8'` only.
 */
export function texturePixelFormatToGPU(
  f: TexturePixelFormat,
  srgb: boolean,
): GPUTextureFormat {
  if (f === 'rgba16f') return 'rgba16float'
  if (f === 'rgba8' && srgb) return 'rgba8unorm-srgb'
  return targetPixelFormatToGPU(f)
}

/** Bytes per texel of a sampled texture's pixel layout. */
export function texturePixelBytes(f: TexturePixelFormat): number {
  switch (f) {
    case 'rgba8':
      return 4
    case 'r8':
      return 1
    case 'rg8':
      return 2
    case 'rgba16f':
      return 8
  }
}

/**
 * Factors of the fixed-function blends beyond over and additive, on
 * premultiplied color. `multiply` is exact only over an opaque backdrop.
 */
const BLEND_FACTORS = {
  screen: { src: 'one', dst: 'one-minus-src' },
  multiply: { src: 'dst', dst: 'one-minus-src-alpha' },
  'destination-out': { src: 'zero', dst: 'one-minus-src-alpha' },
  'destination-in': { src: 'zero', dst: 'src-alpha' },
  xor: { src: 'one-minus-dst-alpha', dst: 'one-minus-src-alpha' },
} as const satisfies Record<
  string,
  { src: GPUBlendFactor; dst: GPUBlendFactor }
>

/**
 * Blend mode -> WebGPU blend state, or `undefined` for no blending. Colors are
 * premultiplied end-to-end, so `'source-over'` uses a `'one'` source factor
 * (the shader already multiplied rgb by alpha) rather than `'src-alpha'`.
 */
function blendToGPU(mode: GfxBlendMode): GPUBlendState | undefined {
  if (mode === 'none') return undefined
  if (mode === 'lighter') {
    // Additive: src + dst for both color and alpha.
    return {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    }
  }
  const extra = BLEND_FACTORS[mode as keyof typeof BLEND_FACTORS]
  if (extra) {
    const part = {
      srcFactor: extra.src,
      dstFactor: extra.dst,
      operation: 'add' as const,
    }
    return { color: part, alpha: part }
  }
  // 'source-over' premultiplied over: src + dst * (1 - srcAlpha).
  return {
    color: {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    },
    alpha: {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    },
  }
}

/**
 * `GPUColorWrite.ALL`. Spelled as its value so this module stays free of WebGPU
 * runtime globals and can be exercised outside a browser.
 */
const COLOR_WRITE_ALL = 0xf

/**
 * Color-target state -> WebGPU color target. A `write` of `false` becomes a
 * zero write mask, which keeps the fragment stage and its depth/stencil side
 * effects while leaving the color attachment untouched.
 */
export function colorTargetToGPU(
  color: ColorState,
  canvasFormat: GPUTextureFormat = 'rgba8unorm',
): GPUColorTargetState {
  return {
    format: color.pixelFormat
      ? targetPixelFormatToGPU(color.pixelFormat)
      : colorFormatToGPU(color.format, canvasFormat),
    blend: blendToGPU(color.blend),
    writeMask: color.write === false ? 0 : COLOR_WRITE_ALL,
  }
}

/** One facing's stencil state -> WebGPU, filling in the pass-through defaults. */
function stencilFaceToGPU(f: StencilFaceState): GPUStencilFaceState {
  return {
    compare: f.compare ?? 'always',
    failOp: f.failOp ?? 'keep',
    depthFailOp: f.depthFailOp ?? 'keep',
    passOp: f.passOp ?? 'keep',
  }
}

/** Depth-stencil aspects -> the WebGPU texture format carrying them. */
export function depthStencilFormatToGPU(
  f: DepthStencilFormat,
): GPUTextureFormat | null {
  switch (f) {
    case 'none':
      return null
    case 'depth':
      return 'depth24plus'
    case 'stencil':
      return 'stencil8'
    case 'depth-stencil':
      return 'depth24plus-stencil8'
  }
}

/**
 * A pipeline's depth-stencil state, or `undefined` for a pipeline that draws
 * into no depth-stencil attachment.
 *
 * WebGPU requires state for every aspect the attachment format carries and
 * rejects state for an aspect it does not, so the format drives this rather
 * than the state the caller asked for. An aspect the pipeline declares no state
 * for gets an inert one: writes off, and a comparison that always passes.
 */
export function depthStencilToGPU(
  desc: PipelineDesc,
): GPUDepthStencilState | undefined {
  const aspects = resolveDepthStencil(desc)
  const format = depthStencilFormatToGPU(aspects)
  if (!format) return undefined
  const state: GPUDepthStencilState = { format }

  if (hasDepthAspect(aspects)) {
    const d = desc.depth
    state.depthWriteEnabled = d ? d.write : false
    state.depthCompare = d
      ? d.test
        ? (d.compare ?? 'less-equal')
        : 'always'
      : 'always'
    // Bias belongs to the pipeline that asked for depth. Applying one to an
    // inert aspect would be rejected on a line-list topology.
    if (d) {
      state.depthBias = d.biasConstant ?? 0
      state.depthBiasSlopeScale = d.biasSlopeScale ?? 0
    }
  }

  if (hasStencilAspect(aspects)) {
    const st = desc.stencil
    const front = stencilFaceToGPU(st ? st.front : {})
    state.stencilFront = front
    state.stencilBack = st ? stencilFaceToGPU(st.back ?? st.front) : front
    state.stencilReadMask = st?.readMask ?? 0xff
    // A zero write mask is what makes the inert case inert. A real state keeps
    // the full mask unless it narrowed one itself.
    state.stencilWriteMask = st ? (st.writeMask ?? 0xff) : 0
  }

  return state
}

/** Index element width -> WebGPU index format. */
export function indexTypeToGPU(t: IndexType): GPUIndexFormat {
  return t === 'u32' ? 'uint32' : 'uint16'
}

/**
 * A sample count WebGPU accepts. A render target takes 1 or 4 samples and
 * rejects every other count, so 2 and 3 become 4 and anything above 4 is
 * capped.
 */
export function sampleCountToGPU(samples: number): 1 | 4 {
  return samples >= 2 ? 4 : 1
}

/** Round a byte size up to a multiple of 4 (WebGPU buffer size requirement). */
export function roundUp4(n: number): number {
  return (n + 3) & ~3
}
