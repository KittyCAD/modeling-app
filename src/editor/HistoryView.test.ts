import { invertedEffects, isolateHistory } from '@codemirror/commands'
import { Annotation, StateEffect, Transaction } from '@codemirror/state'
import { EditorView } from 'codemirror'
import { describe, expect, it } from 'vitest'

import { HistoryView, localHistoryTarget } from '@src/editor/HistoryView'
import { createHistoryExtension } from '@src/editor/historyConfig'

type TestHistoryAction = {
  kind: 'manual' | 'zookeeper'
  label: string
}

type TestGlobalEffect = {
  before: string
  after: string
}

type HistoryTestHarnessOptions = {
  initialDoc?: string
  onApplyGlobalEffect?: (effect: TestGlobalEffect) => void
}

function createHistoryTestHarness({
  initialDoc = '',
  onApplyGlobalEffect,
}: HistoryTestHarnessOptions = {}) {
  const globalEffect = StateEffect.define<TestGlobalEffect>()
  const initialGlobalEffect = Annotation.define<boolean>()
  const historyView = new HistoryView([
    invertedEffects.of((transaction) =>
      transaction.effects
        .filter((effect) => effect.is(globalEffect))
        .map((effect) =>
          globalEffect.of({
            before: effect.value.after,
            after: effect.value.before,
          })
        )
    ),
    EditorView.updateListener.of((update) => {
      if (!onApplyGlobalEffect) {
        return
      }

      for (const transaction of update.transactions) {
        if (transaction.annotation(initialGlobalEffect)) {
          continue
        }
        for (const effect of transaction.effects) {
          if (effect.is(globalEffect)) {
            onApplyGlobalEffect(effect.value)
          }
        }
      }
    }),
  ])
  const localView = new EditorView({
    doc: initialDoc,
    extensions: [createHistoryExtension(), localHistoryTarget.of([])],
  })
  historyView.registerLocalHistoryTarget(localView)

  const applyAction = (action: TestHistoryAction) => {
    const before = localView.state.doc.toString()
    const after = `${before}|${action.label}`
    if (action.kind === 'manual') {
      localView.dispatch({
        changes: { from: before.length, insert: `|${action.label}` },
        annotations: [
          Transaction.addToHistory.of(true),
          isolateHistory.of('full'),
        ],
      })
      return after
    }

    const historyMarker = historyView.recordGlobalRedoEventForLocalTransaction({
      effects: globalEffect.of({ before, after }),
      annotations: [initialGlobalEffect.of(true)],
    })
    localView.dispatch({
      changes: { from: 0, to: before.length, insert: after },
      effects: [historyMarker],
      annotations: [
        Transaction.addToHistory.of(true),
        isolateHistory.of('full'),
      ],
    })
    return after
  }

  const destroy = () => {
    historyView.destroy()
    localView.destroy()
  }

  return {
    historyView,
    localView,
    applyAction,
    destroy,
    globalEffect,
    initialGlobalEffect,
  }
}

function expectFullUndoRedoCycle(actions: TestHistoryAction[], cycles = 1) {
  const { historyView, localView, applyAction, destroy } =
    createHistoryTestHarness()
  const states = ['']
  for (const action of actions) states.push(applyAction(action))

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (let stateIndex = states.length - 2; stateIndex >= 0; stateIndex -= 1) {
      expect(historyView.undo(localView)).toBe(true)
      expect(localView.state.doc.toString()).toBe(states[stateIndex])
    }
    expect(historyView.undo(localView)).toBe(false)

    for (let stateIndex = 1; stateIndex < states.length; stateIndex += 1) {
      expect(historyView.redo(localView)).toBe(true)
      expect(localView.state.doc.toString()).toBe(states[stateIndex])
    }
    expect(historyView.redo(localView)).toBe(false)
  }

  destroy()
}

