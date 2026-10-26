---
title: Diagnostics
group: Features
order: 24
---

# Diagnostics

Everything the engine says about a problem goes through one place, {@link diagnostics}. Each report has a code such as `SG2001`, a level, an area and a message. The console shows it like this:

```
[stargazer] SG2014 (gfx): a path shadow has asked for a new blur radius...
  Try: Use strokeSpace: "world" for that shadow so the radius stays still.
  Details: /guides/diagnostics#sg2014
```

This page lists every code with its cause and its fix.

## Basic usage

By default the console shows warnings and errors. To see more, or less, set the level with the `log` option of {@link createEngineHost} or the `?log=` URL flag. The levels are `error`, `warn`, `info`, `debug` and `off`.

```ts
createEngineHost({ canvas, log: 'info' })
// or: https://example.com/game?log=info
```

### Sending diagnostics to your own logging

`diagnostics.on` calls your function for each diagnostic. Use it to send errors to a log service or to show them in your own interface.

```ts
import { diagnostics } from 'stargazer'

const off = diagnostics.on((d) => {
  if (d.level === 'error') sendToLogs({ code: d.code, message: d.message })
})
// Later:
off()
```

`engine.events` also emits `diagnostic` with the same object. A handler runs the first time a problem happens, and again at 10, 100, 1000 and 10000 repeats. `diagnostics.countOf(code)` gives the exact total.

### When your code throws

Game code that throws inside `onUpdate`, `onFixedStep`, a pointer handler, an event handler or an `onBeforeFrame` function does not stop the engine. The engine reports the error with the node it came from, skips that callback for the rest of the frame, and carries on with the other nodes and the render. These are the `SG4xxx` codes.

### The debug HUD

The Diagnostics panel in the debug HUD lists recent diagnostics with their counts. See [Debugging](/guides/debugging).

## Advanced usage

`StargazerError` is the error the engine throws. It extends `Error` and adds `code` and `area`. The message starts with the code.

`diagnostics.configure({ console: false })` stops console output while handlers still run. `diagnostics.configure({ docsUrl })` sets the base address for the Details link.

Codes are grouped by thousands: 1xxx engine, 2xxx drawing, 3xxx shaders, 4xxx your callbacks, 5xxx API use and 6xxx assets. A code is never reused.

## Reference

### Engine and backend

#### SG1001: A stage stopped rendering

Level: error.

Rendering a frame threw an error. The stage stops rendering so that it does not repeat the error on every frame. Other stages keep running.

**What to do:** Read the error below the message. It points at the node or resource that failed. Reload the page after fixing it.

#### SG1002: The WebGPU device was lost

Level: error.

The browser took the GPU device away, for example after a driver reset, a GPU crash, or a tab left in the background for too long. WebGPU cannot restore a lost device.

**What to do:** Listen for the `backendlost` event and mount again on a new canvas. `mountEngine` does this on WebGL2.

#### SG1003: Resources were not rebuilt while the context was lost

Level: warn.

The engine was asked to rebuild its GPU resources while the rendering context was still lost.

**What to do:** No action needed. The stage tries again on the next `contextrestored` event.

#### SG1004: Rendering backend chosen

Level: info.

The engine picked a graphics backend for the canvas.

#### SG1005: Backend selection failed

Level: error.

No graphics backend could be created, or creating one threw an error.

**What to do:** Check that the browser supports WebGL2 or WebGPU and that the canvas has no other context type.

#### SG1006: An onReady callback failed

Level: error.

The `onReady` function given to `mountEngine` or `mountStage` threw an error or returned a rejected promise.

**What to do:** Fix the error shown below the message.

#### SG1007: Quality was lowered

Level: info.

Frames took longer than the GPU could keep up with, so adaptive quality lowered a setting such as the render scale or the number of MSAA samples. Settings do not step back up.

**What to do:** Pick a lower fixed quality, or reduce the amount of drawing. The Quality panel in the debug HUD shows what each setting costs.

