import {
  getCommandPaletteScopes,
  isCommandAvailable,
  isCommandSearchable,
} from '@src/registry/contracts/commands'
import {
  CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
  DEFAULT_KEYMAP_SCOPES,
  EDITABLE_FOCUSED_KEYMAP_SCOPE,
  FILE_AND_CODE_EDITOR_KEYMAP_SCOPES,
  FILE_KEYMAP_SCOPES,
  GLOBAL_KEYMAP_SCOPES,
  HOME_KEYMAP_SCOPE,
  MODE_MODELING_KEYMAP_SCOPE,
  SETTINGS_KEYMAP_SCOPE,
} from '@src/registry/contracts/keymap'
import { describe, expect, it } from 'vitest'

describe('command context availability', () => {
  it('requires commands to declare their availability', () => {
    expect(isCommandAvailable({}, [], DEFAULT_KEYMAP_SCOPES)).toBe(false)
    expect(
      isCommandAvailable({}, [HOME_KEYMAP_SCOPE], DEFAULT_KEYMAP_SCOPES)
    ).toBe(false)
    expect(
      isCommandAvailable(
        { scopes: ['   '] },
        [HOME_KEYMAP_SCOPE],
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(false)
  })

  it('makes explicitly global commands available in every context', () => {
    expect(
      isCommandAvailable(
        { scopes: GLOBAL_KEYMAP_SCOPES },
        [HOME_KEYMAP_SCOPE],
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(true)
  })

  it.each(FILE_KEYMAP_SCOPES)(
    'makes file commands available in %s',
    (scope) => {
      expect(
        isCommandAvailable(
          { scopes: FILE_KEYMAP_SCOPES },
          [scope],
          DEFAULT_KEYMAP_SCOPES
        )
      ).toBe(true)
    }
  )

  it('hides file commands outside the effective file context', () => {
    const command = { scopes: FILE_KEYMAP_SCOPES }

    expect(
      isCommandAvailable(command, [HOME_KEYMAP_SCOPE], DEFAULT_KEYMAP_SCOPES)
    ).toBe(false)
    expect(
      isCommandAvailable(
        command,
        [MODE_MODELING_KEYMAP_SCOPE, SETTINGS_KEYMAP_SCOPE],
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(false)
    expect(
      isCommandAvailable(
        command,
        [MODE_MODELING_KEYMAP_SCOPE, CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(false)
  })

  it('keeps code commands available when editor focus supersedes file mode', () => {
    expect(
      isCommandAvailable(
        { scopes: FILE_AND_CODE_EDITOR_KEYMAP_SCOPES },
        [MODE_MODELING_KEYMAP_SCOPE, CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(true)
  })

  it('suppresses background contexts while an ordinary editable has focus', () => {
    const activeScopes = [
      MODE_MODELING_KEYMAP_SCOPE,
      EDITABLE_FOCUSED_KEYMAP_SCOPE,
    ]

    expect(
      isCommandAvailable(
        { scopes: FILE_KEYMAP_SCOPES },
        activeScopes,
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(false)
    expect(
      isCommandAvailable(
        { scopes: GLOBAL_KEYMAP_SCOPES },
        activeScopes,
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(true)
  })

  it('keeps transient editable focus out of palette discovery', () => {
    const paletteScopes = getCommandPaletteScopes([
      HOME_KEYMAP_SCOPE,
      EDITABLE_FOCUSED_KEYMAP_SCOPE,
    ])

    expect(paletteScopes).toEqual([HOME_KEYMAP_SCOPE])
    expect(
      isCommandAvailable(
        { scopes: [HOME_KEYMAP_SCOPE] },
        paletteScopes,
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(true)
  })

  it('supports extension-defined scopes', () => {
    const pluginScope = 'plugin.markdown-editor-focused'

    expect(isCommandAvailable({ scopes: [pluginScope] }, [pluginScope])).toBe(
      true
    )
    expect(
      isCommandAvailable(
        { scopes: [pluginScope] },
        [HOME_KEYMAP_SCOPE],
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(false)
  })

  it('combines context availability with command palette visibility', () => {
    expect(
      isCommandSearchable(
        { scopes: FILE_KEYMAP_SCOPES },
        [MODE_MODELING_KEYMAP_SCOPE],
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(true)
    expect(
      isCommandSearchable(
        { scopes: FILE_KEYMAP_SCOPES },
        [HOME_KEYMAP_SCOPE],
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(false)
    expect(
      isCommandSearchable(
        { hideFromSearch: true, scopes: GLOBAL_KEYMAP_SCOPES },
        [MODE_MODELING_KEYMAP_SCOPE],
        DEFAULT_KEYMAP_SCOPES
      )
    ).toBe(false)
  })
})
