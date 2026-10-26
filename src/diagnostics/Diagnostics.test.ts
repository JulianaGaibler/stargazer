import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DIAGNOSTIC_CODES } from './codes'
import { Diagnostics, reportThrown } from './Diagnostics'
import { renderReference } from './reference'
import { StargazerError } from './StargazerError'
import { createEmitter } from '../events/Emitter'

describe('Diagnostics', () => {
  let diag: Diagnostics
  beforeEach(() => {
    diag = new Diagnostics()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('writes one console line with the code, area and a hint', () => {
    diag.report('SG2002', 'clipPath ignored')
    expect(console.warn).toHaveBeenCalledTimes(1)
    const text = vi.mocked(console.warn).mock.calls[0][0] as string
    expect(text).toContain('[stargazer] SG2002 (gfx): clipPath ignored')
    expect(text).toContain('Try:')
    expect(text).toContain('#sg2002')
  })

  it('counts a repeat but logs it again only at milestones', () => {
    for (let i = 0; i < 12; i++) diag.report('SG2002', 'same')
    expect(console.warn).toHaveBeenCalledTimes(2)
    expect(diag.countOf('SG2002')).toBe(12)
    expect(vi.mocked(console.warn).mock.calls[1][0]).toContain('seen 10 times')
  })

  it('treats a different key as a different problem', () => {
    diag.report('SG2001', 'blend a', { key: 'a' })
    diag.report('SG2001', 'blend b', { key: 'b' })
    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it('filters by level but still counts', () => {
    diag.report('SG1004', 'backend webgl2')
    expect(console.info).not.toHaveBeenCalled()
    diag.configure({ level: 'info' })
    diag.report('SG1004', 'backend webgpu')
    expect(console.info).toHaveBeenCalledTimes(1)
    diag.configure({ level: 'off' })
    diag.report('SG1001', 'stopped')
    expect(console.error).not.toHaveBeenCalled()
    expect(diag.countOf('SG1001')).toBe(1)
  })

  it('sends diagnostics to handlers and keeps going when one throws', () => {
    const seen: string[] = []
    diag.on(() => {
      throw new Error('bad handler')
    })
    const off = diag.on((d) => seen.push(d.code))
    diag.configure({ console: false })
    diag.report('SG2002', 'x')
    expect(seen).toEqual(['SG2002'])
    off()
    diag.report('SG2002', 'y')
    expect(seen).toHaveLength(1)
    expect(diag.recent.map((d) => d.message)).toEqual(['x', 'y'])
  })

  it('passes the cause to the console', () => {
    const cause = new Error('boom')
    diag.report('SG1001', 'stopped', { cause })
    expect(console.error).toHaveBeenCalledWith(expect.any(String), cause)
  })
})

describe('StargazerError', () => {
  it('carries the code and area and starts its message with the code', () => {
    const error = new StargazerError('SG1005', 'no backend', { hint: 'try' })
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('SG1005')
    expect(error.area).toBe('engine')
    expect(error.message).toBe('[SG1005] no backend')
    expect(error.hint).toBe('try')
  })
})

describe('callbacks that throw', () => {
  it('keeps the other emitter handlers running and reports the error', async () => {
    const { diagnostics } = await import('./Diagnostics')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const before = diagnostics.countOf('SG4003')
    const emitter = createEmitter<{ tick: number }>()
    const seen: number[] = []
    emitter.on('tick', () => {
      throw new Error('handler failed')
    })
    emitter.on('tick', (n) => seen.push(n))
    emitter.emit('tick', 7)
    expect(seen).toEqual([7])
    expect(diagnostics.countOf('SG4003')).toBe(before + 1)
    vi.restoreAllMocks()
  })

  it('names the node and the callback', async () => {
    const { diagnostics } = await import('./Diagnostics')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen: { node?: string; message: string }[] = []
    const off = diagnostics.on((d) => seen.push(d))
    reportThrown('SG4001', 'onUpdate', new Error('unique-x'), 'player')
    off()
    vi.restoreAllMocks()
    expect(seen).toHaveLength(1)
    expect(seen[0].node).toBe('player')
    expect(seen[0].message).toBe('onUpdate threw: unique-x')
  })
})

describe('the code table', () => {
  const sources: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (name !== 'site' && name !== 'node_modules') walk(path)
      } else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) {
        sources.push(readFileSync(path, 'utf8'))
      }
    }
  }
  walk(join(process.cwd(), 'src'))
  const code = sources
    .filter((s) => !s.includes('export const DIAGNOSTIC_CODES'))
    .join('\n')

  it('has an entry for every code used in the source', () => {
    const used = new Set(code.match(/'SG\d{4}'/g)?.map((c) => c.slice(1, -1)))
    for (const c of used) expect(DIAGNOSTIC_CODES, c).toHaveProperty(c)
  })

  it('is used: no code is listed without a report', () => {
    for (const c of Object.keys(DIAGNOSTIC_CODES)) {
      expect(code, `${c} is never reported`).toContain(`'${c}'`)
    }
  })

  it('matches the generated reference page', () => {
    const page = readFileSync(
      join(process.cwd(), 'src/docs/guides/diagnostics.md'),
      'utf8',
    )
    expect(page, 'run npm run gen:diagnostics').toBe(
      renderReference(DIAGNOSTIC_CODES),
    )
  })
})