#### SG1008: A rendering backend could not start

Level: error.

The browser refused to give the engine a WebGPU or WebGL2 context. The error is thrown from the call that needed it.

**What to do:** Check that the browser supports the backend, or let `selectGfxDevice` fall back to WebGL2.

#### SG1009: A capture could not finish

Level: error.

A screenshot or scene capture failed. The stage may have been released, may have faulted, or may not have settled in time.

**What to do:** Capture while the engine is running and the stage is attached.

### Drawing

#### SG2001: A blend mode is not supported

Level: warn.

The blend mode you asked for is not available, either for drawing or for compositing a group. The engine draws with `source-over` instead.

**What to do:** Use a supported blend mode. See the Drawing guide for the list.

#### SG2002: A clip path was ignored

Level: warn.

Clipping to a path needs a stencil buffer, and this surface has none.

**What to do:** Draw to a surface that has a stencil buffer, or clip with a rectangle.

#### SG2003: Clip paths are nested too deep

Level: warn.

Clip paths can nest only a fixed number of levels. Deeper clips are ignored.

**What to do:** Flatten the nesting, for example by combining two clips into one path.

#### SG2004: A nonzero fill has too many contours

Level: warn.

A nonzero fill with 16 or more contours can lose coverage where 16 contours wind the same way over one point.

**What to do:** Split the path into several fills, or use an even-odd fill.

#### SG2005: A path fill used even-odd instead of nonzero

Level: warn.

The nonzero fill rule needs a stencil buffer, and this surface has none. The path fills with the even-odd rule.

**What to do:** Draw to a surface that has a stencil buffer.

#### SG2006: A shader quad ignores the clip mask

Level: warn.

`drawShaderQuad` does not apply a mask set with `setClipMask`.

**What to do:** Sample the mask inside the shader, or clip with `setClip`.

#### SG2007: The transform stack overflowed

Level: warn.

More transforms were pushed than the stack can hold. The extra push is ignored.

**What to do:** Check that every `save` or push has a matching restore or pop.

#### SG2008: A radial gradient on a rectangle or circle was flattened

Level: warn.

Rectangles and circles cannot draw radial gradients. They draw a flat color.

**What to do:** Draw a gradient with a gradient fill call instead.

#### SG2009: A stroke alignment fell back to center

Level: warn.

Inside and outside alignment need a closed contour with a well defined winding. The stroke draws centered on the path.

**What to do:** Close the path, or use center alignment.

#### SG2010: Too many different gradients in one frame

Level: warn.

The gradient atlas has a fixed number of rows. Gradients beyond that draw as a solid color.

**What to do:** Reuse gradients with the same stops, or draw fewer distinct ones per frame.

#### SG2011: The particle atlas is full

Level: warn.

The atlas has a fixed number of tiles. Further sprites use a texture each, which breaks batching.

**What to do:** Use fewer distinct particle sprites.

#### SG2012: A draw stream is full

Level: warn.

A frame recorded more draw data than the stream can hold. The engine drops the records that do not fit for the rest of that frame.

**What to do:** Draw less per frame. Cache static content in a Layer.

#### SG2013: A uniform ring overflowed

Level: warn.

A frame used more per-draw uniform data than the ring holds. The engine drops the extra uniforms for the rest of that frame.

**What to do:** Draw less per frame, or batch draws that share state.

#### SG2014: A path shadow rebakes every frame

Level: warn.

A path shadow asked for a new blur radius on many frames in a row. A `strokeSpace: "screen"` blur does this under a camera zoom, because the radius in local units follows the camera scale.

**What to do:** Use `strokeSpace: "world"` for that shadow so the radius stays still.

#### SG2015: Smooth corners are unavailable

Level: warn.

The data file for smooth corners could not be loaded. Corners draw circular.

**What to do:** Check that `squircleField.bin` is served next to the engine code.

#### SG2016: Image upload fell back to a slower path

