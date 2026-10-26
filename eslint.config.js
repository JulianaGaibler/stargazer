import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import ts from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import svelteConfig from './svelte.config.js'
import globals from 'globals'

export default ts.config(
  js.configs.recommended,
  ts.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  ...svelte.configs['flat/recommended'],
  {
    // `.svelte.ts` modules hold runes, so they go through the same parser pair
    // as components: the svelte parser, with TypeScript underneath.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig: svelteConfig,
      },
    },
  },
  {
    rules: {
      'svelte/no-at-html-tags': 'off',
    },
  },
  {
    // Errors the engine throws carry a code, so a consumer can look them up.
    files: ['src/**/*.ts', 'src/**/*.svelte'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message: 'Throw a StargazerError with a diagnostic code.',
        },
      ],
    },
  },
  prettierConfig,
  {
    languageOptions: {
      globals: {
        ...globals.nodeBuiltin,
        ...globals.browser,
      },
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      'site/',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },
)
