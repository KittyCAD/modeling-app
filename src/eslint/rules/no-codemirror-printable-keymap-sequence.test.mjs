import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { afterAll, describe, it } from 'vitest'
import rule from './no-codemirror-printable-keymap-sequence.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

ruleTester.run('no-codemirror-printable-keymap-sequence', rule, {
  valid: [
    {
      code: `
        const item = {
          sequence: ['mod+k'],
          registerToCodeMirror: true,
        }
      `,
    },
    {
      code: `
        const item = {
          sequence: ['mod+shift+,'],
          registerToCodeMirror: true,
        }
      `,
    },
    {
      code: `
        const item = {
          sequence: ['v', '1'],
        }
      `,
    },
    {
      code: `
        const item = {
          sequence: ['v', '1'],
          registerToCodeMirror: false,
        }
      `,
    },
    {
      code: `
        const item = {
          sequence: ['Escape'],
          registerToCodeMirror: true,
        }
      `,
    },
    {
      code: `
        const item = {
          sequence,
          registerToCodeMirror: true,
        }
      `,
    },
  ],
  invalid: [
    {
      code: `
        const item = {
          sequence: ['v', '1'],
          registerToCodeMirror: true,
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorSequence' }],
    },
    {
      code: `
        const item = {
          sequence: ['Shift+V'],
          registerToCodeMirror: true,
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorSequence' }],
    },
    {
      code: `
        const item = {
          sequence: [','],
          registerToCodeMirror: true,
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorSequence' }],
    },
    {
      code: `
        const item = {
          sequence: ['alt+x'],
          registerToCodeMirror: true,
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorSequence' }],
    },
    {
      code: `
        provide(keymapValueSpec, {
          sequence: ['Space', 'k'],
          registerToCodeMirror: true,
        })
      `,
      errors: [{ messageId: 'textProducingCodeMirrorSequence' }],
    },
  ],
})
