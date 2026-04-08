import { defineConfig, globalIgnores } from 'eslint/config'
import { fixupConfigRules, fixupPluginRules } from '@eslint/compat'
import reactPerf from 'eslint-plugin-react-perf'
import cssModules from 'eslint-plugin-css-modules'
import jsxA11Y from 'eslint-plugin-jsx-a11y'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import suggestNoThrow from 'eslint-plugin-suggest-no-throw'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const relativeImportPackageRoots = ['src/lib/extensions']
const relativeImportPackageRootPaths = relativeImportPackageRoots.map((root) =>
  path.resolve(__dirname, root)
)

function getRelativeImportPackageRoot(filename) {
  const absoluteFilename = path.resolve(filename)

  for (const rootPath of relativeImportPackageRootPaths) {
    if (
      absoluteFilename === rootPath ||
      absoluteFilename.startsWith(`${rootPath}${path.sep}`)
    ) {
      return rootPath
    }
  }

  return null
}

const workspaceRules = {
  'no-relative-outside-package-root': {
    meta: {
      type: 'problem',
      docs: {
        description:
          'Allow relative imports only when they stay inside the same package-like folder.',
      },
      schema: [],
      messages: {
        outsidePackageRoot:
          'Relative import "{{importPath}}" escapes package root "{{packageRoot}}". Use an absolute import instead.',
      },
    },
    create(context) {
      const filename =
        context.filename && context.filename !== '<input>'
          ? context.filename
          : context.getFilename()
      const packageRoot = getRelativeImportPackageRoot(filename)

      if (!packageRoot) {
        return {}
      }

      function checkSource(sourceNode) {
        const importPath = sourceNode.value

        if (
          typeof importPath !== 'string' ||
          (!importPath.startsWith('./') && !importPath.startsWith('../'))
        ) {
          return
        }

        const resolvedPath = path.resolve(path.dirname(filename), importPath)
        const relativeToRoot = path.relative(packageRoot, resolvedPath)

        if (
          relativeToRoot.startsWith('..') ||
          path.isAbsolute(relativeToRoot)
        ) {
          context.report({
            node: sourceNode,
            messageId: 'outsidePackageRoot',
            data: {
              importPath,
              packageRoot: path.relative(__dirname, packageRoot),
            },
          })
        }
      }

      return {
        ImportDeclaration(node) {
          checkSource(node.source)
        },
        ExportAllDeclaration(node) {
          if (node.source) {
            checkSource(node.source)
          }
        },
        ExportNamedDeclaration(node) {
          if (node.source) {
            checkSource(node.source)
          }
        },
        ImportExpression(node) {
          if (node.source.type === 'Literal') {
            checkSource(node.source)
          }
        },
      }
    },
  },
}

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

export default defineConfig([
  globalIgnores([
    'rust/**/*.ts',
    '!rust/kcl-language-server/client/src/**/*.ts',
    '**/*.typegen.ts',
    'packages/codemirror-lsp-client/dist/*',
    'e2e/playwright/snapshots/prompt-to-edit/*',
    '**/.vscode-test',
  ]),
  {
    files: ['**/*.ts', '**/*.tsx'],
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    extends: fixupConfigRules(
      compat.extends(
        'plugin:css-modules/recommended',
        'plugin:jsx-a11y/recommended',
        'plugin:react-hooks/recommended'
      )
    ),

    plugins: {
      workspace: {
        rules: workspaceRules,
      },
      'react-perf': reactPerf,
      'css-modules': fixupPluginRules(cssModules),
      'jsx-a11y': fixupPluginRules(jsxA11Y),
      react,
      'react-hooks': fixupPluginRules(reactHooks),
      'suggest-no-throw': suggestNoThrow,
      '@typescript-eslint': typescriptEslint,
    },

    languageOptions: {
      parser: tsParser,
      ecmaVersion: 5,
      sourceType: 'script',

      parserOptions: {
        project: './tsconfig.json',
      },
    },

    settings: {
      react: {
        version: 'detect',
      },
    },

    rules: {
      'no-array-constructor': 'off',
      '@typescript-eslint/no-array-constructor': 'error',
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-duplicate-enum-values': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'error',
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/no-extra-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      'no-implied-eval': 'off',
      '@typescript-eslint/no-implied-eval': 'error',

      '@typescript-eslint/no-invalid-void-type': [
        'error',
        {
          allowAsThisParameter: true,
        },
      ],

      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-type-constraint': 'error',
      '@typescript-eslint/no-unnecessary-type-parameters': 'error',
      'no-unused-vars': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          vars: 'all',
          args: 'none',
        },
      ],

      '@typescript-eslint/no-unsafe-unary-minus': 'error',
      '@typescript-eslint/no-wrapper-object-types': 'error',
      'no-throw-literal': 'off',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-as-const': 'warn',
      '@typescript-eslint/prefer-namespace-keyword': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/unbound-method': 'error',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-autofocus': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'react/no-unknown-property': 'error',

      'no-restricted-globals': [
        'error',
        {
          name: 'isNaN',
          message: 'Use Number.isNaN() instead.',
        },
      ],

      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='Array'][callee.property.name='isArray']",
          message: 'Use isArray() in lib/utils.ts instead of Array.isArray().',
        },
        {
          selector:
            "CallExpression[callee.object.name='TOML'][callee.property.name='stringify']",
          message:
            'Do not use TOML.stringify directly. Use the wrappers in test-utils instead like settingsToToml.',
        },
        {
          selector:
            "CallExpression[callee.object.name='TOML'][callee.property.name='parse']",
          message:
            'Do not use TOML.parse directly. Use the wrappers in test-utils instead like tomlToSettings.',
        },
        {
          selector:
            "CallExpression[callee.property.name='split'] > Literal[value='/']",
          message: "Avoid using split with '/'.",
        },
        {
          selector:
            "CallExpression[callee.property.name='join'] > Literal[value='/']",
          message: "Avoid using join with '/'.",
        },
      ],

      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['./*', '../*', '!./*.css', '!../*.css'],
              message: 'Use absolute imports instead.',
            },
          ],
        },
      ],

      'no-warning-comments': [
        'error',
        {
          terms: ['Menu.setApplicationMenu(null)'],
        },
      ],

      semi: ['error', 'never'],
      'react-hooks/exhaustive-deps': 'error',
      'suggest-no-throw/suggest-no-throw': 'error',
    },
  },
  {
    files: ['e2e/**/*.ts'],
    extends: compat.extends('plugin:testing-library/react'),

    rules: {
      'suggest-no-throw/suggest-no-throw': 'off',
      'testing-library/prefer-screen-queries': 'off',
    },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    extends: compat.extends('plugin:testing-library/react'),

    rules: {
      'suggest-no-throw/suggest-no-throw': 'off',
    },
  },
  {
    files: relativeImportPackageRoots.map((root) => `${root}/**/*.{ts,tsx}`),
    rules: {
      'no-restricted-imports': 'off',
      'suggest-no-throw/suggest-no-throw': 'off',
      'workspace/no-relative-outside-package-root': 'error',
    },
  },
  {
    files: ['packages/**/*.ts', 'rust/**/*.ts'],
    extends: compat.extends(),

    rules: {
      'no-restricted-imports': 'off',
    },
  },
])
