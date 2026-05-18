import {
  Registry,
  Slot,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { isDesktop } from '@src/lib/isDesktop'
import {
  type CommandSystemService,
  commandSystemService,
} from '@src/registry/contracts/commands'
import {
  CODE_EDITOR_NOT_FOCUSED_KEYMAP_SCOPE,
  keymapService,
  provideKeymapDocument,
  provideKeymapItem,
} from '@src/registry/contracts/keymap'
import { defaultKeymap } from '@src/registry/extensions/keymap/defaultKeymap'
import { describe, expect, it, vi } from 'vitest'
import keymapExtension from '.'

describe('keymap extension', () => {
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

  it('uses a browser-safe Exit Sketch keybinding outside the desktop app', () => {
    const expectedExitSketchKeystroke = isDesktop()
      ? 'mod+escape'
      : 'shift+escape'

    expect(
      defaultKeymap.bindings.find(
        (binding) => binding.id === 'toolbar.sketching.exit'
      )?.keystrokes
    ).toEqual([expectedExitSketchKeystroke])
    expect(
      defaultKeymap.bindings.find(
        (binding) => binding.id === 'toolbar.sketch-solve.exit'
      )?.keystrokes
    ).toEqual([expectedExitSketchKeystroke])

    expect(
      defaultKeymap.bindings.some(
        (binding) =>
          binding.id === 'toolbar.sketching.exit.meta-escape' &&
          binding.keystrokes[0] === 'meta+escape'
      )
    ).toBe(isDesktop())
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
    const globalEvent = createKeyboardEventWithTarget('Escape', target)
    const codeMirrorEvent = createKeyboardEventWithTarget('Escape', target)

    expect(keymap.handleKeyDown(globalEvent, { source: 'global' })).toBe(false)
    expect(
      keymap.handleKeyDown(codeMirrorEvent, { source: 'codeMirror' })
    ).toBe(true)

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
