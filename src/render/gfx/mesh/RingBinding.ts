// A cached bind group over a dynamic-offset uniform ring.

import type { BindGroup, BindGroupLayout, GfxDevice } from '../GfxDevice'
import type { UboRing } from '../programs/programCommon'

/** A bind group over a ring's buffer, rebuilt when the ring replaces it. */
export class RingBinding {
  readonly #ring: UboRing
  readonly #layout: BindGroupLayout
  readonly #binding: number
  readonly #size: number
  #group: BindGroup | null = null
  #generation = -1

  constructor(
    ring: UboRing,
    layout: BindGroupLayout,
    binding: number,
    size: number,
  ) {
    this.#ring = ring
    this.#layout = layout
    this.#binding = binding
    this.#size = size
  }

  group(device: GfxDevice): BindGroup {
    if (!this.#group || this.#generation !== this.#ring.generation) {
      this.#generation = this.#ring.generation
      this.#group = device.createBindGroup(this.#layout, [
        {
          binding: this.#binding,
          resource: { uniformBuffer: this.#ring.buffer, size: this.#size },
        },
      ])
    }
    return this.#group
  }
}
