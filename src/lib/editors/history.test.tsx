import '@src/lib/projectSession/next/testFeature'
import { EditorView } from '@src/lib/editors/EditorView'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import { defineEditorView } from '@src/lib/editors/views'
import type { WebContentSendPayload } from '@src/menu/channels'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { contribute, Registry, type InputOf } from 'plankton'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const originalElectron = window.electron
let registry: Registry
const menuListeners = new Set<(payload: WebContentSendPayload) => void>()
beforeEach(async () => {
  window.electron = {
    menuOn: (callback: (payload: WebContentSendPayload) => void) => {
      menuListeners.add(callback)
      return () => {
        menuListeners.delete(callback)
      }
    },
  } as unknown as Window['electron']
  registry = new Registry()
  const _editorViewsContribution: InputOf<typeof editorViewsFacet> =
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
  await registry.configure([
    editorsExtension,
    [contribute(editorViewsFacet, () => _editorViewsContribution)],
  ])
})
afterEach(async () => {
  cleanup()
  await registry.dispose()
  window.electron = originalElectron
  vi.restoreAllMocks()
  menuListeners.clear()
})
function open() {
  const editors = registry.required(editorsService)
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
      changes: {
        from: second.state.doc.length,
        insert: ' changed',
      },
    })
  )
  fireEvent.pointerDown(screen.getAllByLabelText('Model background')[1])
  return {
    editors,
    first,
    second,
    right,
  }
}
function menu(menuLabel: 'Edit.Undo' | 'Edit.Redo') {
  act(() => {
    for (const listener of menuListeners)
      listener({
        menuLabel,
      })
  })
}
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
  const input = screen.getAllByRole('textbox', {
    name: 'Scene text field',
  })[1]
  input.focus()
  fireEvent.keyDown(input, {
    key: 'z',
    metaKey: true,
  })
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
it('handles native Code history after switching modes and stops routing to a closed view', async () => {
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
  await registry.dispose()
  expect(menuListeners.size).toBe(0)
})
