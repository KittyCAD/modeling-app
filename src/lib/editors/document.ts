import type { Transaction } from '@codemirror/state'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { history, undo, redo } from '@codemirror/commands'
import { batch, signal } from '@preact/signals-core'
import type { Editor } from '@src/lib/editors/registry/contract'

/** Document transactions and undo history exist without a mounted CodeMirror surface. */
export function createEditorDocument(contents: string) {
  const text = signal(contents)
  const lifetime = new AbortController()
  let state = EditorState.create({ doc: contents, extensions: [history()] })
  const listeners = new Set<(transaction: Transaction) => void>()
  const apply = (transaction: Transaction) => {
    if (lifetime.signal.aborted) return
    state = transaction.state
    batch(() => {
      if (transaction.docChanged) text.value = state.doc.toString()
      for (const listener of [...listeners]) listener(transaction)
    })
  }
  const document: Pick<
    Editor,
    'state' | 'contents' | 'signal' | 'dispatch' | 'subscribe' | 'undo' | 'redo'
  > = {
    get state() {
      return state
    },
    contents: text,
    signal: lifetime.signal,
    dispatch: (...specs: TransactionSpec[]) => {
      if (!lifetime.signal.aborted) apply(state.update(...specs))
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    undo: () =>
      !lifetime.signal.aborted &&
      undo({
        get state() {
          return state
        },
        dispatch: apply,
      }),
    redo: () =>
      !lifetime.signal.aborted &&
      redo({
        get state() {
          return state
        },
        dispatch: apply,
      }),
  }
  return {
    document,
    dispose: () => {
      lifetime.abort()
      listeners.clear()
    },
  }
}
