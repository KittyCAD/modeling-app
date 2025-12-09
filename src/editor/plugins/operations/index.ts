import type { Extension, Range } from '@codemirror/state'
import { StateEffect, StateField, Annotation } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'

/** Transaction annotation to identify operation list updates */
export const operationsAnnotation = Annotation.define<boolean>()

/** Effect used to replace the current operations list in state */
export const setOperationsEffect = StateEffect.define<Operation[] | null>()

/** StateField to hold the current operations list reference on the EditorState */
export const operationsStateField = StateField.define<Operation[]>({
  create() {
    return []
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setOperationsEffect)) {
        return e.value ?? []
      }
    }
    return value
  },
})

/** Decorations field that stores ranges annotated with operations metadata */
export const operationDecorationsField = StateField.define<
  ReturnType<typeof Decoration.set>
>({
  create() {
    return Decoration.none
  },
  update(decorations, tr) {
    // Recompute all decorations when the artifact graph effect is applied
    for (const e of tr.effects) {
      if (e.is(setOperationsEffect)) {
        const operationsList = e.value ?? []
        return buildOperationDecorations(operationsList, tr.state)
      }
    }
    // Map existing decorations through document changes
    if (tr.docChanged) {
      return decorations.map(tr.changes)
    }
    return decorations
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * Given an ArtifactGraph, apply decorations to the corresponding code ranges with
 * each artifact's metadata.
 */
function buildOperationDecorations(
  operations: Operation[],
  state: EditorView['state']
) {
  const widgets: Range<Decoration>[] = []
  const docLen = state.doc.length

  for (const op of operations) {
    if (op.type === 'GroupEnd') continue
    const sr = op.sourceRange
    const from = Math.max(0, Math.min(sr[0], docLen))
    const to = Math.max(0, Math.min(sr[1], docLen))
    if (to <= from) continue
    widgets.push(
      Decoration.mark({
        class: 'cm-operation-range',
        attributes: {
          'data-operation-type': op.type,
          'data-operation-json': JSON.stringify(op),
        },
        inclusive: false,
      }).range(from, to)
    )
  }

  return Decoration.set(widgets, true)
}

export function operationsExtension(): Extension {
  return [operationsStateField, operationDecorationsField]
}
