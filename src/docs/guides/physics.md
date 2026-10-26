---
title: Physics
group: Features
order: 17
---

# Physics

Stargazer has an optional 2D rigid-body physics engine. A {@link PhysicsWorld} moves {@link Body} objects under gravity and forces, resolves collisions between their {@link Collider} shapes, and reports contacts and sensor overlaps as events. It also answers raycasts and region queries. After this page you can drop bodies into a scene, make nodes follow them, react to collisions, and query the world.

Turn physics on with the `physics` option of the host or of a stage, or give part of the scene its own world with a {@link PhysicsWorldBehavior}. {@link RigidBodyBehavior} connects a body to a scene node, so the node follows the body.

## Basic usage

This example turns on physics for the primary stage, adds a static floor, and drops a box onto it.

```ts
import {
  createEngineHost,
  Node2D,
  RigidBodyBehavior,
  BodyType,
  aabbShape,
} from 'stargazer'

const host = createEngineHost({
  canvas,
  physics: { gravity: { x: 0, y: 900 } },
})
const world = host.engine.physics! // the primary stage's world

world.createBody({
  type: BodyType.Static,
  position: { x: 400, y: 560 },
  colliders: [{ shape: aabbShape(400, 10) }],
})

await host.loadScene((scene) => {
  const crate = new Node2D('crate')
  crate.transform.x = 400
  crate.transform.y = 100
  crate.addBehavior(
    new RigidBodyBehavior({
      bodyDef: {
        mass: 2,
        restitution: 0.3,
        colliders: [{ shape: aabbShape(16, 16) }],
      },
    }),
  )
  scene.root.add(crate)
})
host.start()
```

The crate node falls, bounces a little, and comes to rest at the floor's height. The engine steps the world once per fixed tick. To see the crate and the floor, add a camera and a {@link ShapeNode} for each, as in the [Getting started](/guides/getting-started) guide.

