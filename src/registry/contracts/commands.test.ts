import {
  BASE_COMMAND_SCOPE,
  CODE_EDITOR_FOCUSED_COMMAND_SCOPE,
  DEFAULT_COMMAND_SCOPES,
  EDITABLE_FOCUSED_COMMAND_SCOPE,
  FILE_AND_CODE_EDITOR_COMMAND_SCOPES,
  FILE_COMMAND_SCOPES,
  GLOBAL_COMMAND_SCOPES,
  HOME_COMMAND_SCOPE,
  MODE_MODELING_COMMAND_SCOPE,
  SETTINGS_COMMAND_SCOPE,
  getCommandPaletteScopes,
  getEffectiveCommandScopeSet,
  getEffectiveCommandScopes,
  isCommandAvailable,
  isCommandSearchable,
  normalizeCommandScopeIds,
} from '@src/registry/contracts/commands'
import { describe, expect, it } from 'vitest'

describe('command scopes', () => {
  it('fails closed when command scopes are omitted or empty', () => {
    expect(normalizeCommandScopeIds(undefined)).toEqual([])
    expect(normalizeCommandScopeIds([])).toEqual([])
    expect(normalizeCommandScopeIds(['   '])).toEqual([])
  })

  it('normalizes and deduplicates explicit command scopes', () => {
    expect(
      normalizeCommandScopeIds([
        ` ${MODE_MODELING_COMMAND_SCOPE} `,
        MODE_MODELING_COMMAND_SCOPE,
      ])
    ).toEqual([MODE_MODELING_COMMAND_SCOPE])
  })

  it('keeps only the highest-priority active scope in a group', () => {
    expect(
      getEffectiveCommandScopes(
        [MODE_MODELING_COMMAND_SCOPE, CODE_EDITOR_FOCUSED_COMMAND_SCOPE],
        DEFAULT_COMMAND_SCOPES
      )
    ).toEqual([BASE_COMMAND_SCOPE, CODE_EDITOR_FOCUSED_COMMAND_SCOPE])

    expect(
      getEffectiveCommandScopes(
        [MODE_MODELING_COMMAND_SCOPE, SETTINGS_COMMAND_SCOPE],
        DEFAULT_COMMAND_SCOPES
      )
    ).toEqual([BASE_COMMAND_SCOPE, SETTINGS_COMMAND_SCOPE])
  })

  it('uses OR semantics within command scopes', () => {
    const effectiveScopes = getEffectiveCommandScopeSet(
      [MODE_MODELING_COMMAND_SCOPE],
      DEFAULT_COMMAND_SCOPES
    )

    expect(isCommandAvailable({}, effectiveScopes)).toBe(false)
    expect(
      isCommandAvailable(
        {
          scopes: [
            CODE_EDITOR_FOCUSED_COMMAND_SCOPE,
            MODE_MODELING_COMMAND_SCOPE,
          ],
        },
        effectiveScopes
      )
    ).toBe(true)
    expect(
      isCommandAvailable(
        { scopes: [CODE_EDITOR_FOCUSED_COMMAND_SCOPE] },
        effectiveScopes
      )
    ).toBe(false)
    expect(
      isCommandAvailable({ scopes: GLOBAL_COMMAND_SCOPES }, effectiveScopes)
    ).toBe(true)
  })

  it('keeps file commands out of Home and generic editable contexts', () => {
    for (const activeScopes of [
      [HOME_COMMAND_SCOPE],
      [MODE_MODELING_COMMAND_SCOPE, EDITABLE_FOCUSED_COMMAND_SCOPE],
    ]) {
      const effectiveScopes = getEffectiveCommandScopeSet(
        activeScopes,
        DEFAULT_COMMAND_SCOPES
      )
      expect(
        isCommandAvailable({ scopes: FILE_COMMAND_SCOPES }, effectiveScopes)
      ).toBe(false)
    }

    const editorScopes = getEffectiveCommandScopeSet(
      [MODE_MODELING_COMMAND_SCOPE, CODE_EDITOR_FOCUSED_COMMAND_SCOPE],
      DEFAULT_COMMAND_SCOPES
    )
    expect(
      isCommandAvailable(
        { scopes: FILE_AND_CODE_EDITOR_COMMAND_SCOPES },
        editorScopes
      )
    ).toBe(true)
  })

  it('removes only transient editable focus from palette discovery', () => {
    expect(
      getCommandPaletteScopes([
        SETTINGS_COMMAND_SCOPE,
        EDITABLE_FOCUSED_COMMAND_SCOPE,
      ])
    ).toEqual([SETTINGS_COMMAND_SCOPE])
  })

  it('combines availability with command palette visibility', () => {
    const effectiveScopes = getEffectiveCommandScopeSet(
      [MODE_MODELING_COMMAND_SCOPE],
      DEFAULT_COMMAND_SCOPES
    )

    expect(
      isCommandSearchable(
        { scopes: [MODE_MODELING_COMMAND_SCOPE] },
        effectiveScopes
      )
    ).toBe(true)
    expect(isCommandSearchable({ hideFromSearch: true }, effectiveScopes)).toBe(
      false
    )
  })
})
