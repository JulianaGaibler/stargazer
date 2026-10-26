// Resolves material texture slots to GPU textures: uploads decoded images once
// per sampler variant, decodes pending images asynchronously and feeds the
// model texture inspector.

import type { GfxDevice, Texture } from '../GfxDevice'
import type {
  MaterialTexture,
  TextureImage,
  TextureSampler,
} from '../../../nodes/MeshNode'
import type { RenderQuality } from '../../RenderQuality'
import type { TextureInspector } from '../TextureManager'
import { ModelTextureInspector } from '../ModelTextureInspector'

export class MeshTextures {
  readonly #device: GfxDevice
  readonly #quality: RenderQuality
  #texCache = new WeakMap<TextureImage, Map<number, Texture>>()
  #decoding = new Set<TextureImage>()
  readonly #inspector = new ModelTextureInspector()
  #uploaded = new Set<Texture>()
  #epoch = 0

  constructor(device: GfxDevice, quality: RenderQuality) {
    this.#device = device
    this.#quality = quality
  }

  /** Forget every texture without freeing, for a lost context. */
  reset(): void {
    this.#texCache = new WeakMap()
    this.#decoding.clear()
    this.#uploaded.clear()
    this.#epoch++
  }

  get inspector(): TextureInspector | null {
    return this.#inspector.hasEntries ? this.#inspector : null
  }

  /** Resolve a material texture slot to a GPU texture (tracking + async decode). */
  resolve(
    slot: MaterialTexture | null | undefined,
    samplerName: string,
  ): Texture | null {
    if (!slot) return null
    this.#inspector.track(slot.image, samplerName)
    return this.#ensureTexture(slot.image, slot.srgb, slot.sampler)
  }

  #ensureTexture(
    image: TextureImage,
    srgb: boolean,
    sampler: TextureSampler,
  ): Texture | null {
    const key =
      (srgb ? 1 : 0) +
      (sampler.wrap === 'repeat' ? 2 : 0) +
      (sampler.mipmap ? 4 : 0)
    let variants = this.#texCache.get(image)
    const cached = variants?.get(key)
    if (cached) return cached
    const bmp = image.bitmap
    if (!bmp) {
      this.#decodeImageAsync(image)
      return null
    }
    const device = this.#device
    const tex = device.createTexture2D({
      width: bmp.width,
      height: bmp.height,
      filter: 'linear',
      wrap: sampler.wrap,
      srgb,
      mipmap: sampler.mipmap,
      anisotropy: sampler.mipmap ? this.#quality.anisotropy : 1,
    })
    // Object-space (mesh) UVs: the WebGPU backend must not apply its 2D
    // render-origin V-flip, or the texture samples upside-down.
    device.updateTexture2D(tex, bmp, {
      flipY: false,
      premultiply: false,
      objectSpaceUV: true,
    })
    this.#inspector.setUploadedSize(image, bmp.width, bmp.height)
    bmp.close()
    image.bitmap = null
    if (!variants) {
      variants = new Map()
      this.#texCache.set(image, variants)
    }
    variants.set(key, tex)
    this.#uploaded.add(tex)
    return tex
  }

  #decodeImageAsync(image: TextureImage): void {
    if (this.#decoding.has(image) || image.bitmap || !image.bytes) return
    this.#decoding.add(image)
    const epoch = this.#epoch
    const blob = new Blob([image.bytes as BlobPart], { type: image.mimeType })
    void createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      imageOrientation: 'none',
      colorSpaceConversion: 'none',
    }).then(
      (bmp) => {
        this.#decoding.delete(image)
        if (epoch !== this.#epoch) bmp.close()
        else image.bitmap = bmp
      },
      () => {
        this.#decoding.delete(image)
      },
    )
  }

  destroy(): void {
    for (const tex of this.#uploaded) this.#device.deleteTexture(tex)
    this.#uploaded.clear()
    this.#inspector.clear()
  }
}