`physics: true` turns physics on with the default settings. A secondary stage gets its own world through [`StageOptions.physics`](/module/render/stageoptions#physics).

### Bodies and colliders

A body has a position, rotation, velocity, mass, and one or more colliders. [`createBody`](/module/physics/physicsworld#createbody) takes a {@link BodyDef} and adds the body to the world. An empty definition makes a dynamic body with mass 1 at the origin.

```ts
import { circleShape, polygonShape } from 'stargazer'

const ball = world.createBody({
  position: { x: 0, y: 0 },
  restitution: 0.6,
  friction: 0.2,
  colliders: [{ shape: circleShape(20) }],
})

const wedge = world.createBody({
  position: { x: 200, y: 0 },
  colliders: [
    {
      shape: polygonShape([
        { x: -20, y: 10 },
        { x: 0, y: -20 },
        { x: 20, y: 10 },
      ]),
    },
  ],
})
```

A collider takes a {@link Shape}: {@link circleShape}, {@link aabbShape} or {@link polygonShape}. An `aabbShape` box stays axis-aligned when its body rotates, so use a polygon for a box that should turn. A polygon needs convex, counter-clockwise vertices, and development builds throw when the winding is wrong. A collider's `offset` places it relative to the body origin, and the body derives its rotational inertia from its shapes.

### Body types

{@link BodyType} sets how a body moves. A `Static` body stays where it is, which suits floors and walls. A `Dynamic` body, the default, moves under gravity, forces and contacts. A `Kinematic` body moves by its own velocity and your code, and it pushes dynamic bodies.

```ts
const platform = world.createBody({
  type: BodyType.Kinematic,
  position: { x: 300, y: 400 },
  velocity: { x: 60, y: 0 },
  colliders: [{ shape: aabbShape(60, 8) }],
})
```

The platform slides right at 60 units per second and carries any dynamic body that rests on it. A contact between a dynamic body and a static or kinematic one moves the dynamic body. A contact between two bodies that are static or kinematic is reported as an event and moves neither. Set `fixedRotation: true` on a body that should keep its angle.

### Move bodies

Forces and impulses push a body, and setters place it. Each call wakes a sleeping body.

```ts
body.applyImpulse(0, -400) // changes velocity now, by impulse / mass
body.applyForce(120, 0) // added up until the next step
body.setPosition(300, 100) // places the body
```

{@link Body} also has methods for torque and for forces applied at a point. To move a body by hand, call `setPosition` and `setRotation`, which also tell the broad phase to index the body again.

### Follow a body with a node

{@link RigidBodyBehavior} creates a body from `bodyDef`, or binds an existing `body`. A new body starts at the node's position and rotation. Every frame the behavior copies the body's position and rotation to the node, interpolated between fixed steps with the ticker's `fixedAlpha`, so motion looks smooth at any display rate.

The body is the source of truth and the node follows it. The behavior writes the node's own transform, so put the node directly in physics space, under the scene root for the stage world or under the node that holds the world.

When the node joins a scene, the behavior adds the body to a world. It uses the `world` option if you pass one. Otherwise it uses the world of the nearest {@link PhysicsWorldBehavior} on the node or its ancestors, and then the primary stage's world. Nodes on a secondary stage pass `world: stage.physics` to use that stage's world. Removing the behavior or destroying the node removes the body.

### React to collisions

The world reports contacts through its [`events`](/module/physics/physicsworld#events) emitter.

```ts
world.events.on('collisionEnter', ({ a, b, manifold }) => {
  // a and b started touching this step
})
world.events.on('triggerEnter', ({ sensorBody, otherBody }) => {
  // otherBody entered a sensor
})
```

{@link PhysicsEvents} lists every event, including `collisionExit`, `triggerExit`, `sleep` and `wake`. Removing a body fires the exit events for everything it was touching. The world reuses the event objects, so read what you need inside the handler.

### Detect overlaps with sensors

A collider with `sensor: true` reports overlaps and lets bodies pass through. Use it for pickups, goal zones, and areas that start an event.

```ts
world.createBody({
  type: BodyType.Static,
  position: { x: 700, y: 300 },
  colliders: [{ shape: aabbShape(40, 40), sensor: true }],
})
```

The world fires `triggerEnter` when a body enters the box and `triggerExit` when it leaves.

## Advanced usage

### Give a subtree its own world

A {@link PhysicsWorldBehavior} gives a subtree its own world. The node it is attached to becomes the world's space node. Its world transform maps physics coordinates into the scene, so the subtree can sit anywhere. Each `RigidBodyBehavior` in its subtree uses this world instead of the stage world.

```ts
function buildArena(): Node2D {
  const arena = new Node2D('arena')
  arena.addBehavior(
    new PhysicsWorldBehavior({ config: { gravity: { x: 0, y: 0 } } }),
  )
  arena.add(buildBall()) // its RigidBodyBehavior binds to arena's world
  return arena
}

// Two arenas, two independent worlds.
scene.root.add(buildArena())
scene.root.add(buildArena())
```

The world exists once you construct the behavior, so you can add bodies through [`world`](/module/physics/physicsworldbehavior#world) before the node joins a scene. The engine steps the world while the node is in a scene. Removing the behavior or destroying the node stops it and clears the world if the behavior created it. Moving the subtree to another parent keeps the world.

{@link PhysicsWorldBehaviorOptions} takes a `config`, or an existing `world` to adopt, and a `label` for the debug HUD. An adopted world keeps its bodies when the behavior detaches.

### Run a world of your own

Create a {@link PhysicsWorld} yourself and register it so the engine steps it, or call `world.step(dt)` from your own fixed-step callback.

```ts
const world = new PhysicsWorld({ gravity: { x: 0, y: 900 } })
const unregister = host.engine.registerPhysicsWorld(world, { label: 'sim' })
```

[`registerPhysicsWorld`](/module/engine/engine#registerphysicsworld) returns a function that stops the stepping. [`engine.physicsWorlds`](/module/engine/engine#physicsworlds) lists every registered world. In tests, call `world.step(dt)` directly.

### Know when the step runs

The engine calls [`step`](/module/physics/physicsworld#step) on every registered world once per fixed tick, before the scene's `onFixedStep` pass. Code in `onFixedStep` reads the state after the step. The fixed step runs at 120 Hz unless you set `fixedStepHz` on the host. The TSDoc of `step` lists the order of work inside one step.

The same starting state and `dt` give the same result on the same build, because the world reads no clock or random source and visits bodies in a stable order. Floating-point results can differ across CPUs and browsers.

### Set materials and damping

A body's `restitution` (bounciness, 0 to 1) and `friction` both start at 0. A collider overrides them with `material`. For a contact, the world uses the larger restitution of the two colliders and the geometric mean of their friction.

```ts
const puck = world.createBody({
  linearDamping: 0.98,
  colliders: [
    { shape: circleShape(10), material: { restitution: 0.9, friction: 0 } },
  ],
})
```

`linearDamping` and `angularDamping` are the share of velocity a body keeps per 1/60 second. A value of 0.98 slows the puck a little every frame, and the default 1 applies no damping.

### Cast rays and query regions

[`raycast`](/module/physics/physicsworld#raycast) returns the nearest hit along a ray, or `null`. The direction can have any length.

```ts
const hit = world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 500)
if (hit) {
  hit.body // what the ray hit
  hit.point // world position of the hit
  hit.normal // surface normal, pointing back toward the ray origin
  hit.distance // distance along the ray
}
```

Rays pass through sensors. The world returns the same {@link RaycastHit} object each call, so copy what you need, or pass your own object as the fifth argument.

Two more queries fill an array you pass in:

```ts
const found: Body[] = []
world.queryRegion(rect, LAYER_ALL, found) // bodies whose bounds overlap rect
world.queryPoint(x, y, LAYER_ALL, found) // bodies with a collider at the point
```

`queryPoint` tests circles exactly and tests boxes and polygons by their bounding box. Every query compares the body's `layer` with the mask you pass.

### Filter collisions with layers

Each body has a `layer` bitmask, the layers it is in, and a `mask`, the layers it collides with. Two bodies collide when each one's layer is in the other's mask. The defaults are [`LAYER_DEFAULT`](/module/physics/layer-default) (bit 0) and [`LAYER_ALL`](/module/physics/layer-all).

```ts
const PLAYER = 1 << 0
const ENEMY = 1 << 1
const player = world.createBody({
  layer: PLAYER,
  mask: ENEMY,
  colliders: [{ shape: circleShape(12) }],
})
```

This player collides with enemies and passes through other players. A collider can override its body's `layer` and `mask`, and {@link shouldCollide} runs the same test on four numbers.

### Move a character by hand

For a character you move yourself, [`moveAndSlide`](/module/physics/physicsworld#moveandslide) moves a body, pushes it out of anything solid, and slides the rest of the motion along the surface it hit.

```ts
world.moveAndSlide(player, dx, dy)
```

[`moveAndCollide`](/module/physics/physicsworld#moveandcollide) stops at the first blocking contact and returns it as a {@link KinematicHit}, or `null` when the way is clear. Both split a long move into small steps, so a fast move stops at a thin wall. The body's velocity stays as it was. `moveAndCollide` returns a reused object, like `raycast`.

To free a body stuck inside others, [`resolveOverlaps`](/module/physics/physicsworld#resolveoverlaps) pushes it out over a few passes and can keep it inside a rectangle.

### Sleeping and rest

A dynamic body that stays slow for `sleepTime` seconds goes to sleep. Its velocity becomes 0 and the world skips it until a force, a setter, or a real hit wakes it. {@link PhysicsWorldConfig} has the thresholds. A body's own `sleepThreshold` replaces the linear threshold, and `canSleep: false` keeps it awake.

```ts
await world.waitForSettle() // resolves when every awake dynamic body is slow
world.forceSettle() // stops every body now
```

`world.isAtRest()` returns the same check as a boolean.

### Take over a node's transform

Sometimes the node needs to move apart from its body, for example while a tween slides it off screen or a finger drags it. Pass `shouldSync` to `RigidBodyBehavior` to decide each frame whether the body writes to the node.

```ts
let dragging = false
const rb = new RigidBodyBehavior({
  bodyDef,
  shouldSync: () => !dragging, // the drag owns the transform
})
node.addBehavior(rb)
```

Set [`syncEnabled`](/module/physics/rigidbodybehavior#syncenabled) to `false` and back to `true` for the same effect from other code. Set [`interpolate`](/module/physics/rigidbodybehavior#interpolate) to `false` to show the body's latest position as it is, and `syncRotation: false` to copy only the position.

### Mirror a body your code manages

When your code adds and removes bodies from the world itself, pass `manageBody: false` with an explicit `body`. The behavior then only copies the body to the node.

```ts
node.addBehavior(
  new RigidBodyBehavior({
    body, // your code already added it to a world
    manageBody: false,
    syncRotation: false,
  }),
)
```

### Tune the world

Pass a {@link PhysicsWorldConfig} to the host, a stage or `new PhysicsWorld`. Every field is optional, and [`world.config`](/module/physics/physicsworld#config) holds the resolved values.

```ts
const world = new PhysicsWorld({
  gravity: { x: 0, y: 900 },
  velocityIterations: 12, // more passes make stacks steadier
  maxLinearSpeed: 2000, // caps the speed of every body
  enableSleeping: false,
})
```

The type lists the solver, correction, sleep and broad-phase options with their defaults.

The world starts with a {@link BruteForceBroadPhase} and switches once to a {@link SpatialHashBroadPhase} when it holds many bodies. Pass `broadPhase` to pick one yourself, or `broadPhaseCellSize` to set the hash cell size. The {@link BroadPhase} interface lets you supply another structure.

### Show the debug overlay

The debug HUD's Physics panel draws colliders, bounds, contacts, and velocities for every registered world, and shows a stats block per world. See [Debugging](/guides/debugging).

## Common problems

**A body falls through a thin wall.** The body moves farther than the wall is thick in one step. Make the wall thicker, lower the body's speed with `maxLinearSpeed`, or move characters with `moveAndSlide`.

**`RigidBodyBehavior` throws that it found no physics world.** The primary stage has no world and nothing closer applies. Pass `physics` to the host, add a `PhysicsWorldBehavior` to an ancestor, or pass `world` to the behavior.

**A body on a secondary stage joins the primary stage's world.** The behavior falls back to the primary stage. Pass `world: stage.physics!` to the behavior.

**Raycasts and queries find a body at its old place.** The body moved through `body.position`. Move bodies with `setPosition` and `setRotation`, which update the broad phase.

**A node appears in the wrong place.** The node sits under a parent that is moved, scaled or rotated, and the behavior writes the node's own transform. Put the node under the scene root or under the node that holds the world.

**An event handler sees different values later.** The world reuses event payloads and manifolds. Copy the values you need inside the handler.

## See also

- {@link PhysicsWorld}: bodies, the step, events, and queries
- {@link Body}: a rigid body and its forces
- {@link BodyDef}: options for a new body
- {@link ColliderDef}: shape, offset, sensor, layers, and material
- {@link RigidBodyBehavior}: makes a node follow a body
- {@link PhysicsWorldBehavior}: a world for one subtree
- {@link PhysicsWorldConfig}: world tuning options
- {@link PhysicsEvents}: collision, trigger, and sleep events
- [Scene](/guides/scene): nodes, behaviors, and the fixed step
- [Stages](/guides/stages): secondary stages with their own physics
- [Debugging](/guides/debugging): the physics overlay and panel
