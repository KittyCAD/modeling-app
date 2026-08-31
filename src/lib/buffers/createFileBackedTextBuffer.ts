import {
  Compartment,
  EditorState,
  type Extension,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { computed, signal } from '@preact/signals'
import type {
  BufferChange,
  BufferId,
  BufferReconcileOutcome,
  BufferSnapshot,
  BufferStructuralContext,
  EditorCapabilityResolver,
  FileBackedTextBuffer,
} from '@src/contracts/buffers'
import { hashString } from '@src/lib/hash'
import { minimalChange } from '@src/lib/buffers/minimalChange'
import { basename } from '@src/lib/paths'
import { bufferOrigin, originOf } from '@src/lib/buffers/annotations'

export interface CreateBufferOptions {
  id?: BufferId
  path: string | null
  contents: string
  languageId: string
  /** Contents already on disk. Defaults to `contents`, i.e. a clean buffer. */
  baseContent?: string
  readOnly?: boolean
  /** One resolver for the whole app, evaluated against this buffer's context. */
  capabilities: EditorCapabilityResolver
  /** Themes, kept separate from behavioural capabilities. */
  themes?: readonly Extension[]
}

let counter = 0

function nextBufferId(): BufferId {
  counter += 1
  // Identity only has to be unique within a session, and a UUID here would
  // pull in a dependency for no added guarantee.
  return `buffer-${counter}-${Math.random().toString(36).slice(2, 8)}`
}

/** A structural context key, for deciding whether a rebuild is warranted. */
function structuralKey(context: BufferStructuralContext): string {
  return [
    context.languageId,
    context.fileBacked ? 'file' : 'scratch',
    context.executing ? 'executing' : 'idle',
    context.readOnly ? 'readonly' : 'writable',
  ].join('|')
}

/**
 * An open document that owns its CodeMirror state.
 *
 * Two things make this work, and both are easy to get wrong:
 *
 * **One dispatch boundary.** A mounted view does not dispatch to itself; its
 * `dispatchTransactions` is routed here, and this function applies the
 * transactions to the buffer's state and then pushes them to the view. So typing,
 * a command, an LSP response, and reconciliation all take the same path, and the
 * buffer can version, record, and publish every one of them.
 *
 * **The document outlives the view.** State lives here, so unmounting a view is
 * not a document operation and undo still works with nothing on screen.
 *
 * Capabilities are applied through a single compartment, reconfigured only when
 * the *structural* context changes. Volatile values never touch it.
 */
export function createFileBackedTextBuffer(
  options: CreateBufferOptions
): FileBackedTextBuffer {
  const id = options.id ?? nextBufferId()
  const capabilityCompartment = new Compartment()

  const path = signal(options.path)
  const pathRevision = signal(0)
  const version = signal(0)
  const languageId = signal(options.languageId)
  const readOnly = signal(options.readOnly ?? false)
  const executing = signal(false)
  const baseContent = signal(options.baseContent ?? options.contents)
  const baseVersion = signal(0)
  const divergence = signal<string | null>(null)
  const hasView = signal(false)
  const disposed = signal(false)

  const listeners = new Set<(change: BufferChange) => void>()
  /** Disposers for the capability bindings currently applied. */
  let bindingDisposers: (() => void)[] = []

  const structuralContext = computed<BufferStructuralContext>(() => ({
    bufferId: id,
    path: path.value,
    languageId: languageId.value,
    fileBacked: path.value !== null,
    executing: executing.value,
    readOnly: readOnly.value,
  }))

  /**
   * Route a view's transactions through the buffer.
   *
   * `updateListener` would also see them, but only after the view had already
   * applied them — too late to be the single boundary, and it makes the view the
   * owner of the state.
   */
  const buildView = (parent: HTMLElement) =>
    new EditorView({
      state: stateSignal.peek(),
      parent,
      dispatchTransactions: (transactions) =>
        dispatchTransactions(transactions),
    })

  const initialState = EditorState.create({
    doc: options.contents,
    extensions: [
      capabilityCompartment.of(
        options.capabilities.resolve({
          bufferId: id,
          path: options.path,
          languageId: options.languageId,
          fileBacked: options.path !== null,
          executing: false,
          readOnly: options.readOnly ?? false,
        })
      ),
      ...(options.themes ?? []),
    ],
  })

  const stateSignal = signal(initialState)
  let view: EditorView | null = null
  let appliedStructuralKey = structuralKey(structuralContext.peek())

  const text = computed(() => stateSignal.value.doc.toString())
  const dirty = computed(() => text.value !== baseContent.value)

  function publish(transactions: readonly Transaction[]) {
    if (transactions.length === 0) return

    const docChanged = transactions.some(
      (transaction) => transaction.docChanged
    )
    /*
     * The last transaction speaks for the batch, and a batch that changed no
     * text was somebody asking for something rather than editing — a re-run
     * request, a focus request — so it reads as a command rather than a user
     * edit.
     */
    const origin = originOf(
      transactions.at(-1),
      docChanged ? 'user' : 'command'
    )

    const change: BufferChange = {
      bufferId: id,
      docChanged,
      version: version.peek(),
      pathRevision: pathRevision.peek(),
      origin: origin.role,
      ...(origin.author === undefined ? {} : { author: origin.author }),
      ...(origin.contributionId === undefined
        ? {}
        : { contributionId: origin.contributionId }),
      transactions,
    }

    for (const listener of listeners) {
      try {
        listener(change)
      } catch (error) {
        // One bad observer must not stop the others, or break the edit that
        // triggered them.
        console.error('buffer: change listener threw', error)
      }
    }
  }

  function dispatchTransactions(transactions: readonly Transaction[]) {
    if (transactions.length === 0) return
    /*
     * A disposed buffer accepts nothing.
     *
     * Every mutation funnels through here, so this is the whole of "inert".
     * Before this, a disposed buffer went on applying transactions with its
     * capability bindings already released — so an undo run against a closed
     * buffer moved the document and wrote nothing, leaving the file holding
     * content the document no longer had and nobody to notice.
     */
    if (disposed.peek()) return

    let docChanged = false
    for (const transaction of transactions) {
      stateSignal.value = transaction.state
      if (transaction.docChanged) docChanged = true
    }
    if (docChanged) version.value += 1

    // Push to the view after the buffer has accepted them, so the view is a
    // consequence of the buffer's state rather than the source of it.
    view?.update(transactions as Transaction[])

    publish(transactions)
  }

  function dispatch(...specs: TransactionSpec[]) {
    if (specs.length === 0) return

    // Built sequentially, so each spec applies to the state the previous one
    // produced rather than all of them racing from the same base.
    const transactions: Transaction[] = []
    let current = stateSignal.peek()
    for (const spec of specs) {
      const transaction = current.update(spec)
      transactions.push(transaction)
      current = transaction.state
    }

    dispatchTransactions(transactions)
  }

  function releaseBindings() {
    for (const dispose of bindingDisposers) {
      try {
        dispose()
      } catch (error) {
        console.error('buffer: capability binding disposer threw', error)
      }
    }
    bindingDisposers = []
  }

  /** Attach the live bindings for the current context. */
  function applyBindings(buffer: FileBackedTextBuffer) {
    releaseBindings()
    const context = structuralContext.peek()
    for (const capability of options.capabilities.bindings(context)) {
      try {
        const dispose = capability.bind?.(buffer, context)
        if (dispose) bindingDisposers.push(dispose)
      } catch (error) {
        console.error(
          `buffer: capability "${capability.id}" failed to bind`,
          error
        )
      }
    }
  }

  /** Rebuild the capability bundle. Only for structural changes. */
  function reconfigure() {
    const context = structuralContext.peek()
    const key = structuralKey(context)
    if (key === appliedStructuralKey) return

    appliedStructuralKey = key
    dispatch({
      effects: capabilityCompartment.reconfigure(
        options.capabilities.resolve(context)
      ),
      annotations: bufferOrigin.of('capability'),
    })
    // Bindings are structural too: a buffer that becomes read-only should lose
    // its autosave rather than keep writing.
    applyBindings(buffer)
  }

  const buffer: FileBackedTextBuffer = {
    id,
    state: computed(() => stateSignal.value),
    text,
    path: computed(() => path.value),
    name: computed(() => {
      const current = path.value
      return current === null ? 'Untitled' : basename(current)
    }),
    pathRevision: computed(() => pathRevision.value),
    version: computed(() => version.value),
    languageId: computed(() => languageId.value),
    fileBacked: computed(() => path.value !== null),
    dirty,
    baseContent: computed(() => baseContent.value),
    baseVersion: computed(() => baseVersion.value),
    divergence: computed(() => divergence.value),
    readOnly: computed(() => readOnly.value),
    executing: computed(() => executing.value),
    hasView: computed(() => hasView.value),
    structuralContext,
    disposed: computed(() => disposed.value),

    dispatch,
    dispatchTransactions,

    runCommand(command) {
      // A command against a disposed buffer did not run, and says so: `false` is
      // what a `StateCommand` returns when it declines, and a caller walking a
      // history stack needs to be able to tell.
      if (disposed.peek()) return false

      // The same target shape CodeMirror's own StateCommands expect, so `undo`
      // and friends work unchanged with no view mounted.
      return command({
        get state() {
          return stateSignal.peek()
        },
        dispatch: (transaction) => dispatchTransactions([transaction]),
      })
    },

    attachView(parent) {
      // Replacing a view is not a document operation, so an existing one is
      // simply torn down first.
      view?.destroy()
      view = buildView(parent)
      hasView.value = true

      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        view?.destroy()
        view = null
        hasView.value = false
      }
    },

    setPath(next) {
      if (next === path.peek()) return
      // Identity is untouched: a rename moves the buffer, it does not replace it.
      path.value = next
      pathRevision.value += 1
      reconfigure()
    },

    setExecuting(next) {
      if (next === executing.peek()) return
      executing.value = next
      reconfigure()
    },

    setReadOnly(next) {
      if (next === readOnly.peek()) return
      readOnly.value = next
      reconfigure()
    },

    markSaved({ version: savedVersion, content }) {
      // A save that started before a newer edit must not report the buffer
      // clean, so it is rejected rather than applied late.
      if (savedVersion !== version.peek()) return false

      baseContent.value = content
      baseVersion.value = savedVersion
      divergence.value = null
      return true
    },

    reconcile(incoming): BufferReconcileOutcome {
      if (incoming === text.peek()) {
        // Already identical: adopt as base so a clean buffer stops looking dirty.
        baseContent.value = incoming
        baseVersion.value = version.peek()
        divergence.value = null
        return { kind: 'unchanged' }
      }

      if (!dirty.peek()) {
        const current = stateSignal.peek()
        /*
         * The smallest change that gets there, not a wholesale replacement.
         *
         * `addToHistory.of(false)` keeps this out of the undo stack, but
         * CodeMirror still *maps* every existing history event through it — so
         * replacing the document outright would map the user's own history
         * through a delete-everything, and undo afterwards would be worthless.
         * A file that changed on disk usually changed in one place.
         */
        const change = minimalChange(current.doc.toString(), incoming)
        if (change === null) {
          baseContent.value = incoming
          baseVersion.value = version.peek()
          divergence.value = null
          return { kind: 'unchanged' }
        }

        dispatch({
          changes: change,
          annotations: [
            bufferOrigin.of('reconcile'),
            // Adopting the file's version is not something the user did, so
            // Ctrl-Z must not walk backwards into stale content. `userEvent`
            // does not control this; only this annotation does.
            Transaction.addToHistory.of(false),
          ],
        })
        baseContent.value = incoming
        baseVersion.value = version.peek()
        divergence.value = null
        return { kind: 'adopted' }
      }

      // Unsaved edits and a differing incoming version. Nothing is overwritten;
      // the conflict is surfaced instead, because losing typed work silently is
      // the worst outcome available here.
      divergence.value = incoming
      return { kind: 'diverged', incoming }
    },

    acceptDivergence() {
      const incoming = divergence.peek()
      if (incoming === null) return

      const current = stateSignal.peek()
      // Minimal here too, so the undo entry is the change and not the file, and
      // so the cursor survives accepting a version of the document it is in.
      const change = minimalChange(current.doc.toString(), incoming) ?? {
        from: 0,
        to: current.doc.length,
        insert: incoming,
      }
      dispatch({
        changes: change,
        annotations: [
          // Deliberately *does* go into local history, unlike automatic
          // reconciliation. This discards work the user typed, at their
          // request, and undo is the obvious way back if they change their mind.
          bufferOrigin.of('reconcile'),
          // Its own undo group. Without this, history merges it with the edits
          // it replaced — recent changes group by time — and one Ctrl-Z would
          // step past both.
          isolateHistory.of('full'),
        ],
      })
      baseContent.value = incoming
      baseVersion.value = version.peek()
      divergence.value = null
    },

    dismissDivergence() {
      divergence.value = null
    },

    snapshot(): BufferSnapshot {
      const current = stateSignal.peek()
      const content = current.doc.toString()
      return {
        bufferId: id,
        path: path.peek(),
        pathRevision: pathRevision.peek(),
        version: version.peek(),
        languageId: languageId.peek(),
        // CodeMirror's Text is persistent, so this capture stays valid while
        // the user keeps typing. No copy, no "save all".
        doc: current.doc,
        content,
        contentId: hashString(content),
        dirty: content !== baseContent.peek(),
      }
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    dispose() {
      if (disposed.peek()) return

      // Bindings go first, while the buffer still works: releasing them is what
      // flushes a pending autosave, and that write has to be allowed to read the
      // document it is saving.
      releaseBindings()
      disposed.value = true

      view?.destroy()
      view = null
      hasView.value = false
      listeners.clear()
    },
  }

  applyBindings(buffer)

  return buffer
}
