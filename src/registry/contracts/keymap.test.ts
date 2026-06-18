import {
  BASE_KEYMAP_SCOPE,
  CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
  CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE,
  type KeymapItem,
  type KeymapScope,
  MODE_MODELING_KEYMAP_SCOPE,
  MODE_SKETCHING_KEYMAP_SCOPE,
  MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
  createKeymapItemsFromContributions,
  createKeymapTree,
  createKeymapTreeFromContributions,
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  matchKeymapKeystrokes,
  normalizeEventKey,
  normalizeKeymapChord,
  resolveKeymapItems,
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

  it('formats keymap keystrokes for display', () => {
    expect(keymapKeystrokesDisplay(['mod+k', 'p'], 'windows')).toBe('Ctrl+K P')
    expect(keymapKeystrokesDisplay(['mod+k'], 'macos')).toBe('⌘K')
    expect(keymapKeystrokesDisplay([], 'linux')).toBeUndefined()
  })

  it('normalizes modified alt-including keyboard events from their unmodified key code', () => {
    expect(
      normalizeEventKey({
        key: '\u2202',
        code: 'KeyD',
        altKey: true,
        ctrlKey: false,
        metaKey: false,
      })
    ).toBe('d')
    expect(
      normalizeEventKey({
        key: 'ß',
        code: 'KeyS',
        altKey: true,
        ctrlKey: false,
        metaKey: false,
      })
    ).toBe('s')
    expect(
      normalizeEventKey({
        key: '!',
        code: 'Digit1',
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      })
    ).toBe('!')
    expect(
      normalizeEventKey({
        key: '<',
        code: 'Comma',
        altKey: false,
        ctrlKey: false,
        metaKey: true,
      })
    ).toBe('<')
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

  it('uses the highest-priority scope within a group', () => {
    const item = createKeymapItem({
      id: 'mode.line',
      command: 'mode.line',
      keystrokes: ['l'],
      scopes: [MODE_SKETCHING_KEYMAP_SCOPE],
    })

    const tree = createKeymapTree([item])
    const scopeMetadata = [
      createContextScope(MODE_SKETCHING_KEYMAP_SCOPE, 100),
      createContextScope(CODE_EDITOR_FOCUSED_KEYMAP_SCOPE, 1000),
    ]

    expect(
      matchKeymapKeystrokes(
        tree,
        [MODE_SKETCHING_KEYMAP_SCOPE],
        ['l'],
        scopeMetadata
      )
    ).toEqual({
      type: 'full',
      item,
    })
    expect(
      matchKeymapKeystrokes(
        tree,
        [MODE_SKETCHING_KEYMAP_SCOPE, CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
        ['l'],
        scopeMetadata
      )
    ).toEqual({ type: 'none' })
  })

  it('finds command bindings using effective active scopes', () => {
    const item = createKeymapItem({
      id: 'mode.line',
      command: 'mode.line',
      keystrokes: ['l'],
      scopes: [MODE_SKETCHING_KEYMAP_SCOPE],
    })
    const tree = createKeymapTree([item])
    const scopeMetadata = [
      createContextScope(MODE_SKETCHING_KEYMAP_SCOPE, 100),
      createContextScope(CODE_EDITOR_FOCUSED_KEYMAP_SCOPE, 1000),
    ]

    expect(
      findKeymapItemForCommand(
        tree,
        'mode.line',
        [MODE_SKETCHING_KEYMAP_SCOPE],
        scopeMetadata
      )
    ).toBe(item)
    expect(
      findKeymapItemForCommand(
        tree,
        'mode.line',
        [MODE_SKETCHING_KEYMAP_SCOPE, CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
        scopeMetadata
      )
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
      scopes: [MODE_MODELING_KEYMAP_SCOPE],
    })

    const tree = createKeymapTree([viewTop, vertical])
    const scopeMetadata = [
      createContextScope(MODE_MODELING_KEYMAP_SCOPE, 100),
      createContextScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE, 200),
    ]

    expect(
      matchKeymapKeystrokes(
        tree,
        [MODE_MODELING_KEYMAP_SCOPE],
        ['v'],
        scopeMetadata
      )
    ).toEqual({ type: 'prefix' })
    expect(
      matchKeymapKeystrokes(
        tree,
        [MODE_MODELING_KEYMAP_SCOPE, MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        ['v'],
        scopeMetadata
      )
    ).toEqual({
      type: 'full',
      item: vertical,
    })
    expect(
      matchKeymapKeystrokes(
        tree,
        [MODE_MODELING_KEYMAP_SCOPE, MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        ['v', '1'],
        scopeMetadata
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

  it('resolves persisted user bindings into user-sourced keymap items', () => {
    const tree = createKeymapTree(
      resolveKeymapItems([], {
        version: 1,
        bindings: [
          {
            title: 'User command',
            command: 'test.userCommand',
            keystrokes: ['mod+u'],
            arguments: { value: 'abc' },
          },
        ],
      })
    )

    const match = matchKeymapKeystrokes(tree, [], ['mod+u'])

    expect(match.type).toBe('full')
    expect(match.type === 'full' ? match.item.source : undefined).toBe('User')
  })

  it('resolves persisted user bindings as overrides for matching app items', () => {
    const item = createKeymapItem({
      id: 'open-command-palette',
      command: 'zds.commandPalette.open',
      keystrokes: ['mod+k'],
      arguments: { tab: 'project', nested: { id: 1 } },
    })
    const tree = createKeymapTree(
      resolveKeymapItems([item], {
        version: 1,
        bindings: [
          {
            command: 'zds.commandPalette.open',
            keystrokes: ['mod+p'],
            arguments: { nested: { id: 1 }, tab: 'project' },
          },
        ],
      })
    )

    expect(matchKeymapKeystrokes(tree, [], ['mod+k'])).toEqual({ type: 'none' })
    expect(matchKeymapKeystrokes(tree, [], ['mod+p'])).toEqual({
      type: 'full',
      item: {
        ...item,
        keystrokes: ['mod+p'],
        source: 'User',
        scopes: undefined,
      },
    })
  })

  it('uses persisted overrides for linked hidden keybindings', () => {
    const legacyItem = createKeymapItem({
      id: 'toolbar.sketch-legacy.line',
      command: 'zds.toolbar.sketchLegacy.line',
      keystrokes: ['l'],
      scopes: [MODE_SKETCHING_KEYMAP_SCOPE],
      hidden: true,
      userBindingCommand: 'zds.toolbar.sketch.line',
    })
    const item = createKeymapItem({
      id: 'toolbar.sketch.line',
      command: 'zds.toolbar.sketch.line',
      keystrokes: ['l'],
      scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
    })
    const tree = createKeymapTree(
      resolveKeymapItems([legacyItem, item], {
        version: 1,
        bindings: [
          {
            command: 'zds.toolbar.sketch.line',
            keystrokes: ['shift+q'],
            scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
          },
        ],
      })
    )
    const scopeMetadata = [
      createContextScope(MODE_SKETCHING_KEYMAP_SCOPE, 200),
      createContextScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE, 220),
    ]

    expect(
      matchKeymapKeystrokes(
        tree,
        [MODE_SKETCHING_KEYMAP_SCOPE],
        ['l'],
        scopeMetadata
      )
    ).toEqual({ type: 'none' })
    expect(
      matchKeymapKeystrokes(
        tree,
        [MODE_SKETCHING_KEYMAP_SCOPE],
        ['shift+q'],
        scopeMetadata
      )
    ).toEqual({
      type: 'full',
      item: {
        ...legacyItem,
        keystrokes: ['shift+q'],
        scopes: [MODE_SKETCHING_KEYMAP_SCOPE],
        source: 'User',
      },
    })
    expect(
      matchKeymapKeystrokes(
        tree,
        [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        ['shift+q'],
        scopeMetadata
      )
    ).toEqual({
      type: 'full',
      item: {
        ...item,
        keystrokes: ['shift+q'],
        scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        source: 'User',
      },
    })
  })

  it('keeps same-command linked hidden overrides in their original scopes', () => {
    const hiddenEditorItem = createKeymapItem({
      id: 'editor.undo.code-editor-focused',
      command: 'zds.editor.undo',
      keystrokes: ['mod+z'],
      scopes: [CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
      hidden: true,
      userBindingCommand: 'zds.editor.undo',
    })
    const visibleItem = createKeymapItem({
      id: 'editor.undo',
      command: 'zds.editor.undo',
      keystrokes: ['mod+z'],
      scopes: [MODE_MODELING_KEYMAP_SCOPE],
    })
    const tree = createKeymapTree(
      resolveKeymapItems([hiddenEditorItem, visibleItem], {
        version: 1,
        bindings: [
          {
            command: 'zds.editor.undo',
            keystrokes: ['mod+alt+z'],
            scopes: [MODE_MODELING_KEYMAP_SCOPE],
          },
        ],
      })
    )
    const scopeMetadata = [
      createContextScope(MODE_MODELING_KEYMAP_SCOPE, 100),
      createContextScope(CODE_EDITOR_FOCUSED_KEYMAP_SCOPE, 1000),
    ]

    expect(
      matchKeymapKeystrokes(
        tree,
        [CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
        ['mod+alt+z'],
        scopeMetadata
      )
    ).toEqual({
      type: 'full',
      item: {
        ...hiddenEditorItem,
        keystrokes: ['mod+alt+z'],
        source: 'User',
      },
    })
    expect(
      matchKeymapKeystrokes(
        tree,
        [MODE_MODELING_KEYMAP_SCOPE],
        ['mod+alt+z'],
        scopeMetadata
      )
    ).toEqual({
      type: 'full',
      item: {
        ...visibleItem,
        keystrokes: ['mod+alt+z'],
        scopes: [MODE_MODELING_KEYMAP_SCOPE],
        source: 'User',
      },
    })
  })

  it('resolves persisted unbind entries by command and keystrokes', () => {
    const item = createKeymapItem({
      id: 'open-command-palette',
      command: 'zds.commandPalette.open',
      keystrokes: ['mod+k'],
    })
    const tree = createKeymapTree(
      resolveKeymapItems([item], {
        version: 1,
        bindings: [
          {
            command: '-zds.commandPalette.open',
            keystrokes: ['Mod + K'],
          },
        ],
      })
    )

    expect(matchKeymapKeystrokes(tree, [], ['mod+k'])).toEqual({ type: 'none' })
  })

  it('resolves persisted unbind entries across linked hidden keybindings', () => {
    const visibleItem = createKeymapItem({
      id: 'toolbar.sketch.exit',
      command: 'zds.toolbar.sketch.exit',
      keystrokes: ['shift+escape'],
      scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
    })
    const hiddenAlias = createKeymapItem({
      id: 'toolbar.sketch.exit.alias',
      command: 'zds.toolbar.sketch.exit',
      keystrokes: ['escape'],
      scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
      hidden: true,
      userBindingCommand: 'zds.toolbar.sketch.exit',
    })
    const tree = createKeymapTree(
      resolveKeymapItems([visibleItem, hiddenAlias], {
        version: 1,
        bindings: [
          {
            command: '-zds.toolbar.sketch.exit',
            keystrokes: ['shift+escape'],
            scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
          },
        ],
      })
    )

    expect(
      matchKeymapKeystrokes(
        tree,
        [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        ['shift+escape']
      )
    ).toEqual({ type: 'none' })
    expect(
      matchKeymapKeystrokes(tree, [MODE_SKETCH_SOLVE_KEYMAP_SCOPE], ['escape'])
    ).toEqual({ type: 'none' })
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

function createContextScope(id: string, priority: number): KeymapScope {
  return {
    id,
    displayName: id,
    group: 'context',
    priority,
  }
}
