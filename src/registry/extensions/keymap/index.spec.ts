import {
  Registry,
  Slot,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import {
  type CommandSystemService,
  commandSystemService,
} from '@src/registry/contracts/commands'
import {
  CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
  CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE,
  KEYMAP_SCHEMA_VERSION,
  MODE_SKETCHING_KEYMAP_SCOPE,
  MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
  type PersistedKeymap,
  keymapService,
  provideKeymapDocument,
  provideKeymapItem,
} from '@src/registry/contracts/keymap'
import { defaultKeymap } from '@src/registry/extensions/keymap/defaultKeymap'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import keymapExtension from '.'

const persistenceMocks = vi.hoisted(() => ({
  readUserKeymapFile: vi.fn(),
  writeUserKeymapFile: vi.fn(),
}))

vi.mock('@src/registry/extensions/keymap/persistence', () => persistenceMocks)

describe('keymap extension', () => {
  beforeEach(() => {
    persistenceMocks.readUserKeymapFile.mockResolvedValue({
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [],
    })
    persistenceMocks.writeUserKeymapFile.mockResolvedValue(undefined)
  })

  it('contributes the default keymap as the Base source', () => {
    const registry = createRegistryWithKeymapItems([])
    const keymap = registry.get(keymapService)

    expect(
      keymap.keymap.value.items.find(
        (item) => item.id === 'command-palette.open'
      )?.source
    ).toBe('Base')

    registry[Symbol.dispose]()
  })

  it('uses Shift+Escape to exit sketch across desktop and web', () => {
    expect(
      defaultKeymap.bindings.find(
        (binding) => binding.id === 'toolbar.sketch-legacy.exit'
      )?.keystrokes
    ).toEqual(['shift+escape'])
    expect(
      defaultKeymap.bindings.find(
        (binding) => binding.id === 'toolbar.sketch.exit'
      )?.keystrokes
    ).toEqual(['shift+escape'])

    expect(
      defaultKeymap.bindings.filter((binding) =>
        binding.id.startsWith('toolbar.sketch-legacy.exit')
      )
    ).toHaveLength(1)
    expect(
      defaultKeymap.bindings.filter((binding) =>
        binding.id.startsWith('toolbar.sketch.exit')
      )
    ).toHaveLength(1)
  })

  it('hides legacy sketch keybindings and links them to user-facing sketch bindings', () => {
    expect(
      defaultKeymap.bindings.find(
        (binding) => binding.id === 'toolbar.sketch-legacy.line'
      )
    ).toMatchObject({
      hidden: true,
      command: 'zds.toolbar.sketchLegacy.line',
      userBindingCommand: 'zds.toolbar.sketch.line',
    })
    const sketchLine = defaultKeymap.bindings.find(
      (binding) => binding.id === 'toolbar.sketch.line'
    )
    expect(sketchLine?.command).toBe('zds.toolbar.sketch.line')
    expect(sketchLine?.hidden).toBeUndefined()
  })

  it('marks a partial match and awaits more input', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.keystrokes',
        title: 'Test keystrokes',
        command: 'test.keystrokes',
        source: 'test',
        keystrokes: ['q', 'w'],
        scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      },
    ])

    const keymap = registry.get(keymapService)
    const event = new KeyboardEvent('keydown', { key: 'q' })

    expect(keymap.handleKeyDown(event, { source: 'global' })).toBe(true)
    expect(keymap.partialMatch.value).toBe(true)

    registry[Symbol.dispose]()
  })

  it('runs a full match and clears partial match state', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.full',
        title: 'Test full',
        command: 'zds.settings.tab',
        source: 'test',
        keystrokes: ['x'],
        scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
      },
    ])

    const keymap = registry.get(keymapService)
    const event = new KeyboardEvent('keydown', { key: 'x' })

    expect(keymap.handleKeyDown(event, { source: 'global' })).toBe(true)
    expect(keymap.partialMatch.value).toBe(false)

    registry[Symbol.dispose]()
  })

  it('matches macOS Option-modified letter chords by physical key code', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.alt-d',
        title: 'Test Alt+D',
        command: 'test.alt-d',
        source: 'test',
        keystrokes: ['alt+d'],
        scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
      },
    ])

    const keymap = registry.get(keymapService)
    keymap.applyScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE)
    const event = new KeyboardEvent('keydown', {
      key: '\u2202',
      code: 'KeyD',
      altKey: true,
    })

    expect(keymap.handleKeyDown(event, { source: 'global' })).toBe(true)

    registry[Symbol.dispose]()
  })

  it('uses keybindings as a settings tab argument', () => {
    window.history.replaceState(null, '', '/settings?tab=user')
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.keybindings-tab',
        title: 'Test keybindings tab',
        command: 'zds.settings.tab',
        source: 'test',
        keystrokes: ['k'],
        arguments: { tab: 'keybindings' },
        scopes: ['settings-open'],
      },
    ])

    const keymap = registry.get(keymapService)
    keymap.applyScope('settings-open')
    const event = new KeyboardEvent('keydown', { key: 'k' })

    expect(keymap.handleKeyDown(event, { source: 'global' })).toBe(true)
    expect(new URL(window.location.href).searchParams.get('tab')).toBe(
      'keybindings'
    )

    registry[Symbol.dispose]()
  })

  it('selects non-built-in command IDs through the command system', () => {
    const onSubmit = vi.fn()
    const send = vi.fn()
    const registry = createRegistryWithKeymapItems(
      [
        {
          id: 'test.user-command-keymap',
          title: 'Test user command keymap',
          command: 'test.command',
          source: 'User',
          keystrokes: ['mod+u'],
          arguments: { value: 'abc' },
        },
      ],
      [
        defineRegistryItem({
          id: 'test-command-system',
          providesServices: [
            provideService(commandSystemService, {
              actor: {
                getSnapshot: () => ({
                  context: {
                    commands: [
                      {
                        id: 'test.command',
                        groupId: 'test',
                        name: 'Run test command',
                        needsReview: false,
                        args: {
                          value: {
                            inputType: 'string',
                            required: true,
                          },
                        },
                        onSubmit,
                      },
                    ],
                  },
                }),
              },
              send,
              useState: vi.fn(),
            } as unknown as CommandSystemService),
          ],
        }),
      ]
    )

    const keymap = registry.get(keymapService)
    const event = new KeyboardEvent('keydown', {
      key: 'u',
      ctrlKey: true,
      metaKey: true,
    })

    expect(keymap.handleKeyDown(event, { source: 'global' })).toBe(true)
    expect(send).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        groupId: 'test',
        name: 'Run test command',
        argDefaultValues: { value: 'abc' },
      },
    })
    expect(onSubmit).not.toHaveBeenCalled()

    registry[Symbol.dispose]()
  })

  it('waits for the initial persisted keymap load before saving overrides', async () => {
    let resolveInitialRead: ((keymap: PersistedKeymap) => void) | undefined
    persistenceMocks.readUserKeymapFile.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInitialRead = resolve
      })
    )
    const registry = createRegistryWithKeymapItems([])

    const keymap = registry.get(keymapService)
    keymap.applyScope(MODE_SKETCHING_KEYMAP_SCOPE)

    const savePromise = keymap.savePersistedKeymap({
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [
        {
          command: 'zds.toolbar.sketch.line',
          keystrokes: ['shift+q'],
          scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        },
      ],
    })

    await Promise.resolve()
    expect(persistenceMocks.writeUserKeymapFile).not.toHaveBeenCalled()

    resolveInitialRead?.({ version: KEYMAP_SCHEMA_VERSION, bindings: [] })
    await savePromise

    expect(
      keymap.handleKeyDown(new KeyboardEvent('keydown', { key: 'l' }), {
        source: 'global',
      })
    ).toBe(false)
    expect(
      keymap.handleKeyDown(
        new KeyboardEvent('keydown', { key: 'Q', shiftKey: true }),
        { source: 'global' }
      )
    ).toBe(true)

    registry[Symbol.dispose]()
  })

  it('lets CodeMirror source handle contenteditable targets', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.code-mirror',
        title: 'Test CodeMirror',
        command: 'zds.settings.tab',
        source: 'test',
        keystrokes: ['escape'],
      },
    ])
    const keymap = registry.get(keymapService)
    const target = document.createElement('div')
    target.contentEditable = 'true'
    document.body.append(target)
    target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    const globalEvent = createKeyboardEventWithTarget('Escape', target)
    const codeMirrorEvent = createKeyboardEventWithTarget('Escape', target)

    expect(keymap.handleKeyDown(globalEvent, { source: 'global' })).toBe(false)
    expect(
      keymap.handleKeyDown(codeMirrorEvent, { source: 'codeMirror' })
    ).toBe(true)

    target.remove()
    registry[Symbol.dispose]()
  })

  it('ignores unmodified global shortcuts from input targets', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.sketch-solve-line',
        title: 'Test sketch solve line',
        command: 'zds.settings.tab',
        source: 'test',
        keystrokes: ['l'],
        scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
      },
    ])
    const keymap = registry.get(keymapService)
    const input = document.createElement('input')
    document.body.append(input)

    keymap.applyScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE)
    keymap.removeScope(CODE_EDITOR_FOCUSED_KEYMAP_SCOPE)
    keymap.applyScope(CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE)

    expect(
      keymap.handleKeyDown(createKeyboardEventWithTarget('l', input), {
        source: 'global',
      })
    ).toBe(false)

    input.remove()
    registry[Symbol.dispose]()
  })

  it('does not run mode keybindings from CodeMirror while the editor is focused', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.sketch-solve-line',
        title: 'Test sketch solve line',
        command: 'zds.settings.tab',
        source: 'test',
        keystrokes: ['l'],
        scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
      },
    ])
    const keymap = registry.get(keymapService)
    const event = new KeyboardEvent('keydown', { key: 'l' })

    keymap.applyScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE)
    keymap.removeScope(CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE)
    keymap.applyScope(CODE_EDITOR_FOCUSED_KEYMAP_SCOPE)

    expect(keymap.handleKeyDown(event, { source: 'codeMirror' })).toBe(false)

    registry[Symbol.dispose]()
  })

  it('handles default undo and redo keybindings from CodeMirror while the editor is focused', () => {
    const registry = createRegistryWithKeymapItems([])
    const keymap = registry.get(keymapService)

    keymap.removeScope(CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE)
    keymap.applyScope(CODE_EDITOR_FOCUSED_KEYMAP_SCOPE)

    expect(
      keymap.handleKeyDown(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          metaKey: true,
        }),
        { source: 'codeMirror' }
      )
    ).toBe(true)
    expect(
      keymap.handleKeyDown(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          metaKey: true,
          shiftKey: true,
        }),
        { source: 'codeMirror' }
      )
    ).toBe(true)

    registry[Symbol.dispose]()
  })

  it('keeps editor focus priority until focus moves outside editable content', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.sketch-solve-line',
        title: 'Test sketch solve line',
        command: 'zds.settings.tab',
        source: 'test',
        keystrokes: ['l'],
        scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
      },
    ])
    const keymap = registry.get(keymapService)
    const editableTarget = document.createElement('div')
    editableTarget.contentEditable = 'true'
    document.body.append(editableTarget)

    keymap.applyScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE)
    editableTarget.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    expect(keymap.getCurrentScopes()).toContain(
      CODE_EDITOR_FOCUSED_KEYMAP_SCOPE
    )
    expect(
      keymap.handleKeyDown(createKeyboardEventWithTarget('l', editableTarget), {
        source: 'global',
      })
    ).toBe(false)

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))

    expect(keymap.getCurrentScopes()).toContain(
      CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE
    )
    expect(
      keymap.handleKeyDown(createKeyboardEventWithTarget('l', editableTarget), {
        source: 'global',
      })
    ).toBe(true)

    editableTarget.remove()
    registry[Symbol.dispose]()
  })

  it('keeps editor focus priority while typing in the CodeMirror search field', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.sketch-solve-line',
        title: 'Test sketch solve line',
        command: 'zds.settings.tab',
        source: 'test',
        keystrokes: ['l'],
        scopes: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
      },
    ])
    const keymap = registry.get(keymapService)
    const editor = document.createElement('div')
    const searchPanel = document.createElement('div')
    const searchInput = document.createElement('input')

    editor.className = 'cm-editor'
    searchPanel.className = 'cm-panel cm-search'
    searchPanel.append(searchInput)
    editor.append(searchPanel)
    document.body.append(editor)

    keymap.applyScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE)
    searchInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    expect(keymap.getCurrentScopes()).toContain(
      CODE_EDITOR_FOCUSED_KEYMAP_SCOPE
    )
    expect(
      keymap.handleKeyDown(createKeyboardEventWithTarget('l', searchInput), {
        source: 'global',
      })
    ).toBe(false)

    editor.remove()
    registry[Symbol.dispose]()
  })

  it('accepts JSON-style keymap document contributions', () => {
    const keymapSlot = new Slot()
    const registry = new Registry()
    registry.configure([
      keymapExtension,
      keymapSlot.of(
        defineRegistryItem({
          id: 'test-keymap-document',
          provides: [
            provideKeymapDocument({
              source: 'test-keymap-document',
              bindings: [
                {
                  id: 'test.document',
                  title: 'Test document',
                  command: 'zds.settings.tab',
                  keystrokes: ['j'],
                  scopes: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
                },
              ],
            }),
          ],
        })
      ),
    ])

    const keymap = registry.get(keymapService)

    expect(keymap.keymap.value.items).toContainEqual(
      expect.objectContaining({
        id: 'test.document',
        source: 'test-keymap-document',
      })
    )

    registry[Symbol.dispose]()
  })
})

function createRegistryWithKeymapItems(
  items: Parameters<typeof provideKeymapItem>[0][],
  extraItems: Parameters<Registry['configure']>[0] = []
) {
  const keymapSlot = new Slot()
  const registry = new Registry()
  registry.configure([
    keymapExtension,
    ...extraItems,
    keymapSlot.of(
      defineRegistryItem({
        id: 'test-keymap-items',
        provides: items.map(provideKeymapItem),
      })
    ),
  ])
  return registry
}

function createKeyboardEventWithTarget(key: string, target: EventTarget) {
  const event = new KeyboardEvent('keydown', { key })
  Object.defineProperty(event, 'target', { value: target })
  return event
}
