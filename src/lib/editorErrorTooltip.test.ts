import { EditorView } from '@codemirror/view'
import { showErrorMessage } from '@root/packages/codemirror-lsp-client/src/plugin/util'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

test('shows an editor error immediately and removes it at its readable lifetime without a fade', () => {
  vi.useFakeTimers()
  const view = new EditorView({ parent: document.body })
  vi.spyOn(view, 'coordsAtPos').mockReturnValue(null)
  try {
    showErrorMessage(view, 'Cannot rename this symbol')
    const message = document.body.querySelector('.cm-error-message')
    expect(message).toHaveTextContent('Cannot rename this symbol')
    vi.advanceTimersByTime(2999)
    expect(message).toBeInTheDocument()
    vi.advanceTimersByTime(1)
    expect(message).not.toBeInTheDocument()
  } finally {
    view.destroy()
  }
})
