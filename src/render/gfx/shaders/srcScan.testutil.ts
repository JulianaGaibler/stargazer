import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Walk up from this file to the `src` directory that contains it. */
function findSrcRoot(from: string): string {
  let dir = from
  while (dirname(dir) !== dir) {
    if (dir.endsWith('/src')) return dir
    dir = dirname(dir)
  }
  return from
}

/** Recursively collect every file under `dir` whose name matches `suffix`. */
function collectFiles(dir: string, suffix: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(full, suffix))
    else if (entry.name.endsWith(suffix)) out.push(full)
  }
  return out
}

/** Every file under the engine's `src` directory ending in `suffix`. */
export function filesUnderSrc(suffix: string): string[] {
  const here = dirname(fileURLToPath(import.meta.url))
  return collectFiles(findSrcRoot(here), suffix)
}
