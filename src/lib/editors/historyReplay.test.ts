import { isolateHistory } from '@codemirror/commands'
import { StateEffect, StateField, Transaction } from '@codemirror/state'
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

it('keeps ordinary text history valid before and after a committed preview', () => {
  const { document, dispose } = createEditorDocument('abc')
  try {
    document.dispatch({
      changes: { from: 3, insert: 'd' },
      annotations: isolateHistory.of('full'),
    })
    document.dispatch({
      changes: { from: 4, insert: 'XYZ' },
      annotations: Transaction.addToHistory.of(false),
    })
    document.dispatch({
      effects: committedDocumentPreview.of({
        before: 'abcd',
        after: 'abcdXYZ',
      }),
      annotations: isolateHistory.of('full'),
    })
    expect(document.undo()).toBe(true)
    expect(document.contents.peek()).toBe('abcd')
    expect(document.undo()).toBe(true)
    expect(document.contents.peek()).toBe('abc')
    expect(document.redo()).toBe(true)
    expect(document.contents.peek()).toBe('abcd')
    expect(document.redo()).toBe(true)
    expect(document.contents.peek()).toBe('abcdXYZ')
  } finally {
    dispose()
  }
})

it('traverses ordinary edits around previews with or without text changes in the commit', () => {
  fc.assert(
    fc.property(
      contents,
      contents,
      fc.boolean(),
      (before, after, changesAtCommit) => {
        const { document, dispose } = createEditorDocument('initial')
        try {
          document.dispatch({
            changes: { from: 0, to: 7, insert: before },
            annotations: isolateHistory.of('full'),
          })
          const preview = changesAtCommit ? `${before}preview` : after
          document.dispatch({
            changes: { from: 0, to: before.length, insert: preview },
            annotations: Transaction.addToHistory.of(false),
          })
          document.dispatch({
            ...(changesAtCommit
              ? { changes: { from: 0, to: preview.length, insert: after } }
              : {}),
            effects: committedDocumentPreview.of({ before, after }),
            annotations: isolateHistory.of('full'),
          })
          for (const expected of [before, 'initial']) {
            expect(document.undo()).toBe(true)
            expect(document.contents.peek()).toBe(expected)
          }
          for (const expected of [before, after]) {
            expect(document.redo()).toBe(true)
            expect(document.contents.peek()).toBe(expected)
          }
        } finally {
          dispose()
        }
      }
    ),
    { numRuns: 75 }
  )
})

it('undoes consecutive previews and earlier edits even when previews replace overlapping text', () => {
  fc.assert(
    fc.property(contents, contents, contents, (before, middle, after) => {
      const { document, dispose } = createEditorDocument('initial')
      try {
        document.dispatch({
          changes: { from: 0, to: 7, insert: before },
          annotations: isolateHistory.of('full'),
        })
        let current = before
        for (const next of [middle, after]) {
          document.dispatch({
            changes: { from: 0, to: current.length, insert: next },
            annotations: Transaction.addToHistory.of(false),
          })
          document.dispatch({
            effects: committedDocumentPreview.of({
              before: current,
              after: next,
            }),
            annotations: isolateHistory.of('full'),
          })
          current = next
        }
        for (const expected of [middle, before, 'initial']) {
          expect(document.undo()).toBe(true)
          expect(document.contents.peek()).toBe(expected)
        }
        for (const expected of [before, middle, after]) {
          expect(document.redo()).toBe(true)
          expect(document.contents.peek()).toBe(expected)
        }
      } finally {
        dispose()
      }
    }),
    { numRuns: 75 }
  )
})

it('restores earlier history when an unrecorded preview is cancelled', () => {
  const { document, dispose } = createEditorDocument('abc')
  try {
    document.dispatch({
      changes: { from: 3, insert: 'd' },
      annotations: isolateHistory.of('full'),
    })
    document.dispatch({
      changes: { from: 3, to: 4 },
      annotations: Transaction.addToHistory.of(false),
    })
    document.dispatch({
      changes: { from: 3, insert: 'd' },
      annotations: Transaction.addToHistory.of(false),
    })
    expect(document.undo()).toBe(true)
    expect(document.contents.peek()).toBe('abc')
    expect(document.redo()).toBe(true)
    expect(document.contents.peek()).toBe('abcd')
  } finally {
    dispose()
  }
})

it.each(['commit', 'cancel'] as const)(
  'keeps configuration installed during a preview after %s',
  (finish) => {
    const field = StateField.define({
      create: () => 'configured',
      update: (value) => value,
    })
    const { document, dispose } = createEditorDocument('before')
    try {
      document.dispatch({
        changes: { from: 0, to: 6, insert: 'preview' },
        annotations: Transaction.addToHistory.of(false),
      })
      document.dispatch({
        effects: StateEffect.appendConfig.of(field),
        annotations: Transaction.addToHistory.of(false),
      })
      if (finish === 'commit')
        document.dispatch({
          effects: committedDocumentPreview.of({
            before: 'before',
            after: 'preview',
          }),
          annotations: isolateHistory.of('full'),
        })
      else
        document.dispatch({
          changes: { from: 0, to: 7, insert: 'before' },
          annotations: Transaction.addToHistory.of(false),
        })
      expect(document.state.field(field)).toBe('configured')
    } finally {
      dispose()
    }
  }
)
