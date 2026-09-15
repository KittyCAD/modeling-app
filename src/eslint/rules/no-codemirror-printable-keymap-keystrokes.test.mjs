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
          when: ['settings-open'],
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
          when: ['code-editor-not-focused'],
        }
      `,
    },
    {
      code: `
        const item = {
          keystrokes: ['v', '1'],
          when: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
        }
      `,
    },
    {
      code: `
        const legacyItem = {
          keystrokes: ['v', '1'],
          scopes: ['code-editor-not-focused'],
        }
      `,
    },
    {
      code: `
        const item = {
          keystrokes: ['v', '1'],
          when: ['code-editor-not-focused'],
          scopes: ['base'],
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
          when: [],
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorKeystrokes' }],
    },
    {
      code: `
        const item = {
          keystrokes: ['Shift+V'],
          when: ['code-editor-focused'],
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorKeystrokes' }],
    },
    {
      code: `
        provide(keymapValueSpec, {
          keystrokes: ['Space', 'k'],
          when: ['base'],
        })
      `,
      errors: [{ messageId: 'textProducingCodeMirrorKeystrokes' }],
    },
    {
      code: `
        const legacyItem = {
          keystrokes: [','],
          scopes: [],
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorKeystrokes' }],
    },
    {
      code: `
        const legacyItem = {
          keystrokes: ['v'],
          scopes: ['code-editor-focused'],
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorKeystrokes' }],
    },
    {
      code: `
        const item = {
          keystrokes: ['Space'],
          when: [],
          scopes: ['code-editor-not-focused'],
        }
      `,
      errors: [{ messageId: 'textProducingCodeMirrorKeystrokes' }],
    },
  ],
})
