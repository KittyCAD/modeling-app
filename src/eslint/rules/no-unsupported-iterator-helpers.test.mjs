import '../../../scripts/register-typescript-eslint-typescript.cjs'
import { fileURLToPath } from 'node:url'
import parser from '@typescript-eslint/parser'
import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'
import rule from './no-unsupported-iterator-helpers.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = (name, testFunction) => it(name, testFunction, 30_000)

const repositoryUrl = new URL('../../..', import.meta.url)
const repositoryPath =
  repositoryUrl.protocol === 'file:'
    ? fileURLToPath(repositoryUrl)
    : repositoryUrl.pathname
const repositoryRoot = repositoryPath
  .replace(/^[/\\]@fs/, '')
  .replace(/^[/\\]([a-zA-Z]:[/\\])/, '$1')
const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      project: './tsconfig.json',
      tsconfigRootDir: repositoryRoot,
    },
  },
})

const filename = `${repositoryRoot}/src/eslint/rules/no-unsupported-iterator-helpers.test.mjs`

ruleTester.run('no-unsupported-iterator-helpers', rule, {
  valid: [
    {
      code: `
        const vector = { toArray: () => [1, 2, 3] }
        vector.toArray()
      `,
      filename,
    },
    {
      code: `
        const widget = { toArray: (_value) => [] }
        widget.toArray(new Map().entries())
      `,
      filename,
    },
    {
      code: `[1, 2, 3].find((value) => value === 2)`,
      filename,
    },
  ],
  invalid: [
    {
      code: `new Map().values().toArray()`,
      filename,
      errors: [{ messageId: 'unsupportedIteratorHelper' }],
    },
    {
      code: `
        const iterator = new Map().values()
        iterator.find((value) => value === 1)
      `,
      filename,
      errors: [{ messageId: 'unsupportedIteratorHelper' }],
    },
    {
      code: `Iterator.from([1, 2, 3]).map((value) => value * 2)`,
      filename,
      errors: [
        { messageId: 'unsupportedIteratorHelper' },
        { messageId: 'unsupportedIteratorHelper' },
      ],
    },
  ],
})
