import {
  BASE_KEYMAP_SCOPE,
  type KeymapItem,
  createKeymapTree,
  matchKeymapSequence,
  normalizeKeymapChord,
} from '@src/registry/contracts/keymap'
import { describe, expect, it, vi } from 'vitest'

describe('keymap contract', () => {
  it('normalizes chords before inserting and matching', () => {
    const item = createKeymapItem({
      id: 'open-command-palette',
      sequence: ['Mod + K'],
    })

    const tree = createKeymapTree([item])

    expect(normalizeKeymapChord('Mod + K')).toBe('mod+k')
    expect(matchKeymapSequence(tree, [], ['mod+k'])).toEqual({
      type: 'full',
      item,
    })
  })

  it('returns prefix matches for key sequences', () => {
    const item = createKeymapItem({
      id: 'top-view',
      sequence: ['v', '1'],
    })

    const tree = createKeymapTree([item])

    expect(matchKeymapSequence(tree, [], ['v'])).toEqual({ type: 'prefix' })
    expect(matchKeymapSequence(tree, [], ['v', '1'])).toEqual({
      type: 'full',
      item,
    })
  })

  it('prioritizes active scoped keymaps before base keymaps', () => {
    const baseItem = createKeymapItem({
      id: 'command-palette.open',
      sequence: ['mod+k'],
    })
    const scopedItem = createKeymapItem({
      id: 'command-palette.close',
      scope: 'cmd-palette-open',
      sequence: ['mod+k'],
    })

    const tree = createKeymapTree([baseItem, scopedItem])

    expect(matchKeymapSequence(tree, [], ['mod+k'])).toEqual({
      type: 'full',
      item: baseItem,
    })
    expect(matchKeymapSequence(tree, ['cmd-palette-open'], ['mod+k'])).toEqual({
      type: 'full',
      item: scopedItem,
    })
  })

  it('only includes opt-in items in the CodeMirror keymap tree', () => {
    const globalOnlyItem = createKeymapItem({
      id: 'global-only',
      sequence: ['mod+g'],
    })
    const codeMirrorItem = createKeymapItem({
      id: 'code-mirror',
      sequence: ['mod+k'],
      registerToCodeMirror: true,
    })

    const tree = createKeymapTree([globalOnlyItem, codeMirrorItem])

    expect(matchKeymapSequence(tree, [], ['mod+g'])).toEqual({
      type: 'full',
      item: globalOnlyItem,
    })
    expect(matchKeymapSequence(tree, [], ['mod+g'], 'codeMirror')).toEqual({
      type: 'none',
    })
    expect(matchKeymapSequence(tree, [], ['mod+k'], 'codeMirror')).toEqual({
      type: 'full',
      item: codeMirrorItem,
    })
  })

  it('preserves scoped precedence in the CodeMirror keymap tree', () => {
    const baseItem = createKeymapItem({
      id: 'command-palette.open',
      sequence: ['mod+k'],
      registerToCodeMirror: true,
    })
    const scopedItem = createKeymapItem({
      id: 'command-palette.close',
      scope: 'cmd-palette-open',
      sequence: ['mod+k'],
      registerToCodeMirror: true,
    })

    const tree = createKeymapTree([baseItem, scopedItem])

    expect(
      matchKeymapSequence(tree, ['cmd-palette-open'], ['mod+k'], 'codeMirror')
    ).toEqual({
      type: 'full',
      item: scopedItem,
    })
  })
})

function createKeymapItem(
  item: Pick<KeymapItem, 'id' | 'sequence'> & Partial<KeymapItem>
): KeymapItem {
  return {
    title: item.id,
    description: item.id,
    run: vi.fn(),
    scope: BASE_KEYMAP_SCOPE,
    ...item,
  }
}
