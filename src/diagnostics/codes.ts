/** The part of the engine a diagnostic comes from. */
export type DiagnosticArea =
  'engine' | 'gfx' | 'shader' | 'callbacks' | 'api' | 'assets'

/** What the registry says about one diagnostic code. */
export interface DiagnosticSpec {
  area: DiagnosticArea
  /** The level used unless a report overrides it. */
  level: 'error' | 'warn' | 'info'
  /** A short name, used as the heading in the reference. */
  title: string
  /** Why it happens. */
  cause: string
  /** What to do about it. Shown as the hint in the console. */
  fix?: string
}

/**
 * Every diagnostic the engine reports. The reference page is generated from
 * this table (`npm run gen:diagnostics`), and a test fails when the two
 * differ.
 *
 * Codes are grouped by thousands: 1xxx engine, 2xxx drawing, 3xxx shaders, 4xxx
 * game callbacks, 5xxx API use, 6xxx assets. A code is never reused.
 */
export const DIAGNOSTIC_CODES = {
  SG1001: {
    area: 'engine',
    level: 'error',
    title: 'A stage stopped rendering',
    cause:
      'Rendering a frame threw an error. The stage stops rendering so that it does not repeat the error on every frame. Other stages keep running.',
    fix: 'Read the error below the message. It points at the node or resource that failed. Reload the page after fixing it.',
  },
  SG1002: {
    area: 'engine',
    level: 'error',
    title: 'The WebGPU device was lost',
    cause:
      'The browser took the GPU device away, for example after a driver reset, a GPU crash, or a tab left in the background for too long. WebGPU cannot restore a lost device.',
    fix: 'Listen for the `backendlost` event and mount again on a new canvas. `mountEngine` does this on WebGL2.',
  },
  SG1003: {
    area: 'engine',
    level: 'warn',
    title: 'Resources were not rebuilt while the context was lost',
    cause:
      'The engine was asked to rebuild its GPU resources while the rendering context was still lost.',
    fix: 'No action needed. The stage tries again on the next `contextrestored` event.',
  },
  SG1004: {
    area: 'engine',
    level: 'info',
    title: 'Rendering backend chosen',
    cause: 'The engine picked a graphics backend for the canvas.',
  },
  SG1005: {
    area: 'engine',
    level: 'error',
    title: 'Backend selection failed',
    cause:
      'No graphics backend could be created, or creating one threw an error.',
    fix: 'Check that the browser supports WebGL2 or WebGPU and that the canvas has no other context type.',
  },
  SG1006: {
    area: 'engine',
    level: 'error',
    title: 'An onReady callback failed',
    cause:
      'The `onReady` function given to `mountEngine` or `mountStage` threw an error or returned a rejected promise.',
    fix: 'Fix the error shown below the message.',
  },
  SG1007: {
    area: 'engine',
    level: 'info',
    title: 'Quality was lowered',
    cause:
      'Frames took longer than the GPU could keep up with, so adaptive quality lowered a setting such as the render scale or the number of MSAA samples. Settings do not step back up.',
    fix: 'Pick a lower fixed quality, or reduce the amount of drawing. The Quality panel in the debug HUD shows what each setting costs.',
  },
  SG1008: {
    area: 'engine',
    level: 'error',
    title: 'A rendering backend could not start',
    cause:
      'The browser refused to give the engine a WebGPU or WebGL2 context. The error is thrown from the call that needed it.',
    fix: 'Check that the browser supports the backend, or let `selectGfxDevice` fall back to WebGL2.',
  },
  SG1009: {
    area: 'engine',
    level: 'error',
    title: 'A capture could not finish',
    cause:
      'A screenshot or scene capture failed. The stage may have been released, may have faulted, or may not have settled in time.',
    fix: 'Capture while the engine is running and the stage is attached.',
  },

  SG2001: {
    area: 'gfx',
    level: 'warn',
    title: 'A blend mode is not supported',
    cause:
      'The blend mode you asked for is not available, either for drawing or for compositing a group. The engine draws with `source-over` instead.',
    fix: 'Use a supported blend mode. See the Drawing guide for the list.',
  },
  SG2002: {
    area: 'gfx',
    level: 'warn',
    title: 'A clip path was ignored',
    cause:
      'Clipping to a path needs a stencil buffer, and this surface has none.',
    fix: 'Draw to a surface that has a stencil buffer, or clip with a rectangle.',
  },
  SG2003: {
    area: 'gfx',
    level: 'warn',
    title: 'Clip paths are nested too deep',
    cause:
      'Clip paths can nest only a fixed number of levels. Deeper clips are ignored.',
    fix: 'Flatten the nesting, for example by combining two clips into one path.',
  },
  SG2004: {
    area: 'gfx',
    level: 'warn',
    title: 'A nonzero fill has too many contours',
    cause:
      'A nonzero fill with 16 or more contours can lose coverage where 16 contours wind the same way over one point.',
    fix: 'Split the path into several fills, or use an even-odd fill.',
  },
  SG2005: {
    area: 'gfx',
    level: 'warn',
    title: 'A path fill used even-odd instead of nonzero',
    cause:
      'The nonzero fill rule needs a stencil buffer, and this surface has none. The path fills with the even-odd rule.',
    fix: 'Draw to a surface that has a stencil buffer.',
  },
  SG2006: {
    area: 'gfx',
    level: 'warn',
    title: 'A shader quad ignores the clip mask',
    cause: '`drawShaderQuad` does not apply a mask set with `setClipMask`.',
    fix: 'Sample the mask inside the shader, or clip with `setClip`.',
  },
  SG2007: {
    area: 'gfx',
    level: 'warn',
    title: 'The transform stack overflowed',
    cause:
      'More transforms were pushed than the stack can hold. The extra push is ignored.',
    fix: 'Check that every `save` or push has a matching restore or pop.',
  },
  SG2008: {
    area: 'gfx',
    level: 'warn',
    title: 'A radial gradient on a rectangle or circle was flattened',
    cause:
      'Rectangles and circles cannot draw radial gradients. They draw a flat color.',
    fix: 'Draw a gradient with a gradient fill call instead.',
  },
  SG2009: {
    area: 'gfx',
    level: 'warn',
    title: 'A stroke alignment fell back to center',
    cause:
      'Inside and outside alignment need a closed contour with a well defined winding. The stroke draws centered on the path.',
    fix: 'Close the path, or use center alignment.',
  },
  SG2010: {
    area: 'gfx',
    level: 'warn',
    title: 'Too many different gradients in one frame',
    cause:
      'The gradient atlas has a fixed number of rows. Gradients beyond that draw as a solid color.',
    fix: 'Reuse gradients with the same stops, or draw fewer distinct ones per frame.',
  },
  SG2011: {
    area: 'gfx',
    level: 'warn',
    title: 'The particle atlas is full',
    cause:
      'The atlas has a fixed number of tiles. Further sprites use a texture each, which breaks batching.',
    fix: 'Use fewer distinct particle sprites.',
  },
  SG2012: {
    area: 'gfx',
    level: 'warn',
    title: 'A draw stream is full',
    cause:
      'A frame recorded more draw data than the stream can hold. The engine drops the records that do not fit for the rest of that frame.',
    fix: 'Draw less per frame. Cache static content in a Layer.',
  },
  SG2013: {
    area: 'gfx',
    level: 'warn',
    title: 'A uniform ring overflowed',
    cause:
      'A frame used more per-draw uniform data than the ring holds. The engine drops the extra uniforms for the rest of that frame.',
    fix: 'Draw less per frame, or batch draws that share state.',
  },
  SG2014: {
    area: 'gfx',
    level: 'warn',
    title: 'A path shadow rebakes every frame',
    cause:
      'A path shadow asked for a new blur radius on many frames in a row. A `strokeSpace: "screen"` blur does this under a camera zoom, because the radius in local units follows the camera scale.',
    fix: 'Use `strokeSpace: "world"` for that shadow so the radius stays still.',
  },
  SG2015: {
    area: 'gfx',
    level: 'warn',
    title: 'Smooth corners are unavailable',
    cause:
      'The data file for smooth corners could not be loaded. Corners draw circular.',
    fix: 'Check that `squircleField.bin` is served next to the engine code.',
  },
  SG2016: {
    area: 'gfx',
    level: 'warn',
    title: 'Image upload fell back to a slower path',
    cause:
      '`copyExternalImageToTexture` failed. The engine uses `writeTexture` for the rest of the session.',
  },
  SG2017: {
    area: 'gfx',
    level: 'warn',
    title: 'The MSAA sample count was clamped',
    cause: 'The requested sample count is higher than the driver supports.',
    fix: 'Request a lower count, or leave it to the engine.',
  },
  SG2018: {
    area: 'gfx',
    level: 'warn',
    title: 'A texture size was clamped',
    cause:
      'The requested texture is larger than the maximum texture size of the GPU. It is created at the maximum size instead.',
    fix: 'Draw at a lower resolution or split the content.',
  },
  SG2019: {
    area: 'gfx',
    level: 'warn',
    title: 'Text cannot be measured',
    cause:
      'There is no 2D canvas context to measure text with, as in a headless environment. Every string measures as empty.',
    fix: 'In tests, use `setTextMeasurer` from `stargazer/testing`.',
  },
  SG2020: {
    area: 'gfx',
    level: 'warn',
    title: 'A cached layer renders every frame',
    cause:
      'A Layer asks for a raster cache, but something about it prevents caching. It renders on every frame, as an uncached layer would.',
    fix: 'The message names the reason. Remove it, or drop the cache setting.',
  },
  SG2021: {
    area: 'gfx',
    level: 'warn',
    title: 'A layer draws without its effects',
    cause:
      'A layer with effects sits inside an InsetViewNode, or holds one. Effects cannot run in that arrangement.',
    fix: 'Move the effects to a layer outside the inset.',
  },
  SG2022: {
    area: 'gfx',
    level: 'warn',
    title: 'A cached picture is out of date',
    cause:
      'A node paints differently than when it last painted, but nothing told the engine. The stale picture is replayed.',
    fix: 'Change the node through a paint property or a versioned resource, or call `markNeedsPaint()`.',
  },
  SG2023: {
    area: 'gfx',
    level: 'warn',
    title: 'A data pass cannot run here',
    cause:
      'A data pass needs a compute shader on a device with compute, or a cpu function and a drawing pass as its input on one without.',
    fix: 'Give the pass a `cpu` function, or run on WebGPU.',
  },
  SG2024: {
    area: 'gfx',
    level: 'error',
    title: 'A drawing or GPU call was used in the wrong state',
    cause:
      'A call needed something that was not there, such as an open render pass, an initialized buffer or a 2D context.',
    fix: 'Make the call inside the frame, in the order the guide for that API shows.',
  },

  SG3001: {
    area: 'shader',
    level: 'error',
    title: 'A GPU program failed to build',
    cause:
      'The browser rejected a shader or could not create a pipeline. The part that depends on it draws nothing, and the rest keeps rendering.',
    fix: "The compiler messages are listed below the heading, with the source line. Fix the shader, or report the error if it is one of the engine's own.",
  },
  SG3002: {
    area: 'shader',
    level: 'warn',
    title: 'A shader declares a uniform block it does not use',
    cause:
      'The shader description lists a uniform block that the linked program does not have. Reads from it would be all zeros.',
    fix: 'Check the block name against the shader source.',
  },
  SG3003: {
    area: 'shader',
    level: 'error',
    title: 'A shader failed to compile',
    cause:
      'A WebGL2 shader stage did not compile. The message includes the driver log.',
    fix: 'Fix the shader source named in the log.',
  },

  SG4001: {
    area: 'callbacks',
    level: 'error',
    title: 'An onUpdate threw an error',
    cause:
      "Game code in a node's or behavior's `onUpdate` threw. The engine skips that callback for the rest of the frame and carries on with the other nodes.",
    fix: 'Fix the error shown below the message. A repeat of the same error is counted, not printed again.',
  },
  SG4002: {
    area: 'callbacks',
    level: 'error',
    title: 'An onFixedStep threw an error',
    cause:
      'Game code in `onFixedStep` threw. The engine skips it for this step.',
    fix: 'Fix the error shown below the message.',
  },
  SG4003: {
    area: 'callbacks',
    level: 'error',
    title: 'An event handler threw an error',
    cause:
      'A handler passed to `emitter.on` threw. The other handlers for the event still run.',
    fix: 'Fix the error shown below the message.',
  },
  SG4004: {
    area: 'callbacks',
    level: 'error',
    title: 'A pointer handler threw an error',
    cause:
      'A pointer callback such as `onPointerDown` threw. The engine drops that call and keeps handling input.',
    fix: 'Fix the error shown below the message.',
  },
  SG4005: {
    area: 'callbacks',
    level: 'error',
    title: 'A before-frame handler threw an error',
    cause:
      'A function passed to `engine.onBeforeFrame` threw. The engine skips it for this frame.',
    fix: 'Fix the error shown below the message.',
  },
  SG4006: {
    area: 'callbacks',
    level: 'error',
    title: 'A node loop stopped with an error',
    cause: 'The body of a `node.loop` threw, so the loop ended.',
    fix: 'Fix the error shown below the message, or catch it inside the loop body.',
  },
  SG4007: {
    area: 'callbacks',
    level: 'warn',
    title: 'A promise passed to autoDestroy rejected',
    cause:
      'The promise rejected with something other than an abort. The node is destroyed anyway.',
  },
  SG4008: {
    area: 'callbacks',
    level: 'error',
    title: 'A lifecycle hook threw an error',
    cause:
      "Game code in a node's or behavior's `onAttach`, `onDetach` or `onSceneReady` threw. The engine finishes attaching or detaching anyway, so the scene stays consistent.",
    fix: 'Fix the error shown below the message. A hook that threw may have left its own setup half done.',
  },
  SG4009: {
    area: 'callbacks',
    level: 'error',
    title: 'A tween onUpdate threw an error',
    cause:
      'The `onUpdate` option of a tween threw. The engine keeps the tween running so its promise still settles.',
    fix: 'Fix the error shown below the message.',
  },

  SG5001: {
    area: 'api',
    level: 'warn',
    title: 'An event was emitted from inside its own handler',
    cause:
      'A handler emitted the event it is handling. This usually means a handler that triggers itself.',
    fix: 'Emit from outside the handler, or guard the nested emit.',
  },
  SG5002: {
    area: 'api',
    level: 'warn',
    title: 'The animator ticked from inside a tick',
    cause:
      'A callback or promise resolution started another tick while one was running. Recursive game logic like this can overflow the stack.',
    fix: 'Do not drive the animator from its own callbacks.',
  },
  SG5003: {
    area: 'api',
    level: 'warn',
    title: 'Two tweens drive the same property',
    cause:
      'Two tweens on one target both change the same key. The later one wins on each tick, and the value jumps.',
    fix: 'Cancel the earlier tween before starting the next.',
  },
  SG5004: {
    area: 'api',
    level: 'warn',
    title: 'A stage pointer position was converted with the wrong node',
    cause:
      'The world position of a stage pointer event was passed to `worldToLocal` on a node that a layer places, not the camera.',
    fix: "Use `event.localTo(node)` to get the position in that node's space.",
  },
  SG5005: {
    area: 'api',
    level: 'warn',
    title: 'A high frequency event was turned into a store',
    cause:
      'The event fires every frame. A store for it runs Svelte reactivity on every emission and lowers the frame rate.',
    fix: 'Subscribe with `emitter.on` inside a `$effect` instead.',
  },
  SG5006: {
    area: 'api',
    level: 'warn',
    title: 'A layout measured to zero',
    cause: 'A LayoutBuilder has no limit on an axis and measured to 0 there.',
    fix: 'Wrap it in `Expanded`, `AspectRatio` or `SizedBox`.',
  },
  SG5007: {
    area: 'api',
    level: 'error',
    title: 'A call was not valid',
    cause:
      'The call broke a rule of the API, such as adding a node to itself or giving a camera children. The message says which rule.',
    fix: 'Fix the call named in the message.',
  },
  SG5008: {
    area: 'api',
    level: 'error',
    title: 'A post chain is misconfigured',
    cause:
      'The passes of a post chain do not fit together, for example the last pass does not draw to the screen or a pass reads one that runs later.',
    fix: 'Reorder the passes so every input comes from an earlier pass.',
  },
  SG5009: {
    area: 'api',
    level: 'error',
    title: 'Something was used after it was destroyed',
    cause:
      'The call needs a live engine, stage, node or accessibility tree, but it was already destroyed or released.',
    fix: 'Keep the object alive until the call is done, or check before calling.',
  },

  SG6001: {
    area: 'assets',
    level: 'warn',
    title: 'A glTF extension is not supported',
    cause:
      'The file uses an extension the loader does not read. It loads without it.',
    fix: 'Export the model without that extension if it matters for how it looks.',
  },
  SG6002: {
    area: 'assets',
    level: 'warn',
    title: 'A second UV set was ignored',
    cause: 'The model has `TEXCOORD_1`, and only `TEXCOORD_0` is read.',
  },
  SG6003: {
    area: 'assets',
    level: 'warn',
    title: 'An SVG could not be rasterized',
    cause: 'Drawing the SVG to a bitmap failed. It draws nothing.',
    fix: 'Check that the SVG is valid and has a size.',
  },
  SG6004: {
    area: 'assets',
    level: 'warn',
    title: 'A color string is not supported',
    cause: 'The color could not be parsed. It draws as black.',
    fix: 'Use a hex, `rgb()`, `hsl()` or named color.',
  },
  SG6005: {
    area: 'assets',
    level: 'warn',
    title: 'Cubic spline animation was approximated',
    cause:
      'The animation uses `CUBICSPLINE` interpolation, which is played as linear.',
  },
  SG6006: {
    area: 'assets',
    level: 'error',
    title: 'A file could not be loaded',
    cause:
      'A request for an image, animation or data file returned an error status.',
    fix: 'Check the URL and that the server returns the file.',
  },
  SG6007: {
    area: 'assets',
    level: 'error',
    title: 'A file is malformed or not supported',
    cause:
      'A Lottie, dotLottie, glTF, SVG or zip file could not be read. The message says what is wrong with it.',
    fix: 'Re-export the file, or use a feature the loader supports.',
  },
} as const satisfies Record<string, DiagnosticSpec>

/** A code from {@link DIAGNOSTIC_CODES}, such as `'SG2001'`. */
export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES
