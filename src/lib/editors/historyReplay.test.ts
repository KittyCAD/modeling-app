import { isolateHistory } from '@codemirror/commands'
import { Transaction } from '@codemirror/state'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { createEditorDocument } from '@src/lib/editors/document'
import { committedDocumentPreview } from '@src/lib/editors/historyReplay'

const contents = fc
  .array(fc.constantFrom('a', 'b', 'c', '\n'), { maxLength: 40 })
  .map((chars) => chars.join(''))
it('undoes and redoes committed previews without a mounted surface, across changes in text length', () => {
  fc.assert(
    fc.property(contents, contents, (before, after) => {
      const { document, dispose } = createEditorDocument(before)
      try {
        document.dispatch({
          changes: { from: 0, to: before.length, insert: after },
          selection: { anchor: after.length },
          annotations: Transaction.addToHistory.of(false),
        })
        document.dispatch({
          effects: committedDocumentPreview.of({ before, after }),
          annotations: isolateHistory.of('full'),
        })
        expect(document.undo()).toBe(true)
        expect(document.contents.peek()).toBe(before)
        expect(document.state.selection.main.head).toBeLessThanOrEqual(
          before.length
        )
        expect(document.redo()).toBe(true)
        expect(document.contents.peek()).toBe(after)
        expect(document.undo()).toBe(true)
        expect(document.contents.peek()).toBe(before)
      } finally {
        dispose()
      }
    }),
    { numRuns: 75 }
  )
})

it('does not consume a preview history entry while the shared document is read only', () => {
  let editable = true
  const { document, dispose } = createEditorDocument('before', () => editable)
  try {
    document.dispatch({
      changes: { from: 0, to: 6, insert: 'after' },
      annotations: Transaction.addToHistory.of(false),
    })
    document.dispatch({
      effects: committedDocumentPreview.of({
        before: 'before',
        after: 'after',
      }),
    })
    editable = false
    expect(document.undo()).toBe(false)
    expect(document.contents.peek()).toBe('after')
    editable = true
    expect(document.undo()).toBe(true)
    expect(document.contents.peek()).toBe('before')
  } finally {
    dispose()
  }
})
