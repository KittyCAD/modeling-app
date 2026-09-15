import {
  Registry,
  Slot,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import type { Command } from '@src/lib/commandTypes'
import {
  FILE_COMMAND_SCOPES,
  GLOBAL_COMMAND_SCOPES,
  HOME_COMMAND_SCOPE,
  MODE_MODELING_COMMAND_SCOPE,
  SETTINGS_COMMAND_SCOPE,
  type CommandSystemService,
  commandScopeService,
  commandScopesValueSpec,
  commandSystemService,
} from '@src/registry/contracts/commands'
import {
  CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
  CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE,
  EDITABLE_FOCUSED_KEYMAP_SCOPE,
  KEYMAP_SCHEMA_VERSION,
  MODE_SKETCHING_KEYMAP_SCOPE,
  MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
  type PersistedKeymap,
  keymapContract,
  keymapScopesValueSpec,
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
    persistenceMocks.readUserKeymapFile.mockReset().mockResolvedValue({
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [],
    })
    persistenceMocks.writeUserKeymapFile
      .mockReset()
      .mockResolvedValue(undefined)
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

  it('shares active scope state with the command scope service', () => {
    const registry = createRegistryWithKeymapItems([])
    const commandScopes = registry.get(commandScopeService)
    const keymap = registry.get(keymapService)

    commandScopes.applyScope('test.command-scope')
    expect(keymap.getCurrentScopes()).toContain('test.command-scope')

    keymap.applyScope('test.keymap-scope')
    expect(commandScopes.activeScopes.value).toContain('test.keymap-scope')

    keymap.removeScope('test.command-scope')
    expect(commandScopes.getCurrentScopes()).not.toContain('test.command-scope')

    registry[Symbol.dispose]()
  })

  it('keeps the keymap scope ValueSpec as a command scope alias', () => {
    expect(keymapScopesValueSpec).toBe(commandScopesValueSpec)
    expect(keymapContract.keymapScopesValueSpec).toBe(commandScopesValueSpec)
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

  it('uses P for the hovered tool picker while preserving sketch shortcuts', () => {
    const toolPicker = defaultKeymap.bindings.find(
      (binding) => binding.id === 'toolbar.sketch.tool-picker'
    )
    expect(toolPicker?.keystrokes).toEqual(['p'])
    expect(toolPicker?.command).toBe('zds.toolbar.sketch.toolPicker')

    const spline = defaultKeymap.bindings.find(
      (binding) => binding.id === 'toolbar.sketch.spline'
    )
    expect(spline?.keystrokes).toEqual(['s'])
    expect(spline?.command).toBe('zds.toolbar.sketch.spline')

    const construction = defaultKeymap.bindings.find(
      (binding) => binding.id === 'toolbar.sketch.construction'
    )
    expect(construction?.keystrokes).toEqual(['q'])
    expect(construction?.command).toBe('zds.toolbar.sketch.construction')
  })

  it('marks a partial match and awaits more input', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.keystrokes',
        title: 'Test keystrokes',
        command: 'test.keystrokes',
        source: 'test',
        keystrokes: ['q', 'w'],
        when: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
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
        command: 'test.full',
        source: 'test',
        keystrokes: ['x'],
        when: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
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
        when: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
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
        when: ['settings-open'],
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

  it('does not let a user binding broaden a built-in action context', () => {
    window.history.replaceState(null, '', '/settings?tab=user')
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.user-settings-tab',
        title: 'Test user settings tab',
        command: 'zds.settings.tab',
        source: 'User',
        keystrokes: ['mod+u'],
        arguments: { tab: 'keybindings' },
      },
    ])
    const keymap = registry.get(keymapService)

    const outsideSettingsEvent = createModUEvent()
    expect(
      keymap.handleKeyDown(outsideSettingsEvent, { source: 'global' })
    ).toBe(false)
    expect(outsideSettingsEvent.defaultPrevented).toBe(false)

    keymap.applyScope(SETTINGS_COMMAND_SCOPE)
    const settingsEvent = createModUEvent()
    expect(keymap.handleKeyDown(settingsEvent, { source: 'global' })).toBe(true)
    expect(settingsEvent.defaultPrevented).toBe(true)

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
      {
        commands: [
          createTestCommand('test.command', GLOBAL_COMMAND_SCOPES, {
            name: 'Run test command',
            args: {
              value: {
                inputType: 'string',
                required: true,
              },
            },
            onSubmit,
          }),
        ],
        send,
      }
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

  it('does not let a user binding broaden a command context', () => {
    const send = vi.fn()
    const registry = createRegistryWithKeymapItems(
      [
        {
          id: 'test.file-command-keymap',
          title: 'Test file command keymap',
          command: 'test.file-command',
          source: 'User',
          keystrokes: ['mod+u'],
        },
      ],
      {
        commands: [createTestCommand('test.file-command', FILE_COMMAND_SCOPES)],
        send,
      }
    )
    const keymap = registry.get(keymapService)

    keymap.applyScope(HOME_COMMAND_SCOPE)
    const homeEvent = createModUEvent()
    expect(keymap.handleKeyDown(homeEvent, { source: 'global' })).toBe(false)
    expect(homeEvent.defaultPrevented).toBe(false)
    expect(send).not.toHaveBeenCalled()

    keymap.applyScope(MODE_MODELING_COMMAND_SCOPE)
    const modelingEvent = createModUEvent()
    expect(keymap.handleKeyDown(modelingEvent, { source: 'global' })).toBe(true)
    expect(modelingEvent.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledOnce()

    keymap.applyScope(SETTINGS_COMMAND_SCOPE)
    const settingsEvent = createModUEvent()
    expect(keymap.handleKeyDown(settingsEvent, { source: 'global' })).toBe(
      false
    )
    expect(settingsEvent.defaultPrevented).toBe(false)
    expect(send).toHaveBeenCalledOnce()

    registry[Symbol.dispose]()
  })

  it.each(['test.command-that-no-longer-exists', 'toString'])(
    'does not consume a shortcut for unknown command %s',
    (command) => {
      const registry = createRegistryWithKeymapItems(
        [
          {
            id: 'test.stale-command-keymap',
            title: 'Stale command keymap',
            command,
            source: 'User',
            keystrokes: ['mod+u'],
          },
        ],
        { commands: [] }
      )
      const keymap = registry.get(keymapService)
      const event = createModUEvent()

      expect(keymap.handleKeyDown(event, { source: 'global' })).toBe(false)
      expect(event.defaultPrevented).toBe(false)

      registry[Symbol.dispose]()
    }
  )

  it('waits for the initial persisted keymap load before saving overrides', async () => {
    let resolveInitialRead: ((keymap: PersistedKeymap) => void) | undefined
    persistenceMocks.readUserKeymapFile.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInitialRead = resolve
      })
    )
    const registry = createRegistryWithKeymapItems([], {
      commands: [
        createTestCommand('zds.toolbar.sketchLegacy.line', [
          MODE_SKETCHING_KEYMAP_SCOPE,
        ]),
        createTestCommand('zds.toolbar.sketch.line', [
          MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
        ]),
      ],
    })

    const keymap = registry.get(keymapService)
    keymap.applyScope(MODE_SKETCHING_KEYMAP_SCOPE)

    const savePromise = keymap.savePersistedKeymap({
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [
        {
          command: 'zds.toolbar.sketch.line',
          keystrokes: ['shift+q'],
          when: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        },
      ],
    })

    await Promise.resolve()
    expect(persistenceMocks.writeUserKeymapFile).not.toHaveBeenCalled()

    resolveInitialRead?.({ version: KEYMAP_SCHEMA_VERSION, bindings: [] })
    await savePromise

    expect(persistenceMocks.writeUserKeymapFile).toHaveBeenCalledOnce()
    expect(persistenceMocks.writeUserKeymapFile).toHaveBeenCalledWith({
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [
        {
          command: 'zds.toolbar.sketch.line',
          keystrokes: ['shift+q'],
          when: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        },
      ],
    })
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

  it('normalizes legacy scopes before storing and writing user bindings', async () => {
    const registry = createRegistryWithKeymapItems([])
    const keymap = registry.get(keymapService)
    const legacyKeymap = {
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [
        {
          command: 'test.legacy',
          keystrokes: ['mod+l'],
          scopes: ['legacy-context'],
        },
      ],
    } as const

    await keymap.savePersistedKeymap(legacyKeymap)

    const expected = {
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [
        {
          command: 'test.legacy',
          keystrokes: ['mod+l'],
          when: ['legacy-context'],
        },
      ],
    }
    expect(keymap.persistedKeymap.value).toEqual(expected)
    expect(persistenceMocks.writeUserKeymapFile).toHaveBeenCalledWith(expected)

    registry[Symbol.dispose]()
  })

  it('lets CodeMirror source handle contenteditable targets', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.code-mirror',
        title: 'Test CodeMirror',
        command: 'test.code-mirror',
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
        command: 'test.sketch-solve-line',
        source: 'test',
        keystrokes: ['l'],
        when: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
      },
    ])
    const keymap = registry.get(keymapService)
    const input = document.createElement('input')
    document.body.append(input)

    keymap.applyScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE)
    keymap.removeScope(CODE_EDITOR_FOCUSED_KEYMAP_SCOPE)
    keymap.applyScope(CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE)
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    expect(keymap.getCurrentScopes()).not.toContain(
      CODE_EDITOR_FOCUSED_KEYMAP_SCOPE
    )
    expect(keymap.getCurrentScopes()).toContain(EDITABLE_FOCUSED_KEYMAP_SCOPE)

    expect(
      keymap.handleKeyDown(createKeyboardEventWithTarget('l', input), {
        source: 'global',
      })
    ).toBe(false)

    input.remove()
    registry[Symbol.dispose]()
  })

  it('does not run modified mode shortcuts from input targets', () => {
    const send = vi.fn()
    const registry = createRegistryWithKeymapItems(
      [
        {
          id: 'test.sketch-select-all-keymap',
          title: 'Test sketch select all',
          command: 'test.sketch-select-all',
          source: 'test',
          keystrokes: ['mod+a'],
          when: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
        },
      ],
      {
        commands: [
          createTestCommand('test.sketch-select-all', [
            MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
          ]),
        ],
        send,
      }
    )
    const keymap = registry.get(keymapService)
    const input = document.createElement('input')
    document.body.append(input)

    keymap.applyScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE)
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    const event = createKeyboardEventWithTarget('a', input, {
      ctrlKey: true,
      metaKey: true,
      cancelable: true,
    })
    expect(keymap.getCurrentScopes()).toContain(EDITABLE_FOCUSED_KEYMAP_SCOPE)
    expect(keymap.handleKeyDown(event, { source: 'global' })).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(send).not.toHaveBeenCalled()

    input.remove()
    registry[Symbol.dispose]()
  })

  it('does not run mode keybindings from CodeMirror while the editor is focused', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.sketch-solve-line',
        title: 'Test sketch solve line',
        command: 'test.sketch-solve-line',
        source: 'test',
        keystrokes: ['l'],
        when: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
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
    const registry = createRegistryWithKeymapItems([], {
      commands: ['zds.editor.undo', 'zds.editor.redo'].map((id) =>
        createTestCommand(id, [CODE_EDITOR_FOCUSED_KEYMAP_SCOPE])
      ),
    })
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

  it('does not treat arbitrary editable content as the code editor', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.sketch-solve-line',
        title: 'Test sketch solve line',
        command: 'test.sketch-solve-line',
        source: 'test',
        keystrokes: ['l'],
        when: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
      },
    ])
    const keymap = registry.get(keymapService)
    const editableTarget = document.createElement('div')
    editableTarget.contentEditable = 'true'
    document.body.append(editableTarget)

    keymap.applyScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE)
    editableTarget.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    expect(keymap.getCurrentScopes()).not.toContain(
      CODE_EDITOR_FOCUSED_KEYMAP_SCOPE
    )
    expect(keymap.getCurrentScopes()).toContain(EDITABLE_FOCUSED_KEYMAP_SCOPE)
    expect(
      keymap.handleKeyDown(createKeyboardEventWithTarget('l', editableTarget), {
        source: 'global',
      })
    ).toBe(false)

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))

    expect(keymap.getCurrentScopes()).not.toContain(
      EDITABLE_FOCUSED_KEYMAP_SCOPE
    )
    expect(keymap.getCurrentScopes()).toContain(
      CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE
    )
    expect(
      keymap.handleKeyDown(createKeyboardEventWithTarget('l', document.body), {
        source: 'global',
      })
    ).toBe(true)

    editableTarget.remove()
    registry[Symbol.dispose]()
  })

  it('reconciles stale editable focus before matching a global keydown', () => {
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.sketch-solve-line',
        title: 'Test sketch solve line',
        command: 'test.sketch-solve-line',
        source: 'test',
        keystrokes: ['l'],
        when: [MODE_SKETCH_SOLVE_KEYMAP_SCOPE],
      },
    ])
    const keymap = registry.get(keymapService)
    const input = document.createElement('input')
    document.body.append(input)

    keymap.applyScope(MODE_SKETCH_SOLVE_KEYMAP_SCOPE)
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    input.remove()

    expect(keymap.getCurrentScopes()).toContain(EDITABLE_FOCUSED_KEYMAP_SCOPE)
    expect(
      keymap.handleKeyDown(createKeyboardEventWithTarget('l', document.body), {
        source: 'global',
      })
    ).toBe(true)
    expect(keymap.getCurrentScopes()).not.toContain(
      EDITABLE_FOCUSED_KEYMAP_SCOPE
    )
    expect(keymap.getCurrentScopes()).toContain(
      CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE
    )

    registry[Symbol.dispose]()
  })

  it('preserves editor scope for command palette trigger pointerdown', () => {
    const registry = createRegistryWithKeymapItems([])
    const keymap = registry.get(keymapService)
    const editor = document.createElement('div')
    const content = document.createElement('div')
    const commandPaletteTrigger = document.createElement('button')

    editor.className = 'cm-editor'
    content.className = 'cm-content'
    content.contentEditable = 'true'
    editor.append(content)
    commandPaletteTrigger.dataset.commandScopePreserveFocus = 'true'
    document.body.append(editor, commandPaletteTrigger)

    content.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    commandPaletteTrigger.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true })
    )

    expect(keymap.getCurrentScopes()).toContain(
      CODE_EDITOR_FOCUSED_KEYMAP_SCOPE
    )
    expect(keymap.getCurrentScopes()).not.toContain(
      CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE
    )

    editor.remove()
    commandPaletteTrigger.remove()
    registry[Symbol.dispose]()
  })

  it('treats CodeMirror form controls as editable, not editor content', () => {
    const send = vi.fn()
    const registry = createRegistryWithKeymapItems(
      [
        {
          id: 'test.code-editor-undo',
          title: 'Test code editor undo',
          command: 'test.code-editor-undo',
          source: 'test',
          keystrokes: ['mod+z'],
          scopes: [CODE_EDITOR_FOCUSED_KEYMAP_SCOPE],
        },
      ],
      {
        commands: [
          createTestCommand('test.code-editor-undo', [
            CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
          ]),
        ],
        send,
      }
    )
    const keymap = registry.get(keymapService)
    const editor = document.createElement('div')
    const content = document.createElement('div')
    const searchPanel = document.createElement('div')
    const searchInput = document.createElement('input')

    editor.className = 'cm-editor'
    content.className = 'cm-content'
    content.contentEditable = 'true'
    searchPanel.className = 'cm-panel cm-search'
    searchPanel.append(searchInput)
    editor.append(content, searchPanel)
    document.body.append(editor)

    content.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(keymap.getCurrentScopes()).toContain(
      CODE_EDITOR_FOCUSED_KEYMAP_SCOPE
    )

    searchInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    expect(keymap.getCurrentScopes()).not.toContain(
      CODE_EDITOR_FOCUSED_KEYMAP_SCOPE
    )
    expect(keymap.getCurrentScopes()).toContain(EDITABLE_FOCUSED_KEYMAP_SCOPE)
    const undoEvent = createKeyboardEventWithTarget('z', searchInput, {
      ctrlKey: true,
      metaKey: true,
      cancelable: true,
    })
    expect(keymap.handleKeyDown(undoEvent, { source: 'global' })).toBe(false)
    expect(undoEvent.defaultPrevented).toBe(false)
    expect(send).not.toHaveBeenCalled()

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
                  when: [CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE],
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
  options: {
    commands?: Command[]
    send?: CommandSystemService['send']
    extraItems?: Parameters<Registry['configure']>[0]
  } = {}
) {
  const inferredCommands = [...new Set(items.map((item) => item.command))].map(
    (id) => createTestCommand(id, GLOBAL_COMMAND_SCOPES)
  )
  const commands = options.commands ?? inferredCommands
  const keymapSlot = new Slot()
  const registry = new Registry()
  registry.configure([
    keymapExtension,
    ...(commands.length > 0
      ? [createTestCommandSystemItem(commands, options.send ?? vi.fn())]
      : []),
    ...(options.extraItems ?? []),
    keymapSlot.of(
      defineRegistryItem({
        id: 'test-keymap-items',
        provides: items.map(provideKeymapItem),
      })
    ),
  ])
  return registry
}

function createTestCommandSystemItem(
  commands: Command[],
  send: CommandSystemService['send']
) {
  return defineRegistryItem({
    id: 'test-command-system',
    providesServices: [
      provideService(commandSystemService, {
        actor: {
          getSnapshot: () => ({ context: { commands } }),
        },
        send,
        useState: vi.fn(),
      } as unknown as CommandSystemService),
    ],
  })
}

function createTestCommand(
  id: string,
  scopes: Command['scopes'],
  overrides: Partial<Omit<Command, 'id' | 'scopes'>> = {}
): Command {
  return {
    id,
    scopes,
    groupId: 'test',
    name: id,
    needsReview: false,
    onSubmit: vi.fn(),
    ...overrides,
  }
}

function createKeyboardEventWithTarget(
  key: string,
  target: EventTarget,
  init: KeyboardEventInit = {}
) {
  const event = new KeyboardEvent('keydown', { ...init, key })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

function createModUEvent() {
  return new KeyboardEvent('keydown', {
    key: 'u',
    ctrlKey: true,
    metaKey: true,
    cancelable: true,
  })
}
