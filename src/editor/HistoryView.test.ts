import { invertedEffects } from '@codemirror/commands'
import { Annotation, StateEffect, Transaction } from '@codemirror/state'
import { EditorView } from 'codemirror'
import { describe, expect, it } from 'vitest'

import { HistoryView, localHistoryTarget } from '@src/editor/HistoryView'
import { createHistoryExtension } from '@src/editor/historyConfig'

describe('HistoryView', () => {
  it('locks mixed history and restores both pointers after a failed global undo', () => {
    const historyEffect = StateEffect.define<number>()
    const ignoreEffect = Annotation.define<boolean>()
    let appliedGlobalValue = 0

    const historyView = new HistoryView([
      invertedEffects.of((transaction) =>
        transaction.effects
          .filter((effect) => effect.is(historyEffect))
          .map((effect) => historyEffect.of(-effect.value))
      ),
      EditorView.updateListener.of((update) => {
        for (const transaction of update.transactions) {
          if (transaction.annotation(ignoreEffect)) continue
          for (const effect of transaction.effects) {
            if (effect.is(historyEffect)) appliedGlobalValue += effect.value
          }
        }
      }),
    ])
    const localView = new EditorView({
      doc: '',
      extensions: [createHistoryExtension(), localHistoryTarget.of([])],
    })
    historyView.registerLocalHistoryTarget(localView)

    historyView.dispatch({
      effects: historyEffect.of(1),
      annotations: [ignoreEffect.of(true)],
    })
    localView.dispatch({
      changes: { from: 0, insert: 'manual edit' },
      annotations: [Transaction.addToHistory.of(true)],
    })

    expect(historyView.undo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('')

    historyView.setOperationInProgress(true)
    expect(historyView.undo(localView)).toBe(false)
    expect(appliedGlobalValue).toBe(0)

    historyView.setOperationInProgress(false)
    expect(historyView.undo(localView)).toBe(true)
    expect(appliedGlobalValue).toBe(-1)

    expect(historyView.restoreAfterFailedUndo()).toBe(true)
    expect(appliedGlobalValue).toBe(0)

    expect(historyView.undo(localView)).toBe(true)
    expect(appliedGlobalValue).toBe(-1)

    localView.destroy()
  })
})
