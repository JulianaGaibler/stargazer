/**
 * The widgets the debug HUD is built from, for building your own panels. Import
 * this entry only in code that shows a debug UI. It loads the debug styles, so
 * an app that never imports it pays nothing for them.
 *
 * @module debug-ui
 */
export { default as DebugHud } from './debug/DebugHud.svelte'
export * from './debug/ui'
