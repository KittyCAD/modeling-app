import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'
import rule from './no-codemirror-printable-keymap-keystrokes.mjs'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

ruleTester.run('no-codemirror-printable-keymap-keystrokes', rule, {
  valid: [
    {
      code: `
        const item = {
          keystrokes: ['mod+k'],
        }
      `,
    },
    {
      code: `
        const item = {
          keystrokes: ['mod+shift+,'],
        }
      `,
    },
    {
      code: `
        const item = {
          keystrokes: ['v', '1'],
          scopes: ['settings-open'],
        }
      `,
    },
    {
      code: `
        const item = {
          keystrokes: ['Escape'],
        }
      `,
    },
    {
      code: `
        const item = {
          keystrokes,
        }
      `,
    },
    {
      code: `
        const item = {
          keystrokes: ['v', '1'],
          scopes: ['code-editor-not-focused'],
        }
      `,
    },
  ],
  invalid: [
    {
      code: `
        const item = {
          keystrokes: ['v', '1'],
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorKeystrokes' }],
    },
    {
      code: `
        const item = {
          keystrokes: [','],
          scopes: ['base'],
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorKeystrokes' }],
    },
    {
      code: `
        const item = {
          keystrokes: ['Shift+V'],
          scopes: ['code-editor-focused'],
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorKeystrokes' }],
    },
    {
      code: `
        provide(keymapValueSpec, {
          keystrokes: ['Space', 'k'],
          scopes: ['code-editor-focused'],
        })
      `,
      errors: [{ messageId: 'textProducingCodeMirrorKeystrokes' }],
    },
  ],
})
