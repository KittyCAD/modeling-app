import '../../../scripts/register-typescript-eslint-typescript.cjs'
import { Linter, RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { afterAll, describe, expect, it } from 'vitest'
import * as cssParser from '../css-parser.mjs'
import rule from './prefer-theme-utilities.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
}).run('prefer-theme-utilities', rule, {
  valid: [
    '<div className="border-2 b-4/50 bg-2 hover:bg-3/60 text-default" />',
    '<div className={`bg-primary ${active ? "text-2" : "text-default"}`} />',
    'const color = "var(--chalkboard-20)"',
  ],
  invalid: [
    {
      code: '<div className="dark:hover:bg-chalkboard-90/60" />',
      errors: [
        { messageId: 'palette', data: { utility: 'bg-chalkboard-90/60' } },
      ],
    },
    {
      code: '<div className={`p-2 ${active ? "text-chalkboard-30" : "text-default"}`} />',
      errors: [
        { messageId: 'palette', data: { utility: 'text-chalkboard-30' } },
      ],
    },
    {
      code: 'const style = `border-chalkboard-80 ${extra}`',
      errors: [
        { messageId: 'palette', data: { utility: 'border-chalkboard-80' } },
      ],
    },
  ],
})

new RuleTester({ languageOptions: { parser: cssParser } }).run(
  'prefer-theme-utilities in CSS',
  rule,
  {
    valid: [
      '.tab { @apply border b-4/50 bg-2 hover:bg-3/60; }',
      '/* Example: @apply bg-chalkboard-20; */ .tab { color: var(--chalkboard-20); }',
    ],
    invalid: [
      {
        code: '.tab {\n  @apply bg-chalkboard-20 dark:border-chalkboard-80;\n}',
        errors: [
          {
            messageId: 'palette',
            line: 2,
            column: 10,
            data: { utility: 'bg-chalkboard-20' },
          },
          {
            messageId: 'palette',
            line: 2,
            column: 32,
            data: { utility: 'border-chalkboard-80' },
          },
        ],
      },
    ],
  }
)

it('honors an explained CSS exception with the configured rule name', () => {
  const messages = new Linter().verify(
    '/* eslint-disable zds/prefer-theme-utilities -- Deliberate data color. */\n.swatch { @apply bg-chalkboard-20; }',
    {
      languageOptions: { parser: cssParser },
      plugins: { zds: { rules: { 'prefer-theme-utilities': rule } } },
      rules: { 'zds/prefer-theme-utilities': 'warn' },
    }
  )
  expect(messages).toEqual([])
})
