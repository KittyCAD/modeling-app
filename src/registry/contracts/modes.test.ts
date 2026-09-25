import {
  DEFAULT_COMMAND_SCOPES,
  FILE_AND_CODE_EDITOR_COMMAND_SCOPES,
  FILE_COMMAND_SCOPES,
  MODE_MODELING_COMMAND_SCOPE,
  MODE_SKETCH_SOLVE_COMMAND_SCOPE,
  getEffectiveCommandScopeSet,
  isCommandAvailable,
} from '@src/registry/contracts/commands'
import {
  type ModeDefinition,
  resolveModeKeymapScopes,
} from '@src/registry/contracts/modes'
import { describe, expect, it } from 'vitest'

const review: ModeDefinition = {
  id: 'review',
  label: 'Review',
  toolbar: [],
}

describe('mode command and keymap scopes', () => {
  it('keeps the machine scope for modes without custom bindings', () => {
    expect(
      resolveModeKeymapScopes(review, MODE_MODELING_COMMAND_SCOPE)
    ).toEqual([MODE_MODELING_COMMAND_SCOPE])
    expect(
      resolveModeKeymapScopes(undefined, MODE_SKETCH_SOLVE_COMMAND_SCOPE)
    ).toEqual([MODE_SKETCH_SOLVE_COMMAND_SCOPE])
  })

  it('does not apply the same scope twice for built-in modes', () => {
    expect(
      resolveModeKeymapScopes(
        { ...review, keymapScope: MODE_SKETCH_SOLVE_COMMAND_SCOPE },
        MODE_SKETCH_SOLVE_COMMAND_SCOPE
      )
    ).toEqual([MODE_SKETCH_SOLVE_COMMAND_SCOPE])
  })

  it('keeps file and editor commands available beside a plugin command scope', () => {
    const pluginScope = 'review.commands'
    const scopes = resolveModeKeymapScopes(
      { ...review, keymapScope: pluginScope },
      MODE_MODELING_COMMAND_SCOPE
    )
    const effectiveScopes = getEffectiveCommandScopeSet(scopes, [
      ...DEFAULT_COMMAND_SCOPES,
      { id: pluginScope, displayName: 'Review', priority: 150 },
    ])

    // Viewport focus must retain file commands (camera/delete) and editor
    // commands (undo/redo/render) without requiring editor focus as a fallback.
    expect(
      isCommandAvailable({ scopes: FILE_COMMAND_SCOPES }, effectiveScopes)
    ).toBe(true)
    expect(
      isCommandAvailable(
        { scopes: FILE_AND_CODE_EDITOR_COMMAND_SCOPES },
        effectiveScopes
      )
    ).toBe(true)
    expect(isCommandAvailable({ scopes: [pluginScope] }, effectiveScopes)).toBe(
      true
    )
  })
})
