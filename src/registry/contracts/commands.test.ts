import {
  getEffectiveCommandScopeSet,
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

type AvailabilityCase = readonly [
  command: Parameters<typeof isCommandAvailable>[0],
  activeScopes: readonly string[],
  expected: boolean,
]

const pluginScope = 'plugin.markdown-editor-focused'
const fileCommand = { scopes: FILE_KEYMAP_SCOPES }
const globalCommand = { scopes: GLOBAL_KEYMAP_SCOPES }
const codeCommand = { scopes: FILE_AND_CODE_EDITOR_KEYMAP_SCOPES }
const pluginCommand = { scopes: [pluginScope] as const }
const availabilityCases: readonly AvailabilityCase[] = [
  [{}, [], false],
  [{}, [HOME_KEYMAP_SCOPE], false],
  [{ scopes: ['   '] }, [HOME_KEYMAP_SCOPE], false],
  [globalCommand, [HOME_KEYMAP_SCOPE], true],
  ...FILE_KEYMAP_SCOPES.map(
    (scope): AvailabilityCase => [fileCommand, [scope], true]
  ),
  [fileCommand, [HOME_KEYMAP_SCOPE], false],
  [fileCommand, [MODE_MODELING_KEYMAP_SCOPE, SETTINGS_KEYMAP_SCOPE], false],
  [
    fileCommand,
    [MODE_MODELING_KEYMAP_SCOPE, CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
    false,
  ],
  [
    codeCommand,
    [MODE_MODELING_KEYMAP_SCOPE, CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
    true,
  ],
  [
    fileCommand,
    [MODE_MODELING_KEYMAP_SCOPE, EDITABLE_FOCUSED_KEYMAP_SCOPE],
    false,
  ],
  [
    globalCommand,
    [MODE_MODELING_KEYMAP_SCOPE, EDITABLE_FOCUSED_KEYMAP_SCOPE],
    true,
  ],
  [pluginCommand, [pluginScope], true],
  [pluginCommand, [HOME_KEYMAP_SCOPE], false],
]

describe('command context availability', () => {
  it.each(availabilityCases)(
    'evaluates %o in %o as %s',
    (command, scopes, expected) => {
      const effectiveScopes = getEffectiveCommandScopeSet(
        scopes,
        DEFAULT_KEYMAP_SCOPES
      )
      expect(isCommandAvailable(command, effectiveScopes)).toBe(expected)
    }
  )

  it('keeps transient editable focus out of palette discovery', () => {
    expect(
      getCommandPaletteScopes([
        HOME_KEYMAP_SCOPE,
        EDITABLE_FOCUSED_KEYMAP_SCOPE,
      ])
    ).toEqual([HOME_KEYMAP_SCOPE])
  })

  it('combines context availability with command palette visibility', () => {
    const modelingScopes = getEffectiveCommandScopeSet(
      [MODE_MODELING_KEYMAP_SCOPE],
      DEFAULT_KEYMAP_SCOPES
    )
    const homeScopes = getEffectiveCommandScopeSet(
      [HOME_KEYMAP_SCOPE],
      DEFAULT_KEYMAP_SCOPES
    )

    expect(
      isCommandSearchable({ scopes: FILE_KEYMAP_SCOPES }, modelingScopes)
    ).toBe(true)
    expect(
      isCommandSearchable({ scopes: FILE_KEYMAP_SCOPES }, homeScopes)
    ).toBe(false)
    expect(
      isCommandSearchable(
        { hideFromSearch: true, scopes: GLOBAL_KEYMAP_SCOPES },
        modelingScopes
      )
    ).toBe(false)
  })
})
