---
title: Vector particles
group: Features
order: 16
---

# Vector particles

{@link VectorParticleNode} is a base class for particle bursts in which your own vector code draws each piece. Use it when one burst mixes shapes, such as triangles and line shards, or when pieces need their own spin or despawn rules. After this guide you can write a burst class, add per-particle data, and remove the node when its particles are gone. The `particles-custom` demo (`?demo=particles-custom`) shows a burst.

The base class stores position, velocity and angle for a fixed number of particles and moves them every frame. Your subclass spawns each particle and paints it with the {@link Canvas} drawing calls. When one baked sprite per emitter is enough, a {@link ParticleEmitterNode} from the [Particles guide](/guides/particles) needs no subclass.

## Basic usage

This burst of triangles and line shards slows down, despawns and then removes its node.

```ts
import { VectorParticleNode } from '@julianagaibler/stargazer'
import type {
  Canvas,
  SceneTree,
  Vec2,
  VectorParticleSpawnInit,
} from '@julianagaibler/stargazer'

declare const scene: SceneTree

const TRI = new Float32Array([0, -6, 5, 3, -5, 3])

class ShrapnelBurst extends VectorParticleNode {
  readonly #kind: Uint8Array

  constructor(center: Vec2, count: number) {
    super({ capacity: count, dampingPerSec: 3 })
    this.#kind = new Uint8Array(count)
    this.transform.x = center.x
    this.transform.y = center.y
    this.burst(count)
    void this.autoDestroy(this.waitUntilEmpty())
  }

  protected override spawnParticle(
    i: number,
    out: VectorParticleSpawnInit,
  ): void {
    const theta = Math.random() * Math.PI * 2
    const speed = 100 + Math.random() * 100
    out.vx = Math.cos(theta) * speed
    out.vy = Math.sin(theta) * speed
    out.angle = theta
    out.speed0 = speed
    this.#kind[i] = Math.random() < 0.6 ? 0 : 1
  }

  protected override paintParticle(canvas: Canvas, i: number): void {
    if (this.#kind[i] === 0) {
      canvas.fillConvexPoly(TRI, 3, '#ffd34d')
    } else {
      canvas.strokeLine(-6, 0, 6, 0, { color: '#ffd34d', width: { screen: 2 } })
    }
  }

  protected override shouldDespawn(i: number): boolean {
    const speed0 = this.speed0[i]
    return speed0 > 0 && Math.hypot(this.vx[i], this.vy[i]) < 0.02 * speed0
  }
}

scene.root.add(new ShrapnelBurst({ x: 400, y: 300 }, 24))
```

The constructor spawns 24 pieces at the node's origin. Each frame the base class applies drag and moves them. A piece despawns once its speed falls under 2% of its launch speed. When none are left, `waitUntilEmpty()` resolves and `autoDestroy` removes the node.

### Spawn and paint hooks

`spawnParticle(i, out)` runs once per particle during `burst(count)`. Fill `out` with the node-local `x`, `y`, `vx`, `vy`, `angle` and `speed0`, and any field you leave out stays 0. `out` is one reused object, so copy values out of it and keep no reference. Set `speed0` to the launch speed when `shouldDespawn` or `paintParticle` compares against it.

`paintParticle(canvas, i)` paints one particle. The base class has already moved the origin to the particle's position and rotated it by its angle, so paint around `(0, 0)` facing angle 0.

### Extra per-particle data

The base class owns the `x`, `y`, `vx`, `vy`, `angle`, `speed0` and `alive` arrays. Add your own typed arrays sized to `capacity` for anything else, and index them with the same `i`. This burst gives each piece a spin and turns it every frame in `updateExtra`, which runs once per live particle after the base class moves it.

```ts
class SpinningBurst extends VectorParticleNode {
  readonly #spin = new Float32Array(this.capacity)

  constructor(count: number) {
    super({ capacity: count })
    this.burst(count)
  }

  protected override spawnParticle(
    i: number,
    out: VectorParticleSpawnInit,
  ): void {
    out.vx = Math.random() * 100 - 50
    out.vy = Math.random() * 100 - 50
    this.#spin[i] = (Math.random() * 2 - 1) * 8
  }

  protected override paintParticle(canvas: Canvas): void {
    canvas.fillConvexPoly(TRI, 3, '#89d5ff')
  }

  protected override updateExtra(i: number, dt: number): void {
    this.angle[i] += this.#spin[i] * dt
  }
}
```

