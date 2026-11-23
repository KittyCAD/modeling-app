import { committedDocumentPreview } from '@src/lib/editors/historyReplay'
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

/** Share document/history while retaining the legacy manager's view-local selection and checkpoint listeners. */
export function createModelingDocumentAdapter(
  editor: Editor,
  beforePublish: (text: string) => void,
  externalChange: () => void
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
    if (hasEffects) beforePublish(update.state.doc.toString())
    else if (update.docChanged) externalChange()
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
      previewText?: (
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
              beforePublish(transaction.state.doc.toString())
              const isolation = transaction.annotation(isolateHistory)
              editor.dispatch({
                changes: transaction.changes,
                selection: transaction.state.selection,
                effects: [
                  ...(forward.length || backward.length
                    ? [ownedHistory.of({ owner, forward, backward })]
                    : []),
                  ...transaction.effects.flatMap((effect) => {
                    const text = previewText?.(effect, transaction)
                    return text ? [committedDocumentPreview.of(text)] : []
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
