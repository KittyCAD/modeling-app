import { createEditorCleanup } from '@src/lib/editors/lifecycle'
import {
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { isolateHistory } from '@codemirror/commands'
import {
  batch,
  computed,
  untracked,
  type ReadonlySignal,
} from '@preact/signals-core'
import type {
  CodeEditorExtension,
  EditorViewHost,
} from '@src/lib/editors/registry/contract'
import { editorMatchContext, matchesEditor } from '@src/lib/editors/matching'

/** Each Code surface owns its DOM and selection; only text changes enter document history. */
export function createCodeSurface(
  host: EditorViewHost,
  contributions: ReadonlySignal<readonly CodeEditorExtension[]>,
  run: <T>(callback: () => T) => T
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
  const instances = new Map<
    CodeEditorExtension,
    { extension: Extension; resources: ReturnType<typeof createEditorCleanup> }
  >()
  host.onDispose(() => {
    for (const instance of instances.values()) instance.resources.dispose()
    instances.clear()
  })
  const matching = computed(() =>
    contributions.value.filter((contribution) =>
      matchesEditor(contribution.matches, editorMatchContext(editor))
    )
  )
  let current: readonly Extension[] = []
  const apply = () => {
    if (closed) return
    const definitions = matching.peek()
    for (const [definition, instance] of instances) {
      if (!definitions.includes(definition)) {
        instances.delete(definition)
        instance.resources.dispose()
      }
    }
    const next = definitions.map((definition) => {
      const existing = instances.get(definition)
      if (existing) return existing.extension
      const resources = createEditorCleanup()
      try {
        const provided = definition.extensions
        const extension =
          typeof provided === 'function'
            ? run(() =>
                provided({
                  ...host,
                  view,
                  onDispose: (callback) =>
                    resources.onDispose(() => run(callback)),
                })
              )
            : provided
        instances.set(definition, { extension, resources })
        return extension
      } catch (cause) {
        resources.dispose()
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Mode initialization reports the failed factory after releasing its partial resources.
        throw cause
      }
    })
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
        untracked(apply)
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
