/**
 * Writes the Diagnostics reference page from the code table. Run `npm run
 * gen:diagnostics` after changing `codes.ts`.
 *
 * @remarks
 *   Maintainers: this file and `codes.ts` import nothing, so the generator script
 *   can load them with Node's type stripping.
 */
export interface ReferenceSpec {
  area: string
  level: string
  title: string
  cause: string
  fix?: string
}

const AREAS: Record<string, string> = {
  engine: 'Engine and backend',
  gfx: 'Drawing',
  shader: 'Shaders',
  callbacks: 'Your callbacks',
  api: 'API use',
  assets: 'Assets',
}

export function renderReference(codes: Record<string, ReferenceSpec>): string {
  const out: string[] = []
  out.push(`---
title: Diagnostics
group: Features
order: 24
---

# Diagnostics

Everything the engine says about a problem goes through one place, {@link diagnostics}. Each report has a code such as \`SG2001\`, a level, an area and a message. The console shows it like this:

\`\`\`
[stargazer] SG2014 (gfx): a path shadow has asked for a new blur radius...
  Try: Use strokeSpace: "world" for that shadow so the radius stays still.
  Details: /guides/diagnostics#sg2014
\`\`\`

This page lists every code with its cause and its fix.

## Basic usage

By default the console shows warnings and errors. To see more, or less, set the level with the \`log\` option of {@link createEngineHost} or the \`?log=\` URL flag. The levels are \`error\`, \`warn\`, \`info\`, \`debug\` and \`off\`.

\`\`\`ts
createEngineHost({ canvas, log: 'info' })
// or: https://example.com/game?log=info
\`\`\`

### Sending diagnostics to your own logging

\`diagnostics.on\` calls your function for each diagnostic. Use it to send errors to a log service or to show them in your own interface.

\`\`\`ts
import { diagnostics } from '@julianagaibler/stargazer'

const off = diagnostics.on((d) => {
  if (d.level === 'error') sendToLogs({ code: d.code, message: d.message })
})
// Later:
off()
\`\`\`

\`engine.events\` also emits \`diagnostic\` with the same object. A handler runs the first time a problem happens, and again at 10, 100, 1000 and 10000 repeats. \`diagnostics.countOf(code)\` gives the exact total.

### When your code throws

Game code that throws inside \`onUpdate\`, \`onFixedStep\`, a pointer handler, an event handler or an \`onBeforeFrame\` function does not stop the engine. The engine reports the error with the node it came from, skips that callback for the rest of the frame, and carries on with the other nodes and the render. These are the \`SG4xxx\` codes.

### The debug HUD

The Diagnostics panel in the debug HUD lists recent diagnostics with their counts. See [Debugging](/guides/debugging).

## Advanced usage

\`StargazerError\` is the error the engine throws. It extends \`Error\` and adds \`code\` and \`area\`. The message starts with the code.

\`diagnostics.configure({ console: false })\` stops console output while handlers still run. \`diagnostics.configure({ docsUrl })\` sets the base address for the Details link.

Codes are grouped by thousands: 1xxx engine, 2xxx drawing, 3xxx shaders, 4xxx your callbacks, 5xxx API use and 6xxx assets. A code is never reused.

## Reference
`)
  for (const [area, name] of Object.entries(AREAS)) {
    const entries = Object.entries(codes).filter(([, s]) => s.area === area)
    if (entries.length === 0) continue
    out.push(`### ${name}\n`)
    for (const [code, spec] of entries) {
      out.push(`#### ${code}: ${spec.title}\n`)
      out.push(`Level: ${spec.level}.\n`)
      out.push(`${spec.cause}\n`)
      if (spec.fix) out.push(`**What to do:** ${spec.fix}\n`)
    }
  }
  out.push(`## See also

- {@link Diagnostics}: the class behind \`diagnostics\`
- {@link StargazerError}: the error the engine throws
- [Debugging](/guides/debugging): the HUD
- [Testing](/guides/testing): keeping diagnostics out of test output
`)
  return out.join('\n')
}
