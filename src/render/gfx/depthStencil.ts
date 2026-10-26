// Canonical resolution of a depth-stencil format, shared by both backends and
// by `pipelineKey`. A pipeline's format has to be derived the same way
// everywhere: if the cache key resolves a descriptor differently from the
// backend that compiles it, one pipeline gets stored under two keys, or worse,
// two get stored under one.

import type {
  DepthStencilFormat,
  PipelineDesc,
  RenderTarget,
  RenderTargetOpts,
} from './GfxDevice'

/** Whether a format carries a depth aspect. */
export function hasDepthAspect(f: DepthStencilFormat): boolean {
  return f === 'depth' || f === 'depth-stencil'
}

/** Whether a format carries a stencil aspect. */
export function hasStencilAspect(f: DepthStencilFormat): boolean {
  return f === 'stencil' || f === 'depth-stencil'
}

/**
 * The attachment format a pipeline draws into. An explicit
 * {@link PipelineDesc.depthStencil} wins. Otherwise it follows the state the
 * pipeline asked for, which is correct whenever a pipeline uses every aspect
 * its target carries.
 *
 * @remarks
 *   Maintainers: both backends and `pipelineKey` call this one function, so the
 *   cache key and the compiled descriptor always agree on the format. WebGPU
 *   rejects a pipeline whose format differs from its pass's attachment, so
 *   every pipeline in a pass names the same format, including 2D pipelines that
 *   test neither depth nor stencil. Such a pipeline sets `depthStencil` and
 *   leaves `depth` and `stencil` null. The backend then supplies the inert
 *   state: writes off and an always-pass compare for depth, and all-`keep`
 *   operations with a zero write mask for stencil.
 */
export function resolveDepthStencil(desc: PipelineDesc): DepthStencilFormat {
  if (desc.depthStencil) return desc.depthStencil
  if (desc.depth) return 'depth'
  if (desc.stencil) return 'stencil'
  return 'none'
}

/** The format a live target carries, for a renderer building pipelines for it. */
export function depthStencilFormatOf(rt: RenderTarget): DepthStencilFormat {
  if (rt.hasDepth) return rt.hasStencil ? 'depth-stencil' : 'depth'
  return rt.hasStencil ? 'stencil' : 'none'
}

/**
 * The format a set of target options asks for. `depthSampled` takes the depth
 * aspect alone: its attachment is a sampleable depth-only texture, so stencil
 * bits requested alongside it are not allocated and must not be reported.
 *
 * @remarks
 *   Maintainers: WebGL2 samples depth only from a `DEPTH_COMPONENT24` texture,
 *   which has no stencil bits. Reporting stencil there would make WebGL2 differ
 *   from WebGPU for the same options. The ambient occlusion G-buffer is the
 *   sampled target in practice.
 */
export function depthStencilFormatFor(
  opts: RenderTargetOpts,
): DepthStencilFormat {
  const depth = !!opts.depth
  const stencil = !!opts.stencil && !(depth && !!opts.depthSampled)
  if (depth) return stencil ? 'depth-stencil' : 'depth'
  return stencil ? 'stencil' : 'none'
}
