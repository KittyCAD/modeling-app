import { markdown } from '@codemirror/lang-markdown'
import { history, undo } from '@codemirror/commands'
import { highlightingFor } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { editorAppearance } from '@src/editor/plugins/theme/appearance'
import { editorMarkdownHighlight } from '@src/editor/plugins/theme'
import { expect, it, vi } from 'vitest'

it('switches a live buffer between app themes without losing its syntax styling or undo history', async () => {
  const view = new EditorView({
    doc: '# Heading',
    extensions: [
      history(),
      markdown(),
      editorAppearance(),
      editorMarkdownHighlight.light,
      editorMarkdownHighlight.dark,
    ],
  })
  try {
    const light = highlightingFor(view.state, [tags.heading1])
    view.dispatch({ changes: { from: 0, insert: 'edited ' } })
    document.body.classList.add('dark')
    await vi.waitFor(() =>
      expect(view.state.facet(EditorView.darkTheme)).toBe(true)
    )
    const dark = highlightingFor(view.state, [tags.heading1])
    expect(dark).toBeTruthy()
    expect(dark).not.toBe(light)
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('# Heading')
    document.body.classList.remove('dark')
    await vi.waitFor(() =>
      expect(view.state.facet(EditorView.darkTheme)).toBe(false)
    )
    expect(highlightingFor(view.state, [tags.heading1])).toBe(light)
  } finally {
    view.destroy()
    document.body.classList.remove('dark')
  }
})