The triangles tumble as they drift apart. `angle` changes when your code changes it, so each piece keeps its spawn angle until `updateExtra` turns it.

### Permanent debris

When a subclass keeps the default `shouldDespawn`, its particles stay until something destroys the node. They settle and stay, which suits debris that remains on screen. Put such bursts under one parent node, and call [`destroyChildren`](/module/scene/node#destroychildren) on the parent to clear them, for example at a level reset.

```ts
import { Node2D } from '@julianagaibler/stargazer'

const debris = new Node2D()
scene.root.add(debris)
debris.add(new SpinningBurst(30))

// At a level reset.
debris.destroyChildren()
```

## Advanced usage

### Motion model

Each frame, for each live particle, the base class applies drag, adds the acceleration and moves the particle. It then calls `updateExtra` and `shouldDespawn`. {@link VectorParticleNodeOptions} sets `capacity`, `dampingPerSec` and `accelerationWorld`. The motion matches {@link ParticleEmitter} minus lifetime and spin, and {@link VectorParticleNode.onUpdate} documents the steps.

### Bursts and capacity

`burst(count)` and `kill(i)` are protected, so only the subclass calls them. Expose a public method if outside code should trigger more bursts. `burst` stops early when every slot is in use.

```ts
class Fountain extends VectorParticleNode {
  constructor() {
    super({ capacity: 200, accelerationWorld: { x: 0, y: 600 } })
  }

  fire(count: number): void {
    this.burst(count)
  }

  protected override spawnParticle(
    _i: number,
    out: VectorParticleSpawnInit,
  ): void {
    out.vx = Math.random() * 80 - 40
    out.vy = -300 - Math.random() * 100
  }

  protected override paintParticle(canvas: Canvas): void {
    canvas.fillConvexPoly(TRI, 3, '#ffd34d')
  }
}
```

Other code calls `fountain.fire(20)` whenever it wants more particles.

### Spawn order

`burst(count)` calls `spawnParticle` synchronously for each slot before it claims the next one. To give each particle a value computed outside, set a field and call `burst(1)` in a loop.

```ts
const step = (Math.PI * 2) / count
for (let k = 0; k < count; k++) {
  this.#pendingTheta = k * step
  this.burst(1) // spawnParticle reads this.#pendingTheta
}
```

### Waiting for a burst

[`waitUntilEmpty()`](/module/nodes/vectorparticlenode#waituntilempty) resolves when the live count reaches 0, or right away when it is already 0. Call it right after the `burst()` it tracks, in the same synchronous run of code. Destroying the node kills every particle and resolves a pending promise.

### Paint cost

The node repaints every frame while any particle is alive, and once more after the last one dies. Each repaint records every live particle again. When pieces only move and keep their shape, one child node per piece costs less, because moving a node replays its picture and repaints nothing.

### Reading state

[`aliveCount`](/module/nodes/vectorparticlenode#alivecount) and `particleCount` return the live particle count. Free slots are `capacity` minus `aliveCount`.

## Common problems

A burst that you wait on with `waitUntilEmpty()` keeps running forever. The subclass keeps the default `shouldDespawn`, which returns `false`, so its particles live until the node is destroyed. Override `shouldDespawn` to return `true` when a piece is done, as `ShrapnelBurst` does.

Every piece starts at the same point or with the wrong velocity. `out` holds zeros at the start of each `spawnParticle` call, so set every field you need, including `speed0` when `shouldDespawn` reads it.

The `waitUntilEmpty()` promise resolves at once. It ran while no particle was alive. Call it right after `burst()`.

## Next step

Learn how a custom node records its drawing in the [Drawing guide](/guides/drawing).

## See also

- {@link VectorParticleNode}: base class with the spawn, paint, update and despawn hooks
- {@link VectorParticleSpawnInit}: spawn state filled by `spawnParticle`
- {@link VectorParticleNodeOptions}: capacity, damping and acceleration
- {@link Canvas}: drawing calls for `paintParticle`
- [Particles](/guides/particles): the baked sprite particle system
- [Drawing](/guides/drawing): the `Canvas` recorder and `paint`
