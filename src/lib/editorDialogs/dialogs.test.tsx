import { signal } from '@preact/signals-core'
import { useSignals } from '@preact/signals-react/runtime'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { undo } from '@codemirror/commands'
import { createEditorDialogs } from '@src/lib/editorDialogs/dialogs'
import { EditorDialogsHost } from '@src/lib/editorDialogs/EditorDialogsHost'
import { defineEditorView } from '@src/lib/editors/views'
import { defineExecutorCapability } from '@src/lib/executors/registry/contract'
import {
  parseArgumentDocument,
  setArgument,
} from '@src/lib/commandArguments/document'
import { afterEach, expect, it, vi } from 'vitest'

const capability = defineExecutorCapability({
  id: 'test.arguments',
  matches: ({ documentType }) => documentType === 'test.arguments',
  execute: (contents: string) => {
    const values = parseArgumentDocument(contents)
    return values instanceof Error ? values : { amount: Number(values.amount) }
  },
})
const form = defineEditorView({
  id: 'test.form',
  label: 'Form',
  priority: 100,
  matches: ({ documentType }) => documentType === 'test.arguments',
  Component: ({ editor }) => {
    useSignals()
    const value = parseArgumentDocument(editor.contents.value)
    return value instanceof Error ? (
      <p role="alert">Invalid draft</p>
    ) : (
      <label>
        Amount
        <input
          aria-label="Amount"
          value={String(value.amount ?? '')}
          onChange={(event) =>
            setArgument(editor, 'amount', event.target.value)
          }
        />
      </label>
    )
  },
})
const dialogs: ReturnType<typeof createEditorDialogs>[] = []
afterEach(() => {
  for (const service of dialogs.splice(0)) service.close()
})
function setup(
  prepare = vi.fn(async (data: { amount: number }) => ({
    commit: () => {
      applied.push(data.amount)
      return undefined
    },
  }))
) {
  const service = createEditorDialogs(signal([form]), signal([capability]))
  dialogs.push(service)
  const dialog = service.open({
    title: 'Test command',
    documentType: 'test.arguments',
    contents: '{"amount":5}',
    capability,
    prepareSubmit: prepare,
  })
  render(<EditorDialogsHost dialogs={service} />)
  return { service, dialog, prepare }
}
const applied: number[] = []
afterEach(() => {
  applied.length = 0
})

it('shares form edits and undo with Code mode, and submits from Code', async () => {
  const { dialog, service } = setup()
  fireEvent.change(await screen.findByRole('textbox', { name: 'Amount' }), {
    target: { value: '12' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Dialog mode' }), {
    target: { value: 'editors.code' },
  })
  expect(parseArgumentDocument(dialog.editor.contents.peek())).toEqual({
    amount: '12',
  })
  act(() => {
    undo(dialog.editor.view)
  })
  expect(parseArgumentDocument(dialog.editor.contents.peek())).toEqual({
    amount: 5,
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
  await waitFor(() => expect(service.active.value).toBeUndefined())
  expect(applied).toEqual([5])
})

it('keeps malformed Code intact across mode switches until the user repairs it', async () => {
  const { dialog } = setup()
  await screen.findByRole('textbox', { name: 'Amount' })
  act(() => {
    dialog.editor.view.dispatch({
      changes: {
        from: 0,
        to: dialog.editor.contents.peek().length,
        insert: '{"amount":',
      },
    })
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'Dialog mode' }), {
    target: { value: 'editors.code' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Dialog mode' }), {
    target: { value: 'test.form' },
  })
  expect(dialog.editor.contents.peek()).toBe('{"amount":')
  expect(await screen.findByText('Invalid draft')).toBeInTheDocument()
})

it.each(['cancel', 'edit'] as const)(
  'does not commit an awaited submission after %s',
  async (change) => {
    const ready = Promise.withResolvers<{ commit: () => undefined }>()
    const commit = vi.fn(() => undefined)
    const { dialog, service, prepare } = setup(vi.fn(() => ready.promise))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(prepare).toHaveBeenCalled())
    const destroy = vi.spyOn(dialog.editor.view, 'destroy')
    act(() => {
      if (change === 'cancel') dialog.cancel()
      else setArgument(dialog.editor, 'amount', 9)
    })
    await act(async () => {
      ready.resolve({ commit })
      await ready.promise
    })
    expect(commit).not.toHaveBeenCalled()
    if (change === 'edit') {
      expect(service.active.peek()).toBe(dialog)
      expect(dialog.editor.contents.peek()).toContain('9')
    } else expect(destroy).toHaveBeenCalled()
  }
)
