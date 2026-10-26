import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'
import { dedent } from '../svelte.config.js'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  plugins: [
    svelte({
      configFile: fileURLToPath(
        new URL('../svelte.config.js', import.meta.url),
      ),
    }),
  ],
  // The engine's own components have indented Sass, which needs the same
  // dedent the tests use.
  css: { preprocessorOptions: { sass: { additionalData: dedent } } },
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../demo-dist', emptyOutDir: true },
})