Level: warn.

`copyExternalImageToTexture` failed. The engine uses `writeTexture` for the rest of the session.

#### SG2017: The MSAA sample count was clamped

Level: warn.

The requested sample count is higher than the driver supports.

**What to do:** Request a lower count, or leave it to the engine.

#### SG2018: A texture size was clamped

Level: warn.

The requested texture is larger than the maximum texture size of the GPU. It is created at the maximum size instead.

**What to do:** Draw at a lower resolution or split the content.

#### SG2019: Text cannot be measured

Level: warn.

There is no 2D canvas context to measure text with, as in a headless environment. Every string measures as empty.

**What to do:** In tests, use `setTextMeasurer` from `stargazer/testing`.

#### SG2020: A cached layer renders every frame

Level: warn.

A Layer asks for a raster cache, but something about it prevents caching. It renders on every frame, as an uncached layer would.

**What to do:** The message names the reason. Remove it, or drop the cache setting.

#### SG2021: A layer draws without its effects

Level: warn.

A layer with effects sits inside an InsetViewNode, or holds one. Effects cannot run in that arrangement.

**What to do:** Move the effects to a layer outside the inset.

#### SG2022: A cached picture is out of date

Level: warn.

A node paints differently than when it last painted, but nothing told the engine. The stale picture is replayed.

**What to do:** Change the node through a paint property or a versioned resource, or call `markNeedsPaint()`.

#### SG2023: A data pass cannot run here

Level: warn.

A data pass needs a compute shader on a device with compute, or a cpu function and a drawing pass as its input on one without.

**What to do:** Give the pass a `cpu` function, or run on WebGPU.

#### SG2024: A drawing or GPU call was used in the wrong state

Level: error.

A call needed something that was not there, such as an open render pass, an initialized buffer or a 2D context.

**What to do:** Make the call inside the frame, in the order the guide for that API shows.

### Shaders

#### SG3001: A GPU program failed to build

Level: error.

The browser rejected a shader or could not create a pipeline. The part that depends on it draws nothing, and the rest keeps rendering.

**What to do:** The compiler messages are listed below the heading, with the source line. Fix the shader, or report the error if it is one of the engine's own.

#### SG3002: A shader declares a uniform block it does not use

Level: warn.

The shader description lists a uniform block that the linked program does not have. Reads from it would be all zeros.

**What to do:** Check the block name against the shader source.

#### SG3003: A shader failed to compile

Level: error.

A WebGL2 shader stage did not compile. The message includes the driver log.

**What to do:** Fix the shader source named in the log.

### Your callbacks

#### SG4001: An onUpdate threw an error

Level: error.

Game code in a node's or behavior's `onUpdate` threw. The engine skips that callback for the rest of the frame and carries on with the other nodes.

**What to do:** Fix the error shown below the message. A repeat of the same error is counted, not printed again.

#### SG4002: An onFixedStep threw an error

Level: error.

Game code in `onFixedStep` threw. The engine skips it for this step.

**What to do:** Fix the error shown below the message.

#### SG4003: An event handler threw an error

Level: error.

A handler passed to `emitter.on` threw. The other handlers for the event still run.

**What to do:** Fix the error shown below the message.

#### SG4004: A pointer handler threw an error

Level: error.

A pointer callback such as `onPointerDown` threw. The engine drops that call and keeps handling input.

**What to do:** Fix the error shown below the message.

#### SG4005: A before-frame handler threw an error

Level: error.

A function passed to `engine.onBeforeFrame` threw. The engine skips it for this frame.

**What to do:** Fix the error shown below the message.

#### SG4006: A node loop stopped with an error

Level: error.

The body of a `node.loop` threw, so the loop ended.

**What to do:** Fix the error shown below the message, or catch it inside the loop body.

#### SG4007: A promise passed to autoDestroy rejected

Level: warn.

The promise rejected with something other than an abort. The node is destroyed anyway.

