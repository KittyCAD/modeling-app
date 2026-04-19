import { invertedEffects } from '@codemirror/commands'
import {
  Compartment,
  Transaction,
  type Extension,
  type StateEffect,
} from '@codemirror/state'
import {
  updateSceneGraphFromDelta,
  updateSketchSceneGraphEffect,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { sketchCheckpointHistoryEffect } from '@src/editor/plugins/sketchCheckpoints'
import { EditorView } from 'codemirror'

export const sketchSceneGraphCompartment = new Compartment()

/**
 * Apply this effect while undoing as well.
 */
function sketchGraphExtension(): Extension {
  const sketchSceneGraphListener = EditorView.updateListener.of((vu) => {
    for (const tr of vu.transactions) {
      const effect = tr.effects.find((e) => e.is(updateSketchSceneGraphEffect))
      if (!effect) {
        continue
      }
      updateSceneGraphFromDelta(effect.value)
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

  return [sketchSceneGraphListener, undoableExecution]
}

export function toggleSketchExtension(ev: EditorView, active: boolean) {
  ev.dispatch({
    effects: sketchSceneGraphCompartment.reconfigure(
      active ? sketchGraphExtension() : []
    ),
    annotations: Transaction.addToHistory.of(false),
  })
}
