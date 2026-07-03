import { hasNextSnippetField, snippet } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, test } from 'vitest'

import { clearSnippetBeforeEmptySelectionDelete } from './autocomplete'

const snippetTemplate = 'mirror2d(axis = ${0:X})${}'

function createView() {
  const parent = document.createElement('div')
  document.body.appendChild(parent)

  return new EditorView({
    parent,
    state: EditorState.create({
      doc: 'mirror2',
    }),
  })
}

function deleteSelection(view: EditorView) {
  const selection = view.state.selection.main

  view.dispatch({
    changes: {
      from: selection.from,
      to: selection.to,
      insert: '',
    },
    selection: {
      anchor: selection.from,
    },
    userEvent: 'delete.selection',
  })
}

function backspace(view: EditorView) {
  clearSnippetBeforeEmptySelectionDelete(view)

  const selection = view.state.selection.main

  view.dispatch({
    changes: {
      from: selection.from - 1,
      to: selection.from,
      insert: '',
    },
    selection: {
      anchor: selection.from - 1,
    },
    userEvent: 'delete.backward',
  })
}

function typeText(view: EditorView, text: string) {
  for (const character of text) {
    const selection = view.state.selection.main

    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: character,
      },
      selection: {
        anchor: selection.from + character.length,
      },
      userEvent: 'input.type',
    })
  }
}

describe('LSP autocomplete snippets', () => {
  let view: EditorView | undefined

  afterEach(() => {
    view?.destroy()
    view = undefined
    document.body.replaceChildren()
  })

  test('clears stale snippet state when editing through an emptied argument field', () => {
    view = createView()

    snippet(snippetTemplate)(view, { label: 'mirror2d' }, 0, 'mirror2'.length)
    expect(view.state.doc.toString()).toBe('mirror2d(axis = X)')
    expect(hasNextSnippetField(view.state)).toBe(true)

    // Regression coverage for https://github.com/KittyCAD/modeling-app/issues/12133.
    // After deleting the highlighted placeholder, the old snippet field is
    // zero-width. Backspacing through `axis = ` should leave snippet mode,
    // otherwise the field follows the cursor and later wraps typed `=`.
    deleteSelection(view)
    expect(view.state.doc.toString()).toBe('mirror2d(axis = )')
    expect(hasNextSnippetField(view.state)).toBe(true)

    backspace(view)
    expect(hasNextSnippetField(view.state)).toBe(false)

    while (view.state.doc.toString() !== 'mirror2d()') {
      backspace(view)
    }

    typeText(view, 'foo = ')
    expect(view.state.doc.toString()).toBe('mirror2d(foo = )')
    expect(view.state.selection.main.from).toBe('mirror2d(foo = '.length)
  })
})
