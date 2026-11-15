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

/** History retains inert effects and a view identity, never an EditorView or a native context. */
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
  const unsubscribe = editor.subscribe((transaction) => {
    if (closed || sending || !view) return
    const effects = transaction.effects.flatMap((effect) =>
      effect.is(ownedHistory) && effect.value.owner === owner
        ? effect.value.forward
        : []
    )
    if (!transaction.docChanged && !effects.length) return
    if (effects.length) beforePublish(transaction.state.doc.toString())
    else if (transaction.docChanged) externalChange()
    view.update([
      view.state.update({
        changes: transaction.changes,
        effects,
        annotations: [
          Transaction.addToHistory.of(false),
          Transaction.userEvent.of(
            transaction.annotation(Transaction.userEvent) ?? 'sync'
          ),
        ],
      }),
    ])
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
            beforePublish(transaction.state.doc.toString())
            sending = true
            try {
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