#### SG4008: A lifecycle hook threw an error

Level: error.

Game code in a node's or behavior's `onAttach`, `onDetach` or `onSceneReady` threw. The engine finishes attaching or detaching anyway, so the scene stays consistent.

**What to do:** Fix the error shown below the message. A hook that threw may have left its own setup half done.

#### SG4009: A tween onUpdate threw an error

Level: error.

The `onUpdate` option of a tween threw. The engine keeps the tween running so its promise still settles.

**What to do:** Fix the error shown below the message.

### API use

#### SG5001: An event was emitted from inside its own handler

Level: warn.

A handler emitted the event it is handling. This usually means a handler that triggers itself.

**What to do:** Emit from outside the handler, or guard the nested emit.

#### SG5002: The animator ticked from inside a tick

Level: warn.

A callback or promise resolution started another tick while one was running. Recursive game logic like this can overflow the stack.

**What to do:** Do not drive the animator from its own callbacks.

#### SG5003: Two tweens drive the same property

Level: warn.

Two tweens on one target both change the same key. The later one wins on each tick, and the value jumps.

**What to do:** Cancel the earlier tween before starting the next.

#### SG5004: A stage pointer position was converted with the wrong node

Level: warn.

The world position of a stage pointer event was passed to `worldToLocal` on a node that a layer places, not the camera.

**What to do:** Use `event.localTo(node)` to get the position in that node's space.

#### SG5005: A high frequency event was turned into a store

Level: warn.

The event fires every frame. A store for it runs Svelte reactivity on every emission and lowers the frame rate.

**What to do:** Subscribe with `emitter.on` inside a `$effect` instead.

#### SG5006: A layout measured to zero

Level: warn.

A LayoutBuilder has no limit on an axis and measured to 0 there.

**What to do:** Wrap it in `Expanded`, `AspectRatio` or `SizedBox`.

#### SG5007: A call was not valid

Level: error.

The call broke a rule of the API, such as adding a node to itself or giving a camera children. The message says which rule.

**What to do:** Fix the call named in the message.

#### SG5008: A post chain is misconfigured

Level: error.

The passes of a post chain do not fit together, for example the last pass does not draw to the screen or a pass reads one that runs later.

**What to do:** Reorder the passes so every input comes from an earlier pass.

#### SG5009: Something was used after it was destroyed

Level: error.

The call needs a live engine, stage, node or accessibility tree, but it was already destroyed or released.

**What to do:** Keep the object alive until the call is done, or check before calling.

### Assets

#### SG6001: A glTF extension is not supported

Level: warn.

The file uses an extension the loader does not read. It loads without it.

**What to do:** Export the model without that extension if it matters for how it looks.

#### SG6002: A second UV set was ignored

Level: warn.

The model has `TEXCOORD_1`, and only `TEXCOORD_0` is read.

#### SG6003: An SVG could not be rasterized

Level: warn.

Drawing the SVG to a bitmap failed. It draws nothing.

**What to do:** Check that the SVG is valid and has a size.

#### SG6004: A color string is not supported

Level: warn.

The color could not be parsed. It draws as black.

**What to do:** Use a hex, `rgb()`, `hsl()` or named color.

#### SG6005: Cubic spline animation was approximated

Level: warn.

The animation uses `CUBICSPLINE` interpolation, which is played as linear.

#### SG6006: A file could not be loaded

Level: error.

A request for an image, animation or data file returned an error status.

**What to do:** Check the URL and that the server returns the file.

#### SG6007: A file is malformed or not supported

Level: error.

A Lottie, dotLottie, glTF, SVG or zip file could not be read. The message says what is wrong with it.

**What to do:** Re-export the file, or use a feature the loader supports.

## See also

- {@link Diagnostics}: the class behind `diagnostics`
- {@link StargazerError}: the error the engine throws
- [Debugging](/guides/debugging): the HUD
- [Testing](/guides/testing): keeping diagnostics out of test output
