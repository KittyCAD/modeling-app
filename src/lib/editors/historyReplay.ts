import { invertedEffects } from '@codemirror/commands'
import { StateEffect, Transaction } from '@codemirror/state'
import { documentChanges } from '@src/lib/editors/changes'

/** A committed preview already has its final text in the document. Its history entry must also work after the preview's native owner closes. */
export const committedDocumentPreview = StateEffect.define<{
  before: string
  after: string
}>()
export const previewHistory = invertedEffects.of((transaction) =>
  transaction.effects.flatMap((effect) =>
    effect.is(committedDocumentPreview)
      ? [
          committedDocumentPreview.of({
            before: effect.value.after,
            after: effect.value.before,
          }),
        ]
      : []
  )
)

/** Turn checkpoint-only undo/redo into an ordinary document change before notifying any editing surface. */
export function replayDocumentPreview(
  transaction: Transaction
): readonly Transaction[] {
  if (!transaction.isUserEvent('undo') && !transaction.isUserEvent('redo'))
    return [transaction]
  const preview = transaction.effects.find((effect) =>
    effect.is(committedDocumentPreview)
  )
  if (!preview || transaction.newDoc.toString() === preview.value.after)
    return [transaction]
  const changes = documentChanges(transaction.newDoc, preview.value.after)
  // Let CodeMirror finish its undo/redo before applying the preview text. A
  // separate non-history transaction maps both remaining history branches;
  // adding these changes to the undo transaction would leave them unmapped.
  return [
    transaction,
    transaction.state.update({
      changes,
      selection: transaction.newSelection.map(changes),
      annotations: Transaction.addToHistory.of(false),
      filter: false,
    }),
  ]
}
