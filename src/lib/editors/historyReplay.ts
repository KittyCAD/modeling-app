import { invertedEffects } from '@codemirror/commands'
import { StateEffect, type Transaction } from '@codemirror/state'
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
export function replayDocumentPreview(transaction: Transaction): Transaction {
  if (!transaction.isUserEvent('undo') && !transaction.isUserEvent('redo'))
    return transaction
  const preview = transaction.effects.find((effect) =>
    effect.is(committedDocumentPreview)
  )
  if (!preview || transaction.newDoc.toString() === preview.value.after)
    return transaction
  const changes = documentChanges(transaction.newDoc, preview.value.after)
  // Keep the original history transaction as the first spec, including its
  // CodeMirror history annotations. The sequential spec adds the preview's text
  // and maps its selection; rebuilding only the public event annotations loses redo.
  return transaction.startState.update(transaction, {
    changes,
    selection: transaction.newSelection.map(changes),
    sequential: true,
    filter: false,
  })
}
