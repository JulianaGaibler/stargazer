// Builds `dist/`: the package as consumers install it.
//
// `svelte-package` compiles the TypeScript and writes the declarations. It
// keeps `.svelte` files as source, so the consumer's Svelte version compiles
// them. It also leaves Vite-only syntax in place, which this script replaces so
// that `dist/` needs no particular bundler:
//   - `import x from './a.wgsl?raw'` becomes an import of a generated module
//     that exports the file's text.
//   - `import x from './a.json'` becomes an import of a generated module, so
//     that no bundler or JSON import attribute is needed.
//   - The debug styles, a Sass file, become a module that adds a <style>
//     element when it is first loaded.
//
// Usage: npm run build

import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const staged = join(root, '.build', 'src')
const dist = join(root, 'dist')

// What the package does not ship: tests, test helpers, demos, docs and
// generated docs.
const SKIP_DIRS = new Set(['docs', 'site'])

function isShipped(path) {
  const rel = relative(join(root, 'src'), path)
  if (rel === '') return true
  const parts = rel.split('/')
  if (SKIP_DIRS.has(parts[0]) && parts.length >= 1) return false
  const name = parts[parts.length - 1]
  return (
    !name.endsWith('.test.ts') &&
    !parts.slice(0, -1).includes('testing') &&
    name !== '.DS_Store' &&
    !parts.includes('node_modules')
  )
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

rmSync(join(root, '.build'), { recursive: true, force: true })
rmSync(dist, { recursive: true, force: true })
cpSync(join(root, 'src'), staged, { recursive: true, filter: isShipped })

const packaged = spawnSync(
  'npx',
  ['svelte-package', '-i', '.build/src', '-o', 'dist', '-t', 'tsconfig.json'],
  { cwd: root, stdio: 'inherit' },
)
if (packaged.status !== 0) process.exit(packaged.status ?? 1)

// Relative imports without a file extension, which Node's ESM loader rejects.
const RELATIVE = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)'(\.{1,2}\/[^']*)'/g
function withExtension(dir, spec, declaration) {
  const suffix = declaration ? '.d.ts' : '.js'
  if (/\.(js|svelte|json|bin|sass)$/.test(spec)) return spec
  if (existsSync(join(dir, spec + suffix))) return `${spec}.js`
  if (existsSync(join(dir, spec, 'index' + suffix))) return `${spec}/index.js`
  return spec
}
for (const file of walk(dist)) {
  const declaration = file.endsWith('.d.ts')
  if (!declaration && !file.endsWith('.js')) continue
  const source = readFileSync(file, 'utf8')
  const rewritten = source.replace(RELATIVE, (_, lead, spec) => {
    return `${lead}'${withExtension(dirname(file), spec, declaration)}'`
  })
  if (rewritten !== source) writeFileSync(file, rewritten)
}

// Text imports.
const RAW = /(from\s+|import\s*\(\s*)'([^']+)\?raw'/g
const rawFiles = new Set()
for (const file of walk(dist)) {
  if (!file.endsWith('.js')) continue
  const source = readFileSync(file, 'utf8')
  if (!source.includes('?raw')) continue
  const rewritten = source.replace(RAW, (_, lead, spec) => {
    const target = join(dirname(file), spec)
    rawFiles.add(target)
    return `${lead}'${spec}.js'`
  })
  writeFileSync(file, rewritten)
}
for (const target of rawFiles) {
  const text = readFileSync(target, 'utf8')
  writeFileSync(`${target}.js`, `export default ${JSON.stringify(text)}\n`)
  writeFileSync(
    `${target}.d.ts`,
    'declare const text: string\nexport default text\n',
  )
}
// JSON imports.
const JSON_IMPORT = /(from\s+)'([^']+\.json)'/g
const jsonFiles = new Set()
for (const file of walk(dist)) {
  if (!file.endsWith('.js')) continue
  const source = readFileSync(file, 'utf8')
  if (!JSON_IMPORT.test(source)) continue
  JSON_IMPORT.lastIndex = 0
  writeFileSync(
    file,
    source.replace(JSON_IMPORT, (_, lead, spec) => {
      jsonFiles.add(join(dirname(file), spec))
      return `${lead}'${spec}.js'`
    }),
  )
}
for (const target of jsonFiles) {
  const text = readFileSync(target, 'utf8')
  writeFileSync(`${target}.js`, `export default ${text.trim()}\n`)
  writeFileSync(
    `${target}.d.ts`,
    'declare const data: unknown\nexport default data\n',
  )
}
for (const target of jsonFiles) rmSync(target)

// Files that no module imports as text are not needed in the package.
for (const target of rawFiles) rmSync(target)

// Debug styles.
const stylesSource = join(staged, 'debug/ui/debug-ui.sass')
const indexFile = join(dist, 'debug/ui/index.js')
const index = readFileSync(indexFile, 'utf8')
if (!index.includes(`'./debug-ui.sass'`)) {
  throw new Error('build: debug/ui/index.js no longer imports debug-ui.sass')
}
const css = sass.compile(stylesSource).css
writeFileSync(
  join(dist, 'debug/ui/debug-ui.css.js'),
  `const id = 'stargazer-debug-ui'
if (typeof document !== 'undefined' && !document.getElementById(id)) {
  const style = document.createElement('style')
  style.id = id
  style.textContent = ${JSON.stringify(css)}
  document.head.append(style)
}
`,
)
writeFileSync(join(dist, 'debug/ui/debug-ui.css.d.ts'), 'export {}\n')
writeFileSync(
  indexFile,
  index.replace(`'./debug-ui.sass'`, `'./debug-ui.css.js'`),
)
const declarationFile = join(dist, 'debug/ui/index.d.ts')
writeFileSync(
  declarationFile,
  readFileSync(declarationFile, 'utf8').replace(
    `import './debug-ui.sass';\n`,
    '',
  ),
)
rmSync(join(dist, 'debug/ui/debug-ui.sass'), { force: true })

// Nothing Vite-specific may remain.
const leftovers = []
for (const file of walk(dist)) {
  if (!/\.(js|svelte)$/.test(file)) continue
  const source = readFileSync(file, 'utf8')
  if (/'[^']+\?(raw|url|inline)'/.test(source)) leftovers.push(file)
}
if (leftovers.length > 0) {
  throw new Error(`build: query imports remain in\n${leftovers.join('\n')}`)
}
rmSync(join(root, '.build'), { recursive: true, force: true })
console.log(`build: wrote ${relative(root, dist)}/`)
