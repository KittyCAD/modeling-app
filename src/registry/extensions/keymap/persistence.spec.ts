import { parsePersistedKeymap } from '@src/registry/extensions/keymap/persistence'
import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'

describe('keymap persistence', () => {
  it('parses persisted keymap TOML bindings', () => {
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
      version: 1,
      bindings: [
        {
          command: 'zds.commandPalette.open',
          keystrokes: ['mod+k'],
          scopes: ['base', 'code-editor-focused'],
          arguments: {
            tab: 'project',
          },
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
