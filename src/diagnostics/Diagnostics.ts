import {
  DIAGNOSTIC_CODES,
  type DiagnosticArea,
  type DiagnosticCode,
  type DiagnosticSpec,
} from './codes'

/** How serious a diagnostic is, from most to least. */
export type DiagnosticLevel = 'error' | 'warn' | 'info' | 'debug'

const LEVEL_RANK: Record<DiagnosticLevel | 'off', number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  off: -1,
}

/** One report from the engine. */
export interface Diagnostic {
  code: DiagnosticCode
  level: DiagnosticLevel
  area: DiagnosticArea
  /** What happened, in this instance. */
  message: string
  /** What to try, when there is a standard fix. */
  hint?: string
  /** The error behind this report, if there was one. */
  cause?: unknown
  /** Which node was involved, as `id` or `kind#id`. */
  node?: string
  /** How many times this code and key have been reported, including this one. */
  count: number
  /** `performance.now()` at the time of the report. */
  time: number
}

/** Options for {@link Diagnostics.report}. */
export interface ReportOptions {
  /**
   * What makes two reports the same problem. Reports with the same code and key
   * are counted and logged once. The default is the message.
   */
  key?: string
  hint?: string
  cause?: unknown
  node?: string
  /** Use this level instead of the code's own. */
  level?: DiagnosticLevel
}

/** Settings for {@link Diagnostics.configure}. */
export interface DiagnosticsConfig {
  /**
   * The least serious level that is logged and sent to handlers. `'off'` turns
   * logging off. The default is `'warn'`.
   */
  level?: DiagnosticLevel | 'off'
  /** Write to the browser console. The default is true. */
  console?: boolean
  /** Base URL for the links in console output. */
  docsUrl?: string
}

/** Receives each diagnostic that passes the level. */
export type DiagnosticHandler = (diagnostic: Diagnostic) => void

const DEFAULT_DOCS_URL = '/guides/diagnostics'
const HISTORY_SIZE = 200
// A repeat is logged again at these counts, so a problem that keeps happening
// stays visible without filling the console.
const REPEAT_MILESTONES = new Set([10, 100, 1000, 10000])

/**
 * The one place the engine reports problems. Reports are structured, counted
 * and deduplicated, then written to the console and sent to handlers.
 *
 * Use the shared {@link diagnostics} instance.
 *
 * @example
 *   import { diagnostics } from '@julianagaibler/stargazer'
 *
 *   // Send every warning and error to your own logging.
 *   const off = diagnostics.on((d) => sendToLogs(d.code, d.message))
 *   // Show less in the console.
 *   diagnostics.configure({ level: 'error' })
 */
export class Diagnostics {
  readonly #handlers = new Set<DiagnosticHandler>()
  readonly #counts = new Map<string, number>()
  readonly #recent: Diagnostic[] = []
  #level: DiagnosticLevel | 'off' = 'warn'
  #console = true
  #docsUrl = DEFAULT_DOCS_URL

  /** Change how diagnostics are logged. Only the given settings change. */
  configure(config: DiagnosticsConfig): void {
    if (config.level !== undefined) this.#level = config.level
    if (config.console !== undefined) this.#console = config.console
    if (config.docsUrl !== undefined) this.#docsUrl = config.docsUrl
  }

  /** The lowest level that is logged to the console, or `off`. */
  get level(): DiagnosticLevel | 'off' {
    return this.#level
  }

  /**
   * Call `handler` for each diagnostic that passes the level, the first time it
   * happens and again at 10, 100, 1000 and 10000 repeats. Returns an
   * unsubscribe function.
   */
  on(handler: DiagnosticHandler): () => void {
    this.#handlers.add(handler)
    return () => this.#handlers.delete(handler)
  }

  /** The latest diagnostics that were logged, oldest first. */
  get recent(): readonly Diagnostic[] {
    return this.#recent
  }

  /** How many times `code` has been reported, whatever the level setting. */
  countOf(code: DiagnosticCode): number {
    let total = 0
    for (const [key, n] of this.#counts) {
      if (key.startsWith(code + '\0')) total += n
    }
    return total
  }

  /**
   * Report a problem. The code decides the level and the area. `message` says
   * what happened this time.
   */
  report(
    code: DiagnosticCode,
    message: string,
    options: ReportOptions = {},
  ): void {
    const spec: DiagnosticSpec = DIAGNOSTIC_CODES[code]
    const level = options.level ?? spec.level
    const id = `${code}\0${options.key ?? message}`
    const count = (this.#counts.get(id) ?? 0) + 1
    this.#counts.set(id, count)
    if (LEVEL_RANK[level] > LEVEL_RANK[this.#level]) return
    if (count > 1 && !REPEAT_MILESTONES.has(count)) return

    const diagnostic: Diagnostic = {
      code,
      level,
      area: spec.area,
      message,
      count,
      time: performance.now(),
    }
    if (options.hint !== undefined) diagnostic.hint = options.hint
    else if (spec.fix) diagnostic.hint = spec.fix
    if (options.cause !== undefined) diagnostic.cause = options.cause
    if (options.node !== undefined) diagnostic.node = options.node

    this.#recent.push(diagnostic)
    if (this.#recent.length > HISTORY_SIZE) this.#recent.shift()
    if (this.#console) this.#write(diagnostic)
    for (const handler of this.#handlers) {
      try {
        handler(diagnostic)
      } catch (error) {
        // A failing handler must not hide the report or break the engine.
        console.error('[stargazer] a diagnostics handler threw', error)
      }
    }
  }

  /** Forget the history and the counts. */
  clear(): void {
    this.#recent.length = 0
    this.#counts.clear()
  }

  #write(d: Diagnostic): void {
    const where = d.node ? ` (${d.area}, ${d.node})` : ` (${d.area})`
    const repeats = d.count > 1 ? ` [seen ${d.count} times]` : ''
    let text = `[stargazer] ${d.code}${where}: ${d.message}${repeats}`
    if (d.hint) text += `\n  Try: ${d.hint}`
    text += `\n  Details: ${this.#docsUrl}#${d.code.toLowerCase()}`
    const write =
      d.level === 'error'
        ? console.error
        : d.level === 'warn'
          ? console.warn
          : d.level === 'info'
            ? console.info
            : console.debug
    if (d.cause !== undefined) write(text, d.cause)
    else write(text)
  }
}

/** The engine's shared diagnostics. */
export const diagnostics = new Diagnostics()

/**
 * Report an error that game code threw inside a callback the engine called.
 * `what` names the callback, such as `onUpdate`. Repeats of the same error from
 * the same node are counted, not logged again.
 *
 * @remarks
 *   Maintainers: wrap each callback separately, so one failing callback does not
 *   skip the others in the same frame.
 */
export function reportThrown(
  code: DiagnosticCode,
  what: string,
  error: unknown,
  node?: string,
): void {
  const reason = error instanceof Error ? error.message : String(error)
  diagnostics.report(code, `${what} threw: ${reason}`, {
    key: `${node ?? ''}|${what}|${reason}`,
    cause: error,
    ...(node !== undefined ? { node } : {}),
  })
}
