import {
  createRowUserBinding,
  findKeybindingConflict,
  getKeybindingRows,
} from '@src/components/Settings/keybindingRows'
import type { KeymapBinding, KeymapItem } from '@src/registry/contracts/keymap'
import { describe, expect, it } from 'vitest'

describe('keybinding rows', () => {
  it('shows and saves the user when condition for an app override', () => {
    const appItem = createItem({ when: ['mode-modeling'] })
    const userBinding: KeymapBinding = {
      command: appItem.command,
      keystrokes: ['mod+r'],
      when: ['custom-context'],
    }
    const [row] = getKeybindingRows([appItem], [userBinding])

    expect(row?.when).toEqual(['custom-context'])
    expect(
      row && createRowUserBinding(row, ['mod+shift+r'], ['scene'])
    ).toEqual({
      command: appItem.command,
      keystrokes: ['mod+shift+r'],
      when: ['scene'],
    })
  })

  it('does not leak legacy scopes from a standalone user binding', () => {
    const legacyBinding = {
      command: 'test.user',
      keystrokes: ['mod+u'],
      scopes: ['legacy-context'],
    }
    const [row] = getKeybindingRows([], [legacyBinding])

    const saved = row && createRowUserBinding(row, ['mod+i'], row.when)

    expect(saved).toEqual({
      command: 'test.user',
      keystrokes: ['mod+i'],
      when: ['legacy-context'],
    })
    expect(saved).not.toHaveProperty('scopes')
  })

  it('only reports conflicts when keybindings share a when context', () => {
    const [row] = getKeybindingRows(
      [createItem({ keystrokes: ['mod+r'], when: ['mode-modeling'] })],
      []
    )

    expect(
      findKeybindingConflict(row ? [row] : [], {
        keystrokes: ['mod+r'],
        when: ['mode-sketching'],
      })
    ).toBeUndefined()
    expect(
      findKeybindingConflict(row ? [row] : [], {
        keystrokes: ['mod+r'],
        when: ['mode-modeling'],
      })?.row
    ).toBe(row)
  })
})

function createItem(overrides: Partial<KeymapItem> = {}): KeymapItem {
  return {
    id: 'test.command',
    title: 'Test command',
    command: 'test.command',
    source: 'Test',
    keystrokes: ['mod+t'],
    ...overrides,
  }
}
