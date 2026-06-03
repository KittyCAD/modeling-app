import { invertedEffects } from '@codemirror/commands'
import {
  Compartment,
  type Extension,
  type StateEffect,
  Transaction,
} from '@codemirror/state'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import { sketchCheckpointHistoryEffect } from '@src/editor/plugins/sketchCheckpoints'
import { selectionDispatchedBySketchSolveAnnotation } from '@src/editor/plugins/sketchSelection'
import { topLevelRange } from '@src/lang/util'
import {
  updateSceneGraphFromDelta,
  updateSketchSceneGraphEffect,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { EditorView } from 'codemirror'

export const sketchSceneGraphCompartment = new Compartment()

/**
 * Apply this effect while undoing as well.
 */
function sketchGraphExtension(
  onSelectionChange?: (ranges: SourceRange[]) => void
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
      vu.selectionSet &&
      // ignore selection changes that are part of a document edit, such as undo/redo
      !vu.docChanged &&
      // ignore selections dispatched by sketch solve itself to avoid a second refresh
      !vu.transactions.some((tr) =>
        tr.annotation(selectionDispatchedBySketchSolveAnnotation)
      )
    ) {
      onSelectionChange(
        vu.state.selection.ranges.map(({ from, to }) => topLevelRange(from, to))
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
  onSelectionChange?: (ranges: SourceRange[]) => void
) {
  ev.dispatch({
    effects: sketchSceneGraphCompartment.reconfigure(
      active ? sketchGraphExtension(onSelectionChange) : []
    ),
    annotations: Transaction.addToHistory.of(false),
  })
}
