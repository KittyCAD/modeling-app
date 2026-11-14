import { requireSuccess } from '@src/lib/editors/testViews'
import '@src/lib/projectSession/next/testFeature'
import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorViewsValueSpec,
} from '@src/lib/editors/registry/contract'
import { EditorView } from '@src/lib/editors/EditorView'
import { defineEditorView } from '@src/lib/editors/views'
import type { WebContentSendPayload } from '@src/menu/channels'
import { engineSceneRuntimeExtensionsSlot } from '@src/registry/contracts/engineScene'
import {
  activateZoodleRuntimeExtension,
  deactivateZoodleRuntimeExtension,
} from '@src/registry/extensions/engineScene/zoodleRuntimeExtension'

const originalElectron = window.electron
let registry: Registry
const menuListeners = new Set<(payload: WebContentSendPayload) => void>()
beforeEach(() => {
  window.electron = {
    menuOn: (callback: (payload: WebContentSendPayload) => void) => {
      menuListeners.add(callback)
      return () => {
        menuListeners.delete(callback)
      }
    },
  } as unknown as Window['electron']
  registry = new Registry()
  registry.configure([
    editorsExtension,
    engineSceneRuntimeExtensionsSlot.of(),
    defineRegistryItem({
      provides: [
        provide(
          editorViewsValueSpec,
          defineEditorView({
            id: 'modeling',
            label: 'Modeling',
            matches: '*',
            priority: 1000,
            Component: () => (
              <div aria-label="Model background">
                <input aria-label="Scene text field" />
              </div>
            ),
          })
        ),
      ],
    }),
  ])
})
afterEach(() => {
  cleanup()
  registry[Symbol.dispose]()
  window.electron = originalElectron
  vi.restoreAllMocks()
  menuListeners.clear()
})
function open() {
  const editors = registry.get(editorsService)
  const first = requireSuccess(editors.openEditor('/first.kcl', 'first'))
  const second = requireSuccess(editors.openEditor('/second.kcl', 'second'))
  const left = requireSuccess(editors.createView(first))
  const right = requireSuccess(editors.createView(second))
  render(
    <>
      <EditorView instance={left} editors={editors} />
      <EditorView instance={right} editors={editors} />
    </>
  )
  act(() =>
    second.dispatch({
      changes: { from: second.state.doc.length, insert: ' changed' },
    })
  )
  fireEvent.pointerDown(screen.getAllByLabelText('Model background')[1])
  return { editors, first, second, right }
}
function menu(menuLabel: 'Edit.Undo' | 'Edit.Redo') {
  act(() => {
    for (const listener of menuListeners) listener({ menuLabel })
  })
}
it('blocks native project history while Zoodle is open and restores it on close', () => {
  const { second } = open()
  const zoodleSession = {
    imageDataUrl: 'data:image/png;base64,aGVsbG8=',
    onCancel: vi.fn(),
    onSend: vi.fn(),
  }
  activateZoodleRuntimeExtension(registry, zoodleSession)
  menu('Edit.Undo')
  expect(second.contents.peek()).toBe('second changed')
  deactivateZoodleRuntimeExtension(registry)
  menu('Edit.Undo')
  expect(second.contents.peek()).toBe('second')
  activateZoodleRuntimeExtension(registry, zoodleSession)
  menu('Edit.Redo')
  expect(second.contents.peek()).toBe('second')
  deactivateZoodleRuntimeExtension(registry)
  menu('Edit.Redo')
  expect(second.contents.peek()).toBe('second changed')
})
it.each(['keyboard', 'menu'] as const)(
  'undoes and redoes only the focused Modeling document through %s',
  (source) => {
    const { first, second } = open()
    if (source === 'menu') menu('Edit.Undo')
    else
      fireEvent.keyDown(screen.getAllByLabelText('Model background')[1], {
        key: 'z',
        metaKey: true,
      })
    expect(second.contents.peek()).toBe('second')
    expect(first.contents.peek()).toBe('first')
    if (source === 'menu') menu('Edit.Redo')
    else
      fireEvent.keyDown(screen.getAllByLabelText('Model background')[1], {
        key: 'z',
        metaKey: true,
        shiftKey: true,
      })
    expect(second.contents.peek()).toBe('second changed')
    expect(first.contents.peek()).toBe('first')
  }
)
it('leaves text field history local instead of undoing the model', () => {
  const { second } = open()
  const input = screen.getAllByRole('textbox', { name: 'Scene text field' })[1]
  input.focus()
  fireEvent.keyDown(input, { key: 'z', metaKey: true })
  expect(second.contents.peek()).toBe('second changed')
  const original = Object.getOwnPropertyDescriptor(document, 'execCommand')
  const native = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', {
    value: native,
    configurable: true,
  })
  try {
    menu('Edit.Undo')
    expect(native).toHaveBeenCalledWith('undo')
    expect(second.contents.peek()).toBe('second changed')
  } finally {
    if (original) Object.defineProperty(document, 'execCommand', original)
    else Reflect.deleteProperty(document, 'execCommand')
  }
})
it('handles native Code history after switching modes and stops routing to a closed view', () => {
  const { editors, second, right } = open()
  act(() => {
    requireSuccess(editors.setView(right.id, 'editors.code'))
  })
  right.codeView.peek()!.focus()
  menu('Edit.Undo')
  expect(second.contents.peek()).toBe('second')
  menu('Edit.Redo')
  expect(second.contents.peek()).toBe('second changed')
  act(() => {
    requireSuccess(editors.closeView(right.id))
  })
  menu('Edit.Undo')
  expect(second.contents.peek()).toBe('second changed')
  registry[Symbol.dispose]()
  expect(menuListeners.size).toBe(0)
})
