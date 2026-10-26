---
title: Animation
group: Features
order: 7
---

# Animation and async lifecycle

A tween moves numeric properties from their current values to target values over a duration, and returns a Promise that resolves when it ends. After this page you can animate a node, chain animations with `await`, run steps in order or in parallel, and cancel a sequence with an `AbortSignal`.

The engine's {@link Animator} runs every tween and wait. It advances them once per frame in engine time, so they hold while the engine is paused. Nodes have helpers that tie a tween to the node's lifetime, so destroying the node cancels its tweens. The examples need a node in one of the engine's scenes, see [Setup](/guides/setup) and [Scene graph](/guides/scene). The `?demo=anim` dev demo runs a looping timeline with cancellation and the overlap warning.

## Basic usage

This example scales a node up, waits half a second, then fades it out.

```ts
import { easings, ignoreAbort, type Node2D } from 'stargazer'

async function popAndFade(node: Node2D): Promise<void> {
  await node.tween(
    { scaleX: 1.5, scaleY: 1.5 },
    { duration: 0.3, easing: easings.outBack },
  )
  await node.wait(0.5)
  await node.tween({ alpha: 0 }, { duration: 0.4 })
}

popAndFade(node).catch(ignoreAbort)
```

Each `await` resumes on the frame the step finishes. When the node is destroyed during the sequence, the pending step rejects with an `AbortError`. {@link ignoreAbort} swallows that error and rethrows any other.

### Animate a node's transform

