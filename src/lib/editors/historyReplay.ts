import { invertedEffects } from '@codemirror/commands'
import { StateEffect, Transaction } from '@codemirror/state'
import { documentChanges } from '@src/lib/editors/changes'

/**
 * Record the whole document's starting and final text for one interactive edit,
 * such as dragging a sketch point. During the gesture, the tool can update text
 * with addToHistory(false) so each movement does not become an undo step.
 * The final text may already be present when the tool commits this effect.
 *
 * These text snapshots let the document undo and redo the edit after the tool's
 * native session closes. The native checkpoint alone cannot do that.
 */
export const committedInteractiveEdit = StateEffect.define<{
  before: string
  after: string
}>()
/**
 * CodeMirror inverts text changes automatically. Custom effects need an
 * invertedEffects handler to be included in undo history, including commits
 * that change no text and would otherwise have no undo entry.
 *
 * Swap before and after so undo targets the starting text. When CodeMirror
 * records that undo for redo, it calls this handler again, swapping them back.
 */
export const interactiveEditHistory = invertedEffects.of((transaction) =>
  transaction.effects.flatMap((effect) =>
    effect.is(committedInteractiveEdit)
      ? [
          committedInteractiveEdit.of({
            before: effect.value.after,
            after: effect.value.before,
          }),
        ]
      : []
  )
)

/**
 * Restore the recorded text if CodeMirror replays the commit effect without
 * enough text changes to reach that result. A commit can have been effects-only
 * because the gesture had already applied its text changes outside history.
 *
 * Return CodeMirror's transaction followed by any text repair. createEditorDocument
 * applies them before publishing one EditorUpdate, so subscribers see the final text.
 */
export function replayInteractiveEdit(
  transaction: Transaction
): readonly Transaction[] {
  if (!transaction.isUserEvent('undo') && !transaction.isUserEvent('redo'))
    return [transaction]
  const committedEdit = transaction.effects.find((effect) =>
    effect.is(committedInteractiveEdit)
  )
  if (
    !committedEdit ||
    transaction.newDoc.toString() === committedEdit.value.after
  )
    return [transaction]
  const changes = documentChanges(transaction.newDoc, committedEdit.value.after)
  // CodeMirror's historyField handles its own undo/redo transactions by replacing
  // the undo/redo branches. That path skips the normal remapping of stored text
  // positions used for other document changes.
  //
  // Apply the repair afterward with addToHistory(false). CodeMirror then calls
  // HistoryState.addMapping to adjust both remaining branches for the restored
  // text, without adding an undo step. Folding the repair into the original
  // history transaction skips that mapping and can break earlier undo entries
  // when the text length changes.
  return [
    transaction,
    transaction.state.update({
      changes,
      // Keep the undo/redo cursor valid if the repair shortens the document.
      selection: transaction.newSelection.map(changes),
      annotations: Transaction.addToHistory.of(false),
      // Restore the recorded result without input filters rewriting the repair.
      filter: false,
    }),
  ]
}