describe('HistoryView', () => {
  it.each([
    {
      name: 'multiple manual edits only',
      actions: [
        { kind: 'manual', label: 'm1' },
        { kind: 'manual', label: 'm2' },
        { kind: 'manual', label: 'm3' },
      ],
    },
    {
      name: 'multiple Zookeeper edits only',
      actions: [
        { kind: 'zookeeper', label: 'z1' },
        { kind: 'zookeeper', label: 'z2' },
        { kind: 'zookeeper', label: 'z3' },
      ],
    },
    {
      name: 'Zookeeper edit followed by manual edits',
      actions: [
        { kind: 'zookeeper', label: 'z1' },
        { kind: 'manual', label: 'm1' },
        { kind: 'manual', label: 'm2' },
      ],
    },
    {
      name: 'manual edit followed by Zookeeper and manual edits',
      actions: [
        { kind: 'manual', label: 'm1' },
        { kind: 'zookeeper', label: 'z1' },
        { kind: 'manual', label: 'm2' },
      ],
    },
    {
      name: 'manual edits followed by multiple Zookeeper edits',
      actions: [
        { kind: 'manual', label: 'm1' },
        { kind: 'manual', label: 'm2' },
        { kind: 'zookeeper', label: 'z1' },
        { kind: 'zookeeper', label: 'z2' },
      ],
    },
    {
      name: 'alternating manual and Zookeeper edits',
      actions: [
        { kind: 'zookeeper', label: 'z1' },
        { kind: 'manual', label: 'm1' },
        { kind: 'zookeeper', label: 'z2' },
        { kind: 'manual', label: 'm2' },
        { kind: 'zookeeper', label: 'z3' },
      ],
    },
    {
      name: 'bulk mixed sequence',
      actions: [
        { kind: 'manual', label: 'm1' },
        { kind: 'zookeeper', label: 'z1' },
        { kind: 'zookeeper', label: 'z2' },
        { kind: 'manual', label: 'm2' },
        { kind: 'manual', label: 'm3' },
        { kind: 'zookeeper', label: 'z3' },
        { kind: 'manual', label: 'm4' },
      ],
    },
  ] as Array<{ name: string; actions: TestHistoryAction[] }>)(
    'preserves action order for $name',
    ({ actions }) => {
      expectFullUndoRedoCycle(actions, 3)
    }
  )

  it('clears the redo branch after a new manual edit', () => {
    const { historyView, localView, applyAction, destroy } =
      createHistoryTestHarness()
    applyAction({ kind: 'zookeeper', label: 'z1' })
    applyAction({ kind: 'manual', label: 'm1' })
    applyAction({ kind: 'zookeeper', label: 'z2' })

    expect(historyView.undo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('|z1|m1')
    expect(historyView.undo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('|z1')
    expect(historyView.redoDepth).toBeGreaterThan(0)

    applyAction({ kind: 'manual', label: 'new-manual' })
    expect(localView.state.doc.toString()).toBe('|z1|new-manual')
    expect(historyView.redoDepth).toBe(0)
    expect(historyView.redo(localView)).toBe(false)

    expect(historyView.undo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('|z1')
    expect(historyView.undo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('')
    destroy()
  })

  it('clears the redo branch after a new Zookeeper edit', () => {
    const { historyView, localView, applyAction, destroy } =
      createHistoryTestHarness()
    applyAction({ kind: 'manual', label: 'm1' })
    applyAction({ kind: 'zookeeper', label: 'z1' })
    applyAction({ kind: 'manual', label: 'm2' })

    expect(historyView.undo(localView)).toBe(true)
    expect(historyView.undo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('|m1')
    expect(historyView.redoDepth).toBeGreaterThan(0)

    applyAction({ kind: 'zookeeper', label: 'new-zookeeper' })
    expect(localView.state.doc.toString()).toBe('|m1|new-zookeeper')
    expect(historyView.redoDepth).toBe(0)
    expect(historyView.redo(localView)).toBe(false)

    expect(historyView.undo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('|m1')
    expect(historyView.undo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('')
    destroy()
  })

  it('redoes a global edit before later manual edits', () => {
    const historyEffect = StateEffect.define<number>()
    const ignoreEffect = Annotation.define<boolean>()
    const appliedGlobalValues: number[] = []

    let localView: EditorView
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
            if (effect.is(historyEffect)) {
              appliedGlobalValues.push(effect.value)
              const code = effect.value < 0 ? 'pre-zk' : 'zk'
              localView.dispatch({
                changes: {
                  from: 0,
                  to: localView.state.doc.length,
                  insert: code,
                },
                annotations: [Transaction.addToHistory.of(false)],
              })
            }
          }
        }
      }),
    ])
    localView = new EditorView({
      doc: 'zk',
      extensions: [createHistoryExtension(), localHistoryTarget.of([])],
    })
    historyView.registerLocalHistoryTarget(localView)

    historyView.dispatch({
      effects: historyEffect.of(1),
      annotations: [ignoreEffect.of(true)],
    })
    localView.dispatch({
      changes: { from: 2, insert: ' manual-1' },
      annotations: [
        Transaction.addToHistory.of(true),
        isolateHistory.of('full'),
      ],
    })
    localView.dispatch({
      changes: { from: localView.state.doc.length, insert: ' manual-2' },
      annotations: [
        Transaction.addToHistory.of(true),
        isolateHistory.of('full'),
      ],
    })

    expect(historyView.undo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('zk manual-1')
    expect(historyView.undo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('zk')
    expect(historyView.undo(localView)).toBe(true)
    expect(appliedGlobalValues).toEqual([-1])
    expect(localView.state.doc.toString()).toBe('pre-zk')

    expect(historyView.redo(localView)).toBe(true)
    expect(appliedGlobalValues).toEqual([-1, 1])
    expect(localView.state.doc.toString()).toBe('zk')
    expect(historyView.redo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('zk manual-1')
    expect(historyView.redo(localView)).toBe(true)
    expect(localView.state.doc.toString()).toBe('zk manual-1 manual-2')

    historyView.destroy()
    localView.destroy()
  })

  it('locks mixed history and restores both pointers after a failed global undo', () => {
    let appliedGlobalValue = 0

    const {
      historyView,
      localView,
      globalEffect,
      initialGlobalEffect,
      destroy,
    } = createHistoryTestHarness({
      onApplyGlobalEffect: (effect) => {
        appliedGlobalValue += effect.after === 'global' ? 1 : -1
      },
    })

    historyView.dispatch({
      effects: globalEffect.of({ before: '', after: 'global' }),
      annotations: [initialGlobalEffect.of(true)],
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

    destroy()
  })
})
