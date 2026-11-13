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
import { isErr, trap } from '@src/lib/trap'
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
  const failed = new Set<CodeEditorExtension>()
  host.onDispose(() => {
    failed.clear()
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
    for (const definition of failed) {
      if (!definitions.includes(definition)) failed.delete(definition)
    }
    const next = definitions.flatMap<Extension>((definition) => {
      if (failed.has(definition)) return []
      const existing = instances.get(definition)
      if (existing) return [existing.extension]
      const resources = createEditorCleanup()
      let extension: Extension | Error
      try {
        const provided = definition.extensions
        extension =
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
      } catch (cause) {
        extension = isErr(cause) ? cause : new Error(String(cause))
      }
      if (isErr(extension)) {
        resources.dispose()
        // A failed factory can retry after withdrawal or losing its match, not on every edit.
        failed.add(definition)
        trap(extension)
        return []
      }
      instances.set(definition, { extension, resources })
      return [extension]
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
