import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import type { MarkdownEditorActions } from '@kittycad/ui-components'
import { MachineManager } from '@src/lib/MachineManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import {
  KEYMAP_SCHEMA_VERSION,
  keymapScopesValueSpec,
  keymapService,
  keymapValueSpec,
  matchKeymapKeystrokes,
} from '@src/registry/contracts/keymap'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import {
  MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE,
  markdownEditorService,
} from '@src/registry/contracts/markdownEditor'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { commandsExtension } from '@src/registry/extensions/commands'
import keymapExtension from '@src/registry/extensions/keymap'
import { defaultKeymapItem } from '@src/registry/extensions/keymap/defaultKeymap'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import markdownEditorExtension, { MARKDOWN_EDITOR_COMMAND_IDS } from '.'

const persistenceMocks = vi.hoisted(() => ({
  readUserKeymapFile: vi.fn(),
  writeUserKeymapFile: vi.fn(),
}))

vi.mock('@src/registry/extensions/keymap/persistence', () => persistenceMocks)

function createMarkdownEditorActions(
  overrides: Partial<MarkdownEditorActions> = {}
): MarkdownEditorActions {
  return {
    toggleBold: vi.fn(() => true),
    toggleItalic: vi.fn(() => true),
    setLink: vi.fn(() => true),
    toggleBulletList: vi.fn(() => true),
    toggleOrderedList: vi.fn(() => true),
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    ...overrides,
  }
}

function createModKeyboardEvent(key: string, { shift = false } = {}) {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    metaKey: true,
    shiftKey: shift,
  })
}

describe('markdown editor extension', () => {
  beforeEach(() => {
    persistenceMocks.readUserKeymapFile.mockResolvedValue({
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [],
    })
    persistenceMocks.writeUserKeymapFile.mockResolvedValue(undefined)
  })

  it('routes Markdown editor shortcuts only while the Markdown editor scope is focused', () => {
    const registry = new Registry()
    registry.configure([defaultKeymapItem, markdownEditorExtension])

    const command = registry
      .get(commandsValueSpec)
      .find((candidate) => candidate.id === MARKDOWN_EDITOR_COMMAND_IDS.setLink)
    const tree = registry.get(keymapValueSpec)
    const keymapScopes = registry.get(keymapScopesValueSpec)
    const baseMatch = matchKeymapKeystrokes(tree, [], ['mod+k'], keymapScopes)
    const expectedShortcuts = [
      ['mod+b', MARKDOWN_EDITOR_COMMAND_IDS.toggleBold],
      ['mod+shift+b', MARKDOWN_EDITOR_COMMAND_IDS.toggleBold],
      ['mod+i', MARKDOWN_EDITOR_COMMAND_IDS.toggleItalic],
      ['mod+shift+i', MARKDOWN_EDITOR_COMMAND_IDS.toggleItalic],
      ['mod+k', MARKDOWN_EDITOR_COMMAND_IDS.setLink],
      ['mod+shift+8', MARKDOWN_EDITOR_COMMAND_IDS.toggleBulletList],
      ['mod+shift+*', MARKDOWN_EDITOR_COMMAND_IDS.toggleBulletList],
      ['mod+shift+7', MARKDOWN_EDITOR_COMMAND_IDS.toggleOrderedList],
      ['mod+shift+&', MARKDOWN_EDITOR_COMMAND_IDS.toggleOrderedList],
      ['mod+z', MARKDOWN_EDITOR_COMMAND_IDS.undo],
      ['mod+я', MARKDOWN_EDITOR_COMMAND_IDS.undo],
      ['mod+shift+z', MARKDOWN_EDITOR_COMMAND_IDS.redo],
      ['mod+y', MARKDOWN_EDITOR_COMMAND_IDS.redo],
      ['mod+shift+я', MARKDOWN_EDITOR_COMMAND_IDS.redo],
    ] as const

    expect(baseMatch).toMatchObject({
      type: 'full',
      item: { command: 'zds.commandPalette.open' },
    })
    for (const [keystroke, command] of expectedShortcuts) {
      expect(
        matchKeymapKeystrokes(
          tree,
          [MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE],
          [keystroke],
          keymapScopes
        )
      ).toMatchObject({
        type: 'full',
        item: { command },
      })
    }

    if (!command) {
      throw new Error('Missing Markdown editor link command')
    }

    const service = registry.get(markdownEditorService)
    const setLink = vi.fn(() => true)
    const unregister = service.registerActiveEditor(
      createMarkdownEditorActions({ setLink })
    )

    expect(command.onSubmit()).toBe(true)
    expect(setLink).toHaveBeenCalledTimes(1)

    unregister()

    expect(command.onSubmit()).toBe(false)

    registry[Symbol.dispose]()
  })

  it('executes active editor actions through the keymap service', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-wasm-promise',
        provides: [provideWasmPromise(Promise.resolve({} as ModuleType))],
      }),
      defineRegistryItem({
        id: 'test-machine-manager',
        providesServices: [
          provideService(machineManagerService, new MachineManager()),
        ],
      }),
      commandsExtension,
      keymapExtension,
      markdownEditorExtension,
    ])

    const keymap = registry.get(keymapService)
    const service = registry.get(markdownEditorService)
    const toggleBold = vi.fn(() => true)
    const setLink = vi.fn(() => true)
    const toggleBulletList = vi.fn(() => true)
    const toggleOrderedList = vi.fn(() => true)
    const redo = vi.fn(() => true)
    const unregister = service.registerActiveEditor(
      createMarkdownEditorActions({
        toggleBold,
        setLink,
        toggleBulletList,
        toggleOrderedList,
        redo,
      })
    )
    const expectedActions: [KeyboardEvent, () => void][] = [
      [createModKeyboardEvent('b'), toggleBold],
      [createModKeyboardEvent('k'), setLink],
      [createModKeyboardEvent('*', { shift: true }), toggleBulletList],
      [createModKeyboardEvent('&', { shift: true }), toggleOrderedList],
      [createModKeyboardEvent('z', { shift: true }), redo],
    ]

    keymap.applyScope(MARKDOWN_EDITOR_FOCUSED_KEYMAP_SCOPE)

    for (const [event, actionSpy] of expectedActions) {
      expect(keymap.handleKeyDown(event, { source: 'global' })).toBe(true)
      expect(actionSpy).toHaveBeenCalledTimes(1)
    }

    unregister()
    registry[Symbol.dispose]()
  })
})
