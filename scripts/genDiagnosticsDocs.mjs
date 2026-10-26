// Writes src/docs/guides/diagnostics.md from the table in
// src/diagnostics/codes.ts.
//
// Usage: npm run gen:diagnostics

import { writeFileSync } from 'node:fs'
import { DIAGNOSTIC_CODES } from '../src/diagnostics/codes.ts'
import { renderReference } from '../src/diagnostics/reference.ts'

const target = new URL('../src/docs/guides/diagnostics.md', import.meta.url)
writeFileSync(target, renderReference(DIAGNOSTIC_CODES))
console.log('wrote', target.pathname)
