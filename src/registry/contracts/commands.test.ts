import {
  BASE_COMMAND_SCOPE,
  CODE_EDITOR_FOCUSED_COMMAND_SCOPE,
  DEFAULT_COMMAND_SCOPES,
  MODE_MODELING_COMMAND_SCOPE,
  getEffectiveCommandScopeSet,
  getEffectiveCommandScopes,
  isCommandAvailable,
  isCommandSearchable,
  normalizeCommandScopeIds,
} from '@src/registry/contracts/commands'
import { describe, expect, it } from 'vitest'

describe('command scopes', () => {
  it('treats omitted and empty command scopes as global', () => {
    expect(normalizeCommandScopeIds(undefined)).toEqual([BASE_COMMAND_SCOPE])
    expect(normalizeCommandScopeIds([])).toEqual([BASE_COMMAND_SCOPE])
    expect(normalizeCommandScopeIds(['   '])).toEqual([BASE_COMMAND_SCOPE])
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
  })

  it('uses OR semantics within command scopes', () => {
    const effectiveScopes = getEffectiveCommandScopeSet(
      [MODE_MODELING_COMMAND_SCOPE],
      DEFAULT_COMMAND_SCOPES
    )

    expect(isCommandAvailable({}, effectiveScopes)).toBe(true)
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
  })

  it('combines availability with command palette visibility', () => {
    const effectiveScopes = getEffectiveCommandScopeSet(
      [MODE_MODELING_COMMAND_SCOPE],
      DEFAULT_COMMAND_SCOPES
    )

    expect(isCommandSearchable({}, effectiveScopes)).toBe(true)
    expect(isCommandSearchable({ hideFromSearch: true }, effectiveScopes)).toBe(
      false
    )
  })
})
