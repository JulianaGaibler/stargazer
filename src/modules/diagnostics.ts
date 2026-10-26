/**
 * Reports from the engine. Everything the engine says about a problem goes
 * through {@link diagnostics}: a code, an area, a message and usually a fix.
 * Send them to your own logging with `diagnostics.on`, or change what reaches
 * the console with `diagnostics.configure`. {@link StargazerError} is the error
 * the engine throws. {@link DIAGNOSTIC_CODES} lists every code.
 *
 * @module diagnostics
 */
export { diagnostics, Diagnostics } from '../diagnostics/Diagnostics'
export type {
  Diagnostic,
  DiagnosticHandler,
  DiagnosticLevel,
  DiagnosticsConfig,
  ReportOptions,
} from '../diagnostics/Diagnostics'
export { DIAGNOSTIC_CODES } from '../diagnostics/codes'
export type {
  DiagnosticArea,
  DiagnosticCode,
  DiagnosticSpec,
} from '../diagnostics/codes'
export { StargazerError } from '../diagnostics/StargazerError'