[`Node2D.tween`](/module/scene/node2d#tween) animates fields of the node's {@link Transform2D}, such as `x`, `y`, `scaleX`, `rotation` and `alpha`. It returns a Promise. To start an animation and move on, use [`play`](/module/scene/node2d#play). It takes the same arguments, returns nothing, and swallows the `AbortError` for you.

```ts
// Await the move, then continue.
await node.tween({ x: 400, y: 200 }, { duration: 0.5 })

// Start a short pop and move on.
node.play({ scaleX: 1.1, scaleY: 1.1 }, { duration: 0.15 })
```

A {@link Node3D} has its own [`tween`](/module/scene/node3d#tween) and [`play`](/module/scene/node3d#play). They take a {@link Node3DTweenTo}, where position, scale and alpha interpolate linearly and rotation, a quaternion, interpolates spherically.

```ts
await pivot.tween(
  { position: { x: 0, y: 2, z: 0 }, scale: { x: 2, y: 2, z: 2 } },
  { duration: 0.6, easing: easings.inOutCubic },
)
```

### Animate any object

[`tweenTo`](/module/scene/node#tweento) animates numeric fields on any object and cancels when the node is destroyed. Use it for a paint property, a physics body's position, or a plain `{ progress: 0 }` value that your code reads. [`playTo`](/module/scene/node#playto) is the version to start and move on.

```ts
const reveal = { progress: 0 }
await node.tweenTo(reveal, { progress: 1 }, { duration: 0.8 })

node.playTo(ring, { width: 12 }, { duration: 0.2, easing: easings.outBack })
```

A property is animated when it holds a number in both the target and `to`.

[`engine.tween`](/module/engine/engine#tween) and [`engine.wait`](/module/engine/engine#wait) do the same work for code that has no node. A `signal` you pass, or the engine's destroy, cancels them. [`engine.animate`](/module/engine/engine#animate) tweens a `Node2D`'s transform and cancels with that node.

```ts
await engine.tween(fx, { intensity: 1 }, { duration: 0.3 })
await engine.wait(1.2)
await engine.animate(node, { alpha: 0 }, { duration: 0.3 })
```

### Wait

[`node.wait(seconds)`](/module/scene/node#wait) resolves after that many seconds of engine time, and rejects with `AbortError` when the node is destroyed first.

```ts
await node.wait(1.5)
node.visible = true
```

Waits hold while the engine is paused or its ticker is stopped. A wait of `0` resolves on the next frame. A second argument adds an `AbortSignal` that also cancels the wait.

### Run steps in order with a timeline

A {@link Timeline} runs steps one after another. [`parallel`](/module/anim/timeline#parallel) adds one step that runs several steps at the same time and ends when all of them end. [`node.timeline()`](/module/scene/node#timeline) is shorthand for `new Timeline()`.

```ts
await node
  .timeline()
  .add((s) =>
    node.tween(
      { scaleX: 1, scaleY: 1 },
      { duration: 0.35, easing: easings.outBack, signal: s },
    ),
  )
  .add((s) => node.tween({ x: 400 }, { duration: 0.5, signal: s }))
  .parallel(
    (s) => node.tween({ alpha: 0 }, { duration: 0.4, signal: s }),
    (s) => node.tween({ y: 100 }, { duration: 0.4, signal: s }),
  )
  .run(scope.signal)
```

A step is a {@link TimelineStep}: a function that receives the signal given to [`run`](/module/anim/timeline#run) and returns a Promise. `run` checks the signal before each step and passes it into the step, so a step that forwards it as `{ signal: s }` stops mid-tween when the signal aborts. Write steps with `tween` and `tweenTo`, which return a Promise, in place of `play` and `playTo`.

A timeline suits a fixed sequence. For branches, loops or state changes between steps, write a plain `async` function and pass the signal to each call.

### Easings

An easing maps progress from 0 to 1 onto the eased value. The default is linear, and the built-in easings are in the {@link easings} namespace.

```ts
import { easings } from 'stargazer'

await node.tween({ y: 0 }, { duration: 0.6, easing: easings.outBounce })

const easeInOut = easings.cubicBezier(0.42, 0, 0.58, 1) // CSS ease-in-out
const bigOvershoot = easings.makeOutBack(3)
```

The node drops to `y = 0` and bounces on arrival. `cubicBezier(x1, y1, x2, y2)` takes `x1` and `x2` between 0 and 1, and `y1` and `y2` can leave that range to overshoot. Any function of type {@link Easing}, `(t: number) => number`, works as an easing.

## Advanced usage

Reach for these parts to restart or cancel animations, repeat work while a node lives, combine signals, find out why a tween warns, and know when a tween repaints.

### Tween options

Every tween helper takes a {@link TweenOptions} object.

```ts
await node.tween(
  { x: 400 },
  {
    duration: 0.5,
    delay: 0.2,
    easing: easings.inOutQuad,
    signal: scope.signal,
    onUpdate: () => moveTrail(node),
    key: 'slide',
  },
)
```

`duration` is in seconds, and `0` completes on the next frame. `delay` holds the start by that many seconds. `onUpdate` runs every frame after the tween writes its values. Aborting `signal` rejects the Promise with `AbortError`, and the node helpers combine it with the node's own signal. `key` replaces a running tween, see the next section.

The tween reads its start values when you call it, before any `delay`. A write to the target during the delay is overwritten when the tween starts moving.

### Restart an animation with a key

An animation that can retrigger, such as a glow on each hit, replaces its previous run when it carries a `key`. Starting a keyed tween aborts any running tween with the same `key` on the same target, and the aborted one rejects with `AbortError`.

```ts
// Each call replaces the previous ring animation on this node.
node.playTo(ring, { width }, { duration: 0.2, key: 'ring' })
```

The animator matches the key and the target object, so pass the same object to `tweenTo` or `playTo` on every call. `Node2D.tween` targets the node's own transform, and `Node3D.tween` keeps one internal target per key, so `key` works on both as written.

### Cancel a sequence with a scope

An {@link AbortScope} hands out one signal per run of a sequence. [`reset()`](/module/anim/abortscope#reset) aborts the previous run's signal and returns a fresh one. Use it for a sequence that stops as soon as the next one starts, such as a round of a card game. [`node.scope()`](/module/scene/node#scope) creates a scope that the node's destruction aborts and disposes.

```ts
const scope = node.scope()

function startRound(): void {
  const signal = scope.reset() // aborts the previous round
  void (async () => {
    await dealCards(signal)
    await playRound(signal)
    await showResult(signal)
  })().catch(ignoreAbort)
}
```

Read `scope.reset()` once at the top of the sequence and pass that signal into every tween and wait inside it (`{ signal }`). When the next `reset()` runs, those calls reject with `AbortError`, the async function unwinds, and the one `.catch(ignoreAbort)` keeps it quiet. The sequence needs no check after each `await`.

`abort()` aborts the current signal and leaves the scope idle until the next `reset()`. `dispose()` aborts the current signal and retires the scope.

### Repeat work while a node lives

[`node.loop(body)`](/module/scene/node#loop) runs an async `body` again and again until the node is destroyed.

```ts
node.loop(async ({ signal }) => {
  await node.tween({ y: 10 }, { duration: 1, signal })
  await node.tween({ y: 0 }, { duration: 1, signal })
})
```

The node bobs up and down until it is destroyed. `body` receives `{ node, signal, iteration, nextFrame }`, and `nextFrame()` resolves on the next frame. The loop swallows `AbortError`, and any other error ends the loop and is reported through [Diagnostics](/guides/diagnostics). The first run starts a microtask later, so a behavior can call `loop` from `onAttach`.

[`node.autoDestroy(promise)`](/module/scene/node#autodestroy) destroys the node when the Promise settles. Use it for a node that exists for one animation, such as a floating score label.

```ts
void label.autoDestroy(label.tween({ y: -80, alpha: 0 }, { duration: 0.8 }))
```

A rejection other than `AbortError` is reported, and the node is destroyed in every case.

### Abort contract

Every helper that takes a `signal` follows the same contract:

1. A signal that is already aborted when you call the helper rejects the Promise with `DOMException('Aborted', 'AbortError')`.
2. A signal that aborts while the helper runs rejects the Promise with the same error.
3. A helper that finishes removes its listener from the signal.

Point 3 keeps a long session from piling up listeners on a node's signal, which lives as long as the node. {@link isAbortError} tests for the error and leaves it in place, and {@link abortError} creates one for your own async helpers.

### Destroyed or never attached

The node helpers reach the engine through the node's owner. A node that is destroyed rejects the Promise with `AbortError`, whether the node died during an `await` or before the call. A sequence that outlives its node is a normal cancellation.

A node that was never attached rejects the Promise with a plain `Error`, which `ignoreAbort` rethrows, so the setup mistake shows up. Attach the node to a scene before you call its helpers.

This covers `wait`, `tweenTo`, `Node2D.tween`, `Node3D.tween`, [`CameraNode2D.animateTo`](/module/camera/cameranode2d#animateto) and [`CameraNode3D.animateProjection`](/module/camera/cameranode3d#animateprojection). A sequence of several awaits unwinds through one `ignoreAbort`.

### Combine signals

{@link combineAbortSignals} returns a {@link CombinedAbort}, `{ signal, dispose }`. The combined signal aborts when any source aborts, and `dispose()` removes the listeners it added to the sources.

```ts
import { combineAbortSignals } from 'stargazer'

const combined = combineAbortSignals(node.abortSignal, opts.signal)
try {
  await engine.tween(target, to, { ...opts, signal: combined.signal })
} finally {
  combined.dispose()
}
```

Call `dispose()` when your operation ends. The node helpers and `engine.animate` do this already. Sources that are `undefined` or `null` are skipped. When a source is already aborted, the combined signal aborts at once and `dispose()` has nothing to remove.

### Overlapping tweens

Two tweens on the same field of the same target both run to the end, and the one started later writes last on each frame. The animator reports diagnostic `SG5003` when the second one starts, see [Diagnostics](/guides/diagnostics#sg5003). To hand over cleanly, give both tweens the same `key`, or pass a `signal` to the first and abort it before you start the second.

```ts
let slide: AbortController | null = null

function slideTo(x: number): void {
  slide?.abort()
  slide = new AbortController()
  node.play({ x }, { duration: 1, signal: slide.signal })
}
```

Each call stops the previous slide where it is and starts the next one from the node's current `x`. The check covers the same target object, so tweens on a `Node2D` and `tweenTo` calls that reuse one object are covered. Give tweens that overlap on a {@link Node3D} a shared `key`, because each unkeyed `Node3D.tween` call uses a target of its own.

### What a tween repaints

A tween of a transform field or of `alpha` replays the node's picture through a new matrix. A tween of a property declared with {@link definePaintProps} marks the node for repaint on every frame the value changes. Tween the transform when the effect allows it. See [Drawing](/guides/drawing).

### Frame order and pausing

The animator runs before each node's `onUpdate` in a frame, so `onUpdate` reads the values the tweens wrote this frame. A tween created during `onUpdate` first moves on the next frame. [Architecture](/guides/architecture) lists the whole frame.

While [`engine.setPaused(true)`](/module/engine/engine#setpaused) is in effect, tweens and waits hold where they are and continue when you unpause.

### Engine destroy

[`engine.destroy()`](/module/engine/engine#destroy) calls [`animation.cancelAll()`](/module/anim/animator#cancelall) before it tears down any scene. Every pending tween and wait rejects with `AbortError`, and later calls on that animator reject at once. Then the scenes are destroyed, which aborts every node signal. A `.catch(ignoreAbort)` keeps each of these quiet.

### Keyframe animation from glTF

Tweens and keyframe playback are separate systems. An {@link AnimationPlayer} plays an {@link AnimationClip} loaded from a glTF file. See [3D](/guides/3d).

## Common problems

### The console shows an unhandled AbortError

A Promise from a tween or wait rejected with `AbortError` because its node was destroyed, its signal aborted, or the engine was destroyed. End the chain with `.catch(ignoreAbort)`.

```ts
await node.tween({ alpha: 0 }, { duration: 0.3 }).catch(ignoreAbort)
```

### A keyed tween does not replace the earlier one

The key matches only when the target object is the same. A `tweenTo` or `playTo` call with a new object each time starts a second tween. Create the object once and pass it on every call.

### A helper rejects with a plain Error

The node is not in a scene yet. Add it to the scene tree first, as described in [Destroyed or never attached](#destroyed-or-never-attached).

## Next step

Reuse and organize what you animate with [Scene graph](/guides/scene), or play keyframes from a model file in [3D](/guides/3d).

## See also

- {@link Animator}: the engine's tween and wait runner
- {@link TweenOptions}: options for every tween helper
- {@link Timeline}: sequential and parallel steps
- {@link AbortScope}: one cancel signal per run of a sequence
- {@link combineAbortSignals}: merge abort signals with cleanup
- {@link easings}: built-in easing functions
- [Scene graph](/guides/scene): node lifetime and `abortSignal`
- [Camera](/guides/camera): camera pan and zoom animation
- [3D](/guides/3d): glTF keyframe playback
