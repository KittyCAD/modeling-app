import {
  parsePersistedKeymap,
  serializePersistedKeymap,
} from '@src/registry/extensions/keymap/persistence'
import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'

describe('keymap persistence', () => {
  it('migrates v1 scopes to runtime when conditions', () => {
    const keymap = parsePersistedKeymap(
      parse(`
version = 1

[[bindings]]
command = "zds.commandPalette.open"
keystrokes = [ "mod+k" ]
scopes = [ "base", "code-editor-focused" ]

[bindings.arguments]
tab = "project"
`)
    )

    expect(keymap).toEqual({
      version: 2,
      bindings: [
        {
          command: 'zds.commandPalette.open',
          keystrokes: ['mod+k'],
          when: ['base', 'code-editor-focused'],
          arguments: {
            tab: 'project',
          },
        },
      ],
    })
  })

  it('prefers v2 when conditions over mirrored legacy scopes', () => {
    const keymap = parsePersistedKeymap({
      version: 2,
      bindings: [
        {
          command: 'test.command',
          keystrokes: ['mod+k'],
          when: [' custom-context ', 'custom-context'],
          scopes: ['legacy-context'],
        },
        {
          command: 'test.base',
          keystrokes: ['mod+b'],
          when: [],
          scopes: ['legacy-context'],
        },
      ],
    })

    expect(keymap).toEqual({
      version: 2,
      bindings: [
        {
          command: 'test.command',
          keystrokes: ['mod+k'],
          when: ['custom-context'],
          arguments: undefined,
          title: undefined,
        },
        {
          command: 'test.base',
          keystrokes: ['mod+b'],
          when: undefined,
          arguments: undefined,
          title: undefined,
        },
      ],
    })
  })

  it('writes when as the v2 field and mirrors it for older versions', () => {
    const keymap = {
      version: 2 as const,
      bindings: [
        {
          command: 'test.command',
          keystrokes: ['mod+k'],
          when: ['custom-context'],
        },
        {
          command: 'test.base',
          keystrokes: ['mod+b'],
        },
      ],
    }

    expect(serializePersistedKeymap(keymap)).toEqual({
      version: 2,
      bindings: [
        {
          command: 'test.command',
          keystrokes: ['mod+k'],
          when: ['custom-context'],
          scopes: ['custom-context'],
        },
        {
          command: 'test.base',
          keystrokes: ['mod+b'],
        },
      ],
    })
  })

  it('normalizes legacy-only bindings before writing v2', () => {
    const keymap = {
      version: 2 as const,
      bindings: [
        {
          command: 'test.command',
          keystrokes: ['mod+k'],
          scopes: ['legacy-context'],
        },
      ],
    }

    expect(serializePersistedKeymap(keymap)).toEqual({
      version: 2,
      bindings: [
        {
          command: 'test.command',
          keystrokes: ['mod+k'],
          when: ['legacy-context'],
          scopes: ['legacy-context'],
        },
      ],
    })
  })

  it('ignores bindings that do not use current keymap fields', () => {
    const keymap = parsePersistedKeymap({
      version: 1,
      bindings: [
        {
          command: 'zds.commandPalette.open',
          sequence: ['mod+k'],
          registerToCodeMirror: true,
        },
      ],
    })

    expect(keymap.bindings).toEqual([])
  })
})
