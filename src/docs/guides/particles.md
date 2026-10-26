---
title: Particles
group: Features
order: 15
---

# Particles

A {@link ParticleEmitterNode} draws many small sprites that move, fade and die on their own, such as trails, sparks, explosions and confetti. After this guide you can add a continuous trail, fire one-shot bursts, remove a burst when it ends, and shape particles with a {@link ParticleEmitterConfig}. The `particles` demo (`?demo=particles`) shows these effects.

Each particle is one baked sprite, scaled and faded by curves you set in the config. For particles with vector shapes of their own, such as triangles and line shards mixed in one burst, see the [Vector particles guide](/guides/vector-particles).

## Basic usage

This example adds a continuous trail to the scene and moves its emission point each frame.

```ts
import { ParticleEmitterNode } from '@julianagaibler/stargazer'
import type { SceneTree } from '@julianagaibler/stargazer'

declare const scene: SceneTree
declare const pointerWorld: { x: number; y: number }

const trail = new ParticleEmitterNode({
  config: {
    capacity: 500,
    ratePerSec: 90,
    lifetimeSec: [0.5, 1.1],
    speedWorld: [10, 40],
    spreadRad: Math.PI * 0.35,
    sizeWorld: [12, 24],
    palette: ['#ffd34d', '#ffb347', '#ff8f6b'],
    dampingPerSec: 1.6,
    scaleOverLife: [1, 0.3],
    alphaOverLife: [1, 0],
  },
})
scene.root.add(trail)

// Each frame, from wherever your logic wants the trail.
trail.emitter.setOrigin(pointerWorld.x, pointerWorld.y)
```

The node spawns 90 particles per second at the origin. Each particle gets a random lifetime, speed, size and palette color from the ranges, slows down, shrinks to 30% of its size and fades out before it dies. Particles leave in every direction until you set `emitDirectionRad`. The node updates its {@link ParticleEmitter} every frame and paints the live particles.

### Bursts

A burst emits a number of particles at one point right away. Set `ratePerSec: 0` for an emitter that fires only bursts.

```ts
const sparks = new ParticleEmitterNode({
  config: {
    capacity: 300,
    ratePerSec: 0,
    lifetimeSec: [0.4, 0.9],
    speedWorld: [200, 400],
    spreadRad: Math.PI / 4,
    sizeWorld: [6, 12],
    palette: ['#ffffff', '#89d5ff'],
    dampingPerSec: 4,
    spriteStyle: 'disc',
    blend: 'source-over',
  },
})
scene.root.add(sparks)

sparks.emitter.burst(200, 960, 540)
// Aim a cone along +x for this burst only.
sparks.emitter.burst(100, 960, 540, 0)
```

The first call sends 200 sparks in every direction from the middle of the world, because the config sets no axis. The last argument sets an axis in radians for one call, with 0 pointing along +x, and the sparks spread up to `spreadRad` to each side of it. A continuous stream and bursts can share one emitter.

### Remove a burst when it ends

