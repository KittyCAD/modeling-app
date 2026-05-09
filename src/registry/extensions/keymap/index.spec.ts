import { Registry, Slot, defineRegistryItem } from '@kittycad/registry'
import {
  keymapService,
  provideKeymapItem,
} from '@src/registry/contracts/keymap'
import { describe, expect, it, vi } from 'vitest'
import keymapExtension from '.'

describe('keymap extension', () => {
  it('marks a partial match and awaits more input', () => {
    const run = vi.fn()
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.sequence',
        title: 'Test sequence',
        description: 'Test sequence',
        sequence: ['q', 'w'],
        run,
      },
    ])

    const keymap = registry.get(keymapService)
    const event = new KeyboardEvent('keydown', { key: 'q' })

    expect(keymap.handleKeyDown(event, { source: 'global' })).toBe(true)
    expect(keymap.partialMatch.value).toBe(true)
    expect(run).not.toHaveBeenCalled()

    registry[Symbol.dispose]()
  })

  it('runs a full match and clears partial match state', () => {
    const run = vi.fn()
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.full',
        title: 'Test full',
        description: 'Test full',
        sequence: ['x'],
        run,
      },
    ])

    const keymap = registry.get(keymapService)
    const event = new KeyboardEvent('keydown', { key: 'x' })

    expect(keymap.handleKeyDown(event, { source: 'global' })).toBe(true)
    expect(keymap.partialMatch.value).toBe(false)
    expect(run).toHaveBeenCalledOnce()

    registry[Symbol.dispose]()
  })

  it('lets CodeMirror source handle contenteditable targets', () => {
    const run = vi.fn()
    const registry = createRegistryWithKeymapItems([
      {
        id: 'test.code-mirror',
        title: 'Test CodeMirror',
        description: 'Test CodeMirror',
        sequence: ['escape'],
        registerToCodeMirror: true,
        run,
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
    expect(run).toHaveBeenCalledOnce()

    registry[Symbol.dispose]()
  })
})

function createRegistryWithKeymapItems(
  items: Parameters<typeof provideKeymapItem>[0][]
) {
  const keymapSlot = new Slot()
  const registry = new Registry()
  registry.configure([
    keymapExtension,
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
