import { invertedEffects } from '@codemirror/commands'
import {
  Compartment,
  Transaction,
  type Extension,
  type StateEffect,
} from '@codemirror/state'
import {
  type SketchSolveCodeSelectionRange,
  updateSceneGraphFromDelta,
  updateSketchSceneGraphEffect,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { sketchCheckpointHistoryEffect } from '@src/editor/plugins/sketchCheckpoints'
import { EditorView } from 'codemirror'

export const sketchSceneGraphCompartment = new Compartment()

/**
 * Apply this effect while undoing as well.
 */
function sketchGraphExtension(
  onSelectionChange?: (ranges: SketchSolveCodeSelectionRange[]) => void
): Extension {
  const sketchSceneGraphListener = EditorView.updateListener.of((vu) => {
    for (const tr of vu.transactions) {
      const effect = tr.effects.find((e) => e.is(updateSketchSceneGraphEffect))
      if (!effect) {
        continue
      }
      updateSceneGraphFromDelta(effect.value)
    }
  })
  const sketchSelectionListener = EditorView.updateListener.of((vu) => {
    if (
      onSelectionChange &&
      vu.transactions.some((tr) => tr.isUserEvent('select'))
    ) {
      onSelectionChange(
        vu.state.selection.ranges.map(({ from, to }) => ({ from, to }))
      )
    }
  })
  const undoableExecution = invertedEffects.of((tr) => {
    if (tr.effects.some((e) => e.is(sketchCheckpointHistoryEffect))) {
      return []
    }

    const found: StateEffect<unknown>[] = []
    for (const e of tr.effects) {
      if (e.is(updateSketchSceneGraphEffect)) {
        found.push(updateSketchSceneGraphEffect.of(e.value))
      }
    }
    return found
  })

  return [sketchSceneGraphListener, sketchSelectionListener, undoableExecution]
}

export function toggleSketchExtension(
  ev: EditorView,
  active: boolean,
  onSelectionChange?: (ranges: SketchSolveCodeSelectionRange[]) => void
) {
  ev.dispatch({
    effects: sketchSceneGraphCompartment.reconfigure(
      active ? sketchGraphExtension(onSelectionChange) : []
    ),
    annotations: Transaction.addToHistory.of(false),
  })
}
