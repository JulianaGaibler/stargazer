/**
 * Helpers for testing code that uses stargazer without a GPU or a browser
 * canvas.
 *
 * {@link MockGfxDevice} is a device that records every pipeline, pass and draw
 * instead of running them. {@link createPostChain} runs post effects on a
 * device. {@link setTextMeasurer} gives text a size in an environment that has
 * no 2D context. {@link setSmoothCornerFieldLoader} stops smooth corners from
 * fetching their data file.
 *
 * @module testing
 */
import type { GfxDevice } from './render/gfx/GfxDevice'
import { RenderTargetPool } from './render/gfx/RenderTargetPool'
import { PostChain } from './render/postfx/PostChain'
import { PostProgramCache } from './render/postfx/PostProgramCache'

export { MockGfxDevice } from './render/gfx/webgl2/mockGfxDevice'
export { setTextMeasurer } from './render/gfx/rasterizeLabel'
export { setSmoothCornerFieldLoader } from './render/gfx/squircleField'
export type { PostChain }

/**
 * Builds the chain that runs {@link PostEffect}s over a source texture on
 * `device`, with its own shader cache and target pool.
 *
 * Pipelines compile asynchronously. Call `chain.prepare(effects, colorSpace)`
 * until it returns true before `chain.run`.
 */
export function createPostChain(device: GfxDevice): PostChain {
  return new PostChain(
    device,
    new PostProgramCache(device),
    new RenderTargetPool(device),
  )
}
