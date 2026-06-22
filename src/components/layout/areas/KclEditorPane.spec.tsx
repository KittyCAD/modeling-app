import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const editorState = vi.hoisted(() => ({
  current: undefined as { editorView: { dom: HTMLElement } } | undefined,
  send: vi.fn(),
}))

vi.mock('@src/lib/boot', () => ({
  useOptionalExecutingEditor: () => editorState.current,
  useApp: () => ({
    commands: {
      send: editorState.send,
    },
  }),
}))

import { KclEditorPaneContents } from '@src/components/layout/areas/KclEditorPane'

function fakeEditor(testId: string, code: string) {
  const dom = document.createElement('div')
  dom.dataset.testid = testId
  dom.textContent = code
  return { editorView: { dom } }
}

describe('KclEditorPaneContents', () => {
  afterEach(() => {
    editorState.current = undefined
    editorState.send.mockClear()
  })

  it('replaces the mounted editor DOM when the executing file changes', () => {
    const firstEditor = fakeEditor('first-editor', 'first file')
    const secondEditor = fakeEditor('second-editor', 'second file')

    editorState.current = firstEditor
    const { rerender } = render(<KclEditorPaneContents />)

    expect(screen.getByTestId('first-editor')).toHaveTextContent('first file')

    editorState.current = secondEditor
    rerender(<KclEditorPaneContents />)

    expect(screen.queryByTestId('first-editor')).not.toBeInTheDocument()
    expect(firstEditor.editorView.dom.parentElement).toBeNull()
    expect(screen.getByTestId('second-editor')).toHaveTextContent('second file')
  })
})
