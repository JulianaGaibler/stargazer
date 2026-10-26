import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/**
 * Component styles are indented Sass, and Sass rejects a document that starts
 * with indentation. This removes the indentation the block shares.
 *
 * @param {string} source - The Sass source of the style block.
 * @returns {string} The source without its common indentation.
 */
export const dedent = (source) => {
  const lines = source.split('\n')
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.match(/^ */)[0].length)
  const common = Math.min(...indents, Infinity)
  if (!Number.isFinite(common) || common === 0) return source
  return lines
    .map((line) => line.slice(Math.min(common, line.length)))
    .join('\n')
}

export default {
  preprocess: vitePreprocess({
    style: {
      css: {
        preprocessorOptions: {
          sass: { additionalData: dedent },
        },
      },
    },
  }),
}
