import {
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { isolateHistory } from '@codemirror/commands'
import { batch, computed, type ReadonlySignal } from '@preact/signals-core'
import type {
  CodeEditorExtension,
  EditorViewHost,
} from '@src/lib/editors/registry/contract'
import { editorMatchContext, matchesEditor } from '@src/lib/editors/matching'

/** Each Code surface owns its DOM and selection; only text changes enter document history. */
export function createCodeSurface(
  host: EditorViewHost,
  contributions: ReadonlySignal<readonly CodeEditorExtension[]>
) {
  const { editor } = host
  const compartment = new Compartment()
  let sending = false
  let updating = false
  let closed = false
  const view = new EditorView({
    state: EditorState.create({
      doc: editor.state.doc,
      extensions: compartment.of([]),
    }),
    dispatchTransactions: (transactions) => {
      updating = true
      try {
        batch(() => {
          for (const transaction of transactions) {
            if (!transaction.docChanged) continue
            sending = true
            try {
              // History captures the editing surface's selection, not a different pane's cursor.
              editor.dispatch({
                selection: transaction.startState.selection,
                annotations: Transaction.addToHistory.of(false),
              })
              const isolation = transaction.annotation(isolateHistory)
              editor.dispatch({
                changes: transaction.changes,
                selection: transaction.state.selection,
                annotations: [
                  Transaction.addToHistory.of(
                    transaction.annotation(Transaction.addToHistory) ?? true
                  ),
                  Transaction.userEvent.of(
                    transaction.annotation(Transaction.userEvent) ?? 'input'
                  ),
                  Transaction.time.of(
                    transaction.annotation(Transaction.time) ?? Date.now()
                  ),
                  ...(isolation ? [isolateHistory.of(isolation)] : []),
                ],
              })
            } finally {
              sending = false
            }
          }
          view.update(transactions)
        })
      } finally {
        updating = false
      }
    },
  })
  host.onDispose(() => {
    closed = true
    view.destroy()
  })
  view.dom.dataset.editorCode = ''
  host.onDispose(
    editor.subscribe((transaction) => {
      if (sending || !transaction.docChanged) return
      view.update([
        view.state.update({
          changes: transaction.changes,
          filter: false,
          annotations: Transaction.userEvent.of('sync'),
        }),
      ])
    })
  )
  const instances = new WeakMap<CodeEditorExtension, Extension>()
  const matching = computed(() =>
    contributions.value
      .filter((contribution) =>
        matchesEditor(contribution.matches, editorMatchContext(editor))
      )
      .map((contribution) => {
        let extension = instances.get(contribution)
        if (!extension) {
          extension =
            typeof contribution.extensions === 'function'
              ? contribution.extensions({ ...host, view })
              : contribution.extensions
          instances.set(contribution, extension)
        }
        return extension
      })
  )
  let current: readonly Extension[] = []
  const apply = () => {
    if (closed) return
    const next = matching.peek()
    if (
      next.length === current.length &&
      next.every((extension, index) => extension === current[index])
    )
      return
    view.dispatch({ effects: compartment.reconfigure(next) })
    current = next
  }
  let queued = false
  host.onDispose(
    matching.subscribe(() => {
      if (!updating) {
        apply()
        return
      }
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        apply()
      })
    })
  )
  return view
}
