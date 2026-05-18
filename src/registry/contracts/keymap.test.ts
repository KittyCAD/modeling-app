import {
  BASE_KEYMAP_SCOPE,
  CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
  CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE,
  type KeymapItem,
  MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
  createKeymapItemsFromContributions,
  createKeymapTree,
  createKeymapTreeFromContributions,
  findKeymapItemForCommand,
  matchKeymapKeystrokes,
  normalizeKeymapChord,
} from '@src/registry/contracts/keymap'
import { describe, expect, it } from 'vitest'

describe('keymap contract', () => {
  it('normalizes chords before inserting and matching', () => {
    const item = createKeymapItem({
      id: 'open-command-palette',
      keystrokes: ['Mod + K'],
    })

    const tree = createKeymapTree([item])

    expect(normalizeKeymapChord('Mod + K')).toBe('mod+k')
    expect(matchKeymapKeystrokes(tree, [], ['mod+k'])).toEqual({
      type: 'full',
      item,
    })
  })

  it('returns prefix matches for keymap keystrokes', () => {
    const item = createKeymapItem({
      id: 'top-view',
      keystrokes: ['v', '1'],
      scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
    })

    const tree = createKeymapTree([item])

    expect(
      matchKeymapKeystrokes(tree, [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE], ['v'])
    ).toEqual({ type: 'prefix' })
    expect(
      matchKeymapKeystrokes(
        tree,
        [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
        ['v', '1']
      )
    ).toEqual({
      type: 'full',
      item,
    })
  })

  it('prioritizes active scoped keymaps before base keymaps', () => {
    const baseItem = createKeymapItem({
      id: 'command-palette.open',
      keystrokes: ['mod+k'],
    })
    const scopedItem = createKeymapItem({
      id: 'command-palette.close',
      scopes: ['cmd-palette-open'],
      keystrokes: ['mod+k'],
    })

    const tree = createKeymapTree([baseItem, scopedItem])

    expect(matchKeymapKeystrokes(tree, [], ['mod+k'])).toEqual({
      type: 'full',
      item: baseItem,
    })
    expect(
      matchKeymapKeystrokes(tree, ['cmd-palette-open'], ['mod+k'])
    ).toEqual({
      type: 'full',
      item: scopedItem,
    })
  })

  it('matches scoped items from a single prefix tree', () => {
    const baseItem = createKeymapItem({
      id: 'command-palette.open',
      keystrokes: ['mod+k'],
    })
    const scopedItem = createKeymapItem({
      id: 'command-palette.close',
      scopes: ['cmd-palette-open', CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
      keystrokes: ['mod+k'],
    })

    const tree = createKeymapTree([baseItem, scopedItem])

    expect(
      matchKeymapKeystrokes(tree, ['cmd-palette-open'], ['mod+k'])
    ).toEqual({
      type: 'full',
      item: scopedItem,
    })
    expect(
      matchKeymapKeystrokes(tree, [CODE_EDITOR_FOCUSED_KEYMAP_SCOPE], ['mod+k'])
    ).toEqual({
      type: 'full',
      item: scopedItem,
    })
  })

  it('only returns prefix matches when the prefix has active scoped leaves', () => {
    const settingsItem = createKeymapItem({
      id: 'settings.project',
      scopes: ['settings-open'],
      keystrokes: ['p', '1'],
    })

    const tree = createKeymapTree([settingsItem])

    expect(matchKeymapKeystrokes(tree, [], ['p'])).toEqual({ type: 'none' })
    expect(matchKeymapKeystrokes(tree, ['settings-open'], ['p'])).toEqual({
      type: 'prefix',
    })
  })

  it('does not match items while one of their excluded scopes is active', () => {
    const item = createKeymapItem({
      id: 'mode.line',
      command: 'mode.line',
      keystrokes: ['l'],
      scopes: ['mode-sketch'],
      excludedScopes: [CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
    })

    const tree = createKeymapTree([item])

    expect(matchKeymapKeystrokes(tree, ['mode-sketch'], ['l'])).toEqual({
      type: 'full',
      item,
    })
    expect(
      matchKeymapKeystrokes(
        tree,
        ['mode-sketch', CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
        ['l']
      )
    ).toEqual({ type: 'none' })
  })

  it('finds command bindings using active and excluded scopes', () => {
    const item = createKeymapItem({
      id: 'mode.line',
      command: 'mode.line',
      keystrokes: ['l'],
      scopes: ['mode-sketch'],
      excludedScopes: [CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
    })
    const tree = createKeymapTree([item])

    expect(findKeymapItemForCommand(tree, 'mode.line', ['mode-sketch'])).toBe(
      item
    )
    expect(
      findKeymapItemForCommand(tree, 'mode.line', [
        'mode-sketch',
        CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
      ])
    ).toBeUndefined()
  })

  it('lets sketch mode single-key bindings beat view command prefixes', () => {
    const vertical = createKeymapItem({
      id: 'sketch.vertical',
      command: 'sketch.vertical',
      keystrokes: ['v'],
      scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
    })
    const viewTop = createKeymapItem({
      id: 'view.top',
      command: 'view.top',
      keystrokes: ['v', '1'],
      scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      excludedScopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
    })

    const tree = createKeymapTree([viewTop, vertical])

    expect(
      matchKeymapKeystrokes(tree, [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE], ['v'])
    ).toEqual({ type: 'prefix' })
    expect(
      matchKeymapKeystrokes(
        tree,
        [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE, MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        ['v']
      )
    ).toEqual({
      type: 'full',
      item: vertical,
    })
    expect(
      matchKeymapKeystrokes(
        tree,
        [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE, MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        ['v', '1']
      )
    ).toEqual({ type: 'none' })
  })

  it('normalizes JSON-style keymap document contributions into keymap items', () => {
    const tree = createKeymapTreeFromContributions([
      {
        source: 'test.extension',
        bindings: [
          {
            id: 'test.command',
            title: 'Test command',
            command: 'test.command',
            keystrokes: ['mod+j'],
          },
        ],
      },
    ])

    const match = matchKeymapKeystrokes(tree, [], ['mod+j'])

    expect(match.type).toBe('full')
    expect(match.type === 'full' ? match.item.source : undefined).toBe(
      'test.extension'
    )
  })

  it('lets JSON-style keymap bindings override inherited source', () => {
    const items = createKeymapItemsFromContributions([
      {
        source: 'test.extension',
        bindings: [
          {
            id: 'test.command',
            title: 'Test command',
            command: 'test.command',
            keystrokes: ['mod+j'],
            source: 'test.extension.override',
          },
        ],
      },
    ])

    expect(items[0]?.source).toBe('test.extension.override')
  })
})

function createKeymapItem(
  item: Pick<KeymapItem, 'id' | 'keystrokes'> & Partial<KeymapItem>
): KeymapItem {
  return {
    title: item.id,
    command: item.id,
    source: 'test',
    scopes: [BASE_KEYMAP_SCOPE],
    ...item,
  }
}