For a one-shot burst, pair [`waitUntilEmpty`](/module/particles/particleemitter#waituntilempty) with [`autoDestroy`](/module/scene/node#autodestroy). The node destroys itself once its last particle dies.

```ts
import type { ParticleEmitterConfig } from '@julianagaibler/stargazer'

declare const config: ParticleEmitterConfig

const burst = new ParticleEmitterNode({ config })
burst.emitter.burst(120, 400, 300)
void burst.autoDestroy(burst.emitter.waitUntilEmpty())
scene.root.add(burst)
```

`waitUntilEmpty()` resolves when the live count reaches 0. Call it right after the `burst()` it tracks, in the same synchronous run of code.

### Coordinate space

Particles live in the node's local space, and `setOrigin` and `burst` take local points. A node under `scene.root` with no transform uses world coordinates.

```ts
import type { Node2D } from '@julianagaibler/stargazer'

declare const ship: Node2D

const aura = new ParticleEmitterNode({ config })
ship.add(aura) // particles move and turn with the ship
scene.root.add(trail) // particles stay at their emission point
```

A node under a moving node carries its particles along, which suits a glow attached to an object. For a trail that stays behind in the world, add the node to the root and move the origin.

## Advanced usage

### Config options

Every range in the config is `[min, max]` and is sampled uniformly once, when the particle spawns. This example adds gravity and a tumble to a burst of debris.

```ts
const debris = new ParticleEmitterNode({
  config: {
    capacity: 200,
    ratePerSec: 0,
    lifetimeSec: [0.8, 1.4],
    speedWorld: [150, 320],
    emitDirectionRad: -Math.PI / 2,
    spreadRad: Math.PI / 3,
    sizeWorld: [8, 14],
    palette: ['#c9b79c', '#8a7d6b'],
    spriteStyle: 'square',
    blend: 'source-over',
    accelerationWorld: { x: 0, y: 900 },
    spinRadPerSec: [-6, 6],
  },
})
```

The debris launches upward in a cone of 60 degrees on each side of the axis, then falls under gravity while it tumbles in both directions. {@link ParticleEmitterConfig} documents every option and its default. A `spreadRad` of `Math.PI` covers every direction around the axis, and the emitter uses `spreadRad` only when `emitDirectionRad` or the `burst` axis is set.

### Motion model

Each frame, the emitter first spawns `ratePerSec * dt` particles and carries the fraction over to the next frame. It then slows every live particle by `dampingPerSec`, adds `accelerationWorld`, moves it, turns it by its spin and counts its life down. A particle dies when its life reaches 0, so a higher `dampingPerSec` brings particles to rest sooner. {@link ParticleEmitter.update} documents the step.

### Rotation

`spinRadPerSec` gives each particle a constant angular velocity, sampled with its sign. `[-6, 6]` makes particles tumble both ways. Leave it out and the node draws every sprite unrotated.

### Scale driven by speed

`scaleBy: 'speed'` makes `scaleOverLife` follow the particle's speed instead of its age. A fast particle draws at the first value and a nearly stopped one at the second. Alpha follows lifetime.

```ts
const dust = new ParticleEmitterNode({
  config: {
    capacity: 150,
    ratePerSec: 0,
    lifetimeSec: [1, 2],
    speedWorld: [100, 260],
    spreadRad: Math.PI,
    sizeWorld: [10, 20],
    palette: ['#d9d2c3'],
    dampingPerSec: 3,
    scaleOverLife: [1, 0],
    scaleBy: 'speed',
  },
})
```

The dust shrinks away as it slows down, whatever its remaining lifetime.

### Early despawn

`minSpeedFrac` kills a particle once its speed falls under that fraction of its own launch speed, even when its lifetime has time left. Add it to the dust config and the burst removes itself as soon as it settles.

```ts
const settling = new ParticleEmitterNode({
  config: { ...dust.emitter.config, minSpeedFrac: 0.02 },
})
settling.emitter.burst(80, 600, 400)
void settling.autoDestroy(settling.emitter.waitUntilEmpty())
scene.root.add(settling)
```

The upper bound of `lifetimeSec` ends particles that keep their speed.

### Sprite styles and blend

`spriteStyle` picks the sprite shape, and `blend` decides how overlapping particles combine. `blend: 'lighter'`, the default, adds them together so dense areas glow brighter. `blend: 'source-over'` paints them over each other. {@link ParticleSpriteStyle} lists the styles and what each pairs with. The burst example earlier on this page uses `'disc'` with `'source-over'` for sharp sparks.

The node scales each style's tile to the particle's size. {@link getParticleSprite} returns the cached tile for a color and style. The cache keeps each tile for the life of the page, and {@link clearParticleSpriteCache} empties it for tests and teardown.

### Reading state

```ts
console.log(trail.emitter.aliveCount, trail.emitter.pool.availableCount)
```

`aliveCount` is the live particle count and `pool.availableCount` is the number of free slots. [`particleCount`](/module/scene/node2d#particlecount) on any `Node2D` returns the live count of a particle node, and the debug HUD sums it across the scene.

### Cleanup

[`clear()`](/module/particles/particleemitter#clear) kills every particle and resets the emission accumulator. Destroying the node clears the emitter too, so a pending `waitUntilEmpty()` promise resolves.

## Common problems

A burst shows fewer particles than you asked for. The pool holds `capacity` particles, and `burst` stops when it is full. Raise `capacity`, or check `emitter.pool.availableCount` before the burst.

A one-shot burst disappears on the first frame. `waitUntilEmpty()` ran before the `burst()` and resolved at once, because no particle was alive. Call it right after `burst()`.

A trail follows its parent when it should stay behind. Particles live in the node's local space. Add the node to `scene.root` and call `setOrigin` with the world position.

## Next step

Draw particles with their own vector shapes in the [Vector particles guide](/guides/vector-particles).

## See also

- {@link ParticleEmitterNode}: scene node that updates and paints an emitter
- {@link ParticleEmitter}: pool, emission and motion
- {@link ParticleEmitterConfig}: every emitter option
- {@link ParticlePool}: typed-array storage with a free list
- {@link VectorParticleNode}: particles with custom vector shapes
- [Vector particles](/guides/vector-particles): per-particle shapes and despawn rules
- [Scene](/guides/scene): nodes, `onUpdate` and `autoDestroy`
- [Debugging](/guides/debugging): the HUD's particle count
