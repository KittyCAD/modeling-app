import '../../../scripts/register-typescript-eslint-typescript.cjs'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { afterAll, describe, it } from 'vitest'
import rule from './require-catalog-entrypoints.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'catalog-lint-'))
afterAll(() => rmSync(temporaryDirectory, { recursive: true, force: true }))
let fixtureIndex = 0
function fixture(entrypoints, catalog = 'catalog.ts') {
  const root = path.join(temporaryDirectory, String(fixtureIndex++), 'src')
  mkdirSync(path.join(root, 'registry'), { recursive: true })
  for (const entrypoint of entrypoints) {
    const filename = path.join(root, entrypoint)
    mkdirSync(path.dirname(filename), { recursive: true })
    // The rule inspects paths and syntax; it never executes extension code.
    writeFileSync(filename, 'throw new Error("Do not import during lint")')
  }
  return path.join(root, 'registry', catalog)
}

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

ruleTester.run('require-catalog-entrypoints', rule, {
  valid: [
    {
      filename: fixture([
        'registry/extensions/example/index.ts',
        'registry/plugins/tool/index.ts',
        'lib/library/registry/index.ts',
        'lang/language/registry/index.ts',
        'registry/extensions/example/nested/index.ts',
        'registry/plugins/tool/helper.ts',
      ]),
      code: `
        import example from './extensions/example'
        import { default as tool } from '@src/registry/plugins/tool/index.ts'
        import library from '../lib/library/registry'
        import language from '@src/lang/language/registry/index'
        export const bundledRegistryItemCatalog = {
          'example': example, tool, library, language,
        } satisfies Record<string, unknown>
      `,
    },
    {
      filename: fixture(['registry/extensions/optional/index.ts']),
      code: `
        import optional from '@src/registry/extensions/optional'
        export const bundledRegistryItemCatalog = { optional }
        export const defaultRegistryItemIds = []
      `,
    },
    {
      filename: fixture(
        ['registry/plugins/tool/electron.ts'],
        'electronPlugins.ts'
      ),
      code: `
        import { register as registerTool } from './plugins/tool/electron'
        export const bundledElectronPluginRegistrations = [registerTool]
      `,
    },
    {
      filename: fixture(['registry/extensions/new/index.ts'], 'unrelated.ts'),
      code: 'export const unrelated = {}',
    },
  ],
  invalid: [
    ...[
      'registry/extensions/new/index.ts',
      'registry/plugins/new/index.ts',
      'lib/new/registry/index.ts',
      'lang/new/registry/index.ts',
    ].map((entrypoint) => ({
      filename: fixture([entrypoint]),
      code: 'export const bundledRegistryItemCatalog = {}',
      errors: [
        {
          messageId: 'missingEntrypoint',
          data: {
            entrypoint,
            catalog: 'catalog.ts',
            importName: 'default',
            binding: 'bundledRegistryItemCatalog',
          },
        },
      ],
    })),
    {
      filename: fixture(['registry/extensions/new/index.ts']),
      code: `
        import unused from './extensions/new'
        export const bundledRegistryItemCatalog = {}
      `,
      errors: [{ messageId: 'missingEntrypoint' }],
    },
    {
      filename: fixture(['registry/extensions/new/index.ts']),
      code: `
        import type unused from './extensions/new'
        export const bundledRegistryItemCatalog = { unused }
      `,
      errors: [{ messageId: 'missingEntrypoint' }],
    },
    {
      filename: fixture(
        ['registry/plugins/new/electron.ts'],
        'electronPlugins.ts'
      ),
      code: `
        import { register as unused } from './plugins/new/electron.ts'
        export const bundledElectronPluginRegistrations = []
      `,
      errors: [{ messageId: 'missingEntrypoint' }],
    },
    {
      filename: fixture(
        ['registry/plugins/new/electron.ts'],
        'electronPlugins.ts'
      ),
      code: 'export const bundledElectronPluginRegistrations = []',
      errors: [{ messageId: 'missingEntrypoint' }],
    },
  ],
})
