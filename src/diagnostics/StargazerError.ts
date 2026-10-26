import {
  DIAGNOSTIC_CODES,
  type DiagnosticArea,
  type DiagnosticCode,
} from './codes'

/**
 * An error thrown by stargazer. It carries the diagnostic `code`, which
 * [Diagnostics](/guides/diagnostics) lists with its cause and fix.
 *
 * @example
 *   try {
 *     engine.attachStage(canvas)
 *   } catch (error) {
 *     if (error instanceof StargazerError)
 *       console.log(error.code, error.area)
 *   }
 */
export class StargazerError extends Error {
  readonly code: DiagnosticCode
  readonly area: DiagnosticArea
  /** What to try, when the diagnostic has a standard fix. */
  readonly hint: string | undefined

  constructor(
    code: DiagnosticCode,
    message: string,
    options: { cause?: unknown; hint?: string } = {},
  ) {
    super(`[${code}] ${message}`, { cause: options.cause })
    this.name = 'StargazerError'
    this.code = code
    this.area = DIAGNOSTIC_CODES[code].area
    this.hint = options.hint
  }
}
