import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CodemodReviewDiff } from '@src/components/CommandBar/CodemodReviewDiff'
import { Themes } from '@src/lib/theme'

vi.mock('@codemirror/merge', () => ({
  MergeView: class MergeView {
    dom: HTMLDivElement

    constructor({
      a,
      b,
      parent,
    }: {
      a: { doc: string; extensions: Extension }
      b: { doc: string; extensions: Extension }
      parent: Element
    }) {
      this.dom = document.createElement('div')
      this.dom.dataset.testid = 'mock-merge-view'
      this.dom.dataset.before = a.doc
      this.dom.dataset.after = b.doc

      for (const editorConfig of [a, b]) {
        const editor = document.createElement('div')
        editor.setAttribute('role', 'textbox')
        const state = EditorState.create({
          doc: editorConfig.doc,
          extensions: editorConfig.extensions,
        })
        editor.setAttribute(
          'contenteditable',
          state.facet(EditorView.editable) ? 'true' : 'false'
        )
        editor.setAttribute('aria-readonly', state.readOnly ? 'true' : 'false')
        for (const attributes of state.facet(EditorView.contentAttributes)) {
          for (const [name, value] of Object.entries(attributes)) {
            editor.setAttribute(name, value)
          }
        }
        this.dom.appendChild(editor)
      }

      parent.appendChild(this.dom)
    }

    destroy() {
      this.dom.remove()
    }
  },
}))

describe('CodemodReviewDiff', () => {
  it('shows the failed codemod diff on demand', () => {
    render(
      <CodemodReviewDiff
        details={{
          type: 'codemod',
          currentCode: 'part = extrude(sketch, length = 10)',
          proposedCode: 'part = extrude(sketch, length = -10)',
        }}
        resolvedTheme={Themes.Light}
      />
    )

    const toggle = screen.getByRole('button', {
      name: 'Code changes',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('cmd-bar-codemod-diff')).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Current file')).toBeInTheDocument()
    expect(screen.getByText('Code changes')).toBeInTheDocument()
    expect(screen.getByText('Proposed file')).toBeInTheDocument()
    const currentFile = screen.getByRole('textbox', { name: 'Current file' })
    const proposedFile = screen.getByRole('textbox', { name: 'Proposed file' })
    expect(currentFile).toHaveAttribute('contenteditable', 'true')
    expect(currentFile).toHaveAttribute('aria-readonly', 'true')
    expect(proposedFile).toHaveAttribute('contenteditable', 'true')
    expect(proposedFile).toHaveAttribute('aria-readonly', 'true')
    expect(screen.getByTestId('cmd-bar-codemod-diff')).toBeInTheDocument()
    expect(screen.getByTestId('mock-merge-view')).toHaveAttribute(
      'data-before',
      'part = extrude(sketch, length = 10)'
    )
    expect(screen.getByTestId('mock-merge-view')).toHaveAttribute(
      'data-after',
      'part = extrude(sketch, length = -10)'
    )

    fireEvent.click(toggle)
    expect(screen.queryByTestId('cmd-bar-codemod-diff')).not.toBeInTheDocument()
  })
})
