import { EditorView } from '@codemirror/view'
import type { EditorCapability } from '@src/contracts/buffers'
import { requestFocus } from '@src/lib/buffers/annotations'

/**
 * Give the editor the keyboard when a transaction asks for it.
 *
 * The request is made by whoever wrote the edit — a modelling operation that
 * left the cursor inside a new sketch block — and honoured here, because a view
 * is the only thing that can take focus and the buffer does not know whether one
 * exists. If none is mounted, the request is simply not carried out, which is the
 * right answer: there is nothing to focus.
 *
 * Deferred by a microtask. Focusing from inside an update listener runs while
 * CodeMirror is still finishing the update it is reporting, and the selection
 * that came with the transaction is what should be on screen when the caret
 * appears.
 */
export const focusRequestCapability: EditorCapability = {
  id: 'editor.focusRequest',
  order: 6,
  extension: () =>
    EditorView.updateListener.of((update) => {
      const asked = update.transactions.some(
        (transaction) => transaction.annotation(requestFocus) === true
      )
      if (!asked || update.view.hasFocus) return

      queueMicrotask(() => update.view.focus())
    }),
}
