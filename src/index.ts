// stargazer, public entrypoint.
//
// Everything the game code touches is re-exported from here. Do not import
// from stargazer's internal subpaths. They can change without notice.
//
// The module files are also the typedoc entry points, so this entry exports
// exactly what the docs describe.

export * from './modules/engine'
export * from './modules/scene'
export * from './modules/layout'
export * from './modules/nodes'
export * from './modules/camera'
export * from './modules/anim'
export * from './modules/particles'
export * from './modules/physics'
export * from './modules/input'
export * from './modules/events'
export * from './modules/assets'
export * from './modules/render'
export * from './modules/math'
export * from './modules/ai'
export * from './modules/dom'
export * from './modules/a11y'
export * from './modules/lottie'
export * from './modules/debug'
export * from './modules/diagnostics'
export * from './modules/svelte'
