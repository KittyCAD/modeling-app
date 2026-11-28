import { committedInteractiveEdit } from '@src/lib/editors/historyReplay'
import { invertedEffects, isolateHistory } from '@codemirror/commands'
import {
  EditorState,
  StateEffect,
  Transaction,
  type Extension,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Editor } from '@src/lib/editors/registry/contract'

/** Associate checkpoint effects with their owner so undo can update text after that view closes. */
interface OwnedHistory {
  owner: symbol
  forward: readonly StateEffect<unknown>[]
  backward: readonly StateEffect<unknown>[]
}
const ownedHistory = StateEffect.define<OwnedHistory>()
const configured = new WeakSet<Editor>()

/**
 * Share document text and undo history while keeping the legacy manager's local
 * selection and checkpoint listeners.
 *
 * recordRuntimeSource synchronously updates the native runtime's source snapshot.
 * When text changes locally, it runs before editor.dispatch publishes that text.
 * When undo/redo changes text, it runs before forwarding this owner's checkpoint
 * effects to its view. Checkpoint-only updates reuse the already recorded source.
 * This ordering lets the runtime recognize its own edits; otherwise automatic
 * execution can mistake them for edits from another view and close the editing session.
 *
 * onDocumentChangedElsewhere reports text changes outside this adapter: edits in
 * Code, another Modeling view, or history replay without this adapter's checkpoint
 * effects. The host uses it to invalidate native editing state that no longer
 * matches the shared document. This adapter's own edits and checkpoint replays
 * are handled separately.
 */
export function createModelingDocumentAdapter(
  editor: Editor,
  recordRuntimeSource: (text: string) => void,
  onDocumentChangedElsewhere: () => void
) {
  const owner = Symbol('modeling history')
  let view: EditorView | undefined
  let sending = false
  let closed = false
  if (!configured.has(editor)) {
    configured.add(editor)
    editor.dispatch({
      effects: StateEffect.appendConfig.of(
        invertedEffects.of((transaction) =>
          transaction.effects.flatMap((effect) =>
            effect.is(ownedHistory)
              ? [
                  ownedHistory.of({
                    owner: effect.value.owner,
                    forward: effect.value.backward,
                    backward: effect.value.forward,
                  }),
                ]
              : []
          )
        )
      ),
      annotations: Transaction.addToHistory.of(false),
    })
  }
  const unsubscribe = editor.subscribe((update) => {
    if (closed || sending || !view) return
    const owned = (transaction: Transaction) =>
      transaction.effects.flatMap((effect) =>
        effect.is(ownedHistory) && effect.value.owner === owner
          ? effect.value.forward
          : []
      )
    const hasEffects = update.transactions.some(
      (transaction) => owned(transaction).length > 0
    )
    if (!update.docChanged && !hasEffects) return
    // Undo/redo can repair text in a separate transaction. Use the full update
    // to record that text before replaying checkpoints; checkpoint-only updates
    // already have matching runtime source.
    if (hasEffects) {
      if (update.docChanged) recordRuntimeSource(update.state.doc.toString())
    } else if (update.docChanged) onDocumentChangedElsewhere()
    let state = view.state
    const transactions = update.transactions.map((transaction) => {
      const next = state.update({
        changes: transaction.changes,
        effects: owned(transaction),
        annotations: [
          Transaction.addToHistory.of(false),
          Transaction.userEvent.of(
            transaction.annotation(Transaction.userEvent) ?? 'sync'
          ),
        ],
      })
      state = next.state
      return next
    })
    view.update(transactions)
  })

  const suspend = () => {
    closed = true
    unsubscribe()
  }
  return {
    createView: (
      extensions: Extension,
      acceptsHistoryEffect: (effect: StateEffect<unknown>) => boolean,
      committedEditText?: (
        effect: StateEffect<unknown>,
        transaction: Transaction
      ) => { before: string; after: string } | undefined
    ) => {
      view = new EditorView({
        state: EditorState.create({ doc: editor.state.doc, extensions }),
        dispatchTransactions: (transactions, target) => {
          if (
            closed ||
            editor.signal.aborted ||
            (editor.readOnly.peek() && transactions.some((tr) => tr.docChanged))
          )
            return
          for (const transaction of transactions) {
            const forward = transaction.effects.filter(acceptsHistoryEffect)
            const backward = transaction.startState
              .facet(invertedEffects)
              .flatMap((invert) => invert(transaction))
              .filter(acceptsHistoryEffect)
            if (!transaction.docChanged && !forward.length) continue
            sending = true
            try {
              // Match Code surfaces: history records the editing view's cursor,
              // while ordinary selection moves remain local to that view.
              if (!editor.state.selection.eq(transaction.startState.selection))
                editor.dispatch({
                  selection: transaction.startState.selection,
                  annotations: Transaction.addToHistory.of(false),
                })
              // Record changed source before publication can trigger execution.
              // Effect-only commits publish their checkpoints without re-recording
              // the text already recorded during the interactive edit.
              if (transaction.docChanged)
                recordRuntimeSource(transaction.state.doc.toString())
              const isolation = transaction.annotation(isolateHistory)
              editor.dispatch({
                changes: transaction.changes,
                selection: transaction.state.selection,
                effects: [
                  ...(forward.length || backward.length
                    ? [ownedHistory.of({ owner, forward, backward })]
                    : []),
                  ...transaction.effects.flatMap((effect) => {
                    const text = committedEditText?.(effect, transaction)
                    return text ? [committedInteractiveEdit.of(text)] : []
                  }),
                ],
                annotations: [
                  Transaction.addToHistory.of(
                    transaction.annotation(Transaction.addToHistory) ?? true
                  ),
                  Transaction.userEvent.of(
                    transaction.annotation(Transaction.userEvent) ?? 'input'
                  ),
                  ...(isolation ? [isolateHistory.of(isolation)] : []),
                ],
              })
            } finally {
              sending = false
            }
          }
          target.update(transactions)
        },
      })
      return view
    },
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    get state() {
      return editor.state
    },
    suspend,
    dispose: () => {
      suspend()
      view?.destroy()
      view = undefined
    },
  }
}
export type ModelingDocumentAdapter = ReturnType<
  typeof createModelingDocumentAdapter
>
