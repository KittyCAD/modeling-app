import {
  appendValueSpec,
  defineContract,
  defineValueSpec,
} from '@kittycad/registry'
import type {
  EditorState,
  Extension,
  Text,
  Transaction,
  TransactionSpec,
} from '@codemirror/state'
import type { ReadonlySignal } from '@preact/signals'

export type BufferId = string

/**
 * A buffer's *structural* context.
 *
 * These are the facts that change **which extensions** a buffer has. Anything
 * that changes often — diagnostics, cursor position, dirty state, execution
 * results, remote divergence — must not appear here: those flow through
 * transactions, state fields, facets, and signals, so a keystroke never rebuilds
 * an extension bundle.
 *
 * Getting this line wrong is the expensive mistake. A volatile value in here
 * means every change reconfigures the editor and discards anything the
 * extensions were holding.
 */
export interface BufferStructuralContext {
  bufferId: BufferId
  /**
   * The buffer's resource identity: an absolute path the filesystem accepts.
   *
   * Absolute rather than project-relative because this is what capabilities
   * *act on* — persistence writes it, and an LSP will address it. The
   * project-relative form is a presentation concern and lives on the session.
   *
   * Null for a scratch buffer with no file behind it.
   */
  path: string | null
  languageId: string
  fileBacked: boolean
  /** True when this buffer is the one driving the modelling engine. */
  executing: boolean
  readOnly: boolean
}

/**
 * One installable editor capability.
 *
 * Syntax, keymaps, formatting, diagnostics, persistence, and eventually LSP and
 * execution are all capabilities. A capability is a *function of structural
 * context*, evaluated per buffer, never a global editor configuration.
 */
export interface EditorCapability {
  id: string
  /**
   * Position in the resolved extension array. Lower comes first, and CodeMirror
   * gives earlier extensions higher precedence, so this is how conflicts between
   * capabilities are settled deterministically.
   */
  order?: number
  /** Restricts the capability to some buffers. Defaults to all of them. */
  appliesTo?: (context: BufferStructuralContext) => boolean
  /**
   * The extensions this capability contributes for one buffer.
   *
   * Called only when the structural context changes, so it is allowed to be
   * expensive. It must be pure with respect to the context: the same context has
   * to produce the same extensions, or reconfiguration stops being predictable.
   */
  extension?: (context: BufferStructuralContext) => Extension
  /**
   * A live binding to the buffer, returning a disposer.
   *
   * For capabilities that must work with no view mounted — autosave being the
   * obvious one, since a `updateListener` only fires while something is on
   * screen. A plain function rather than a controller class, because that is all
   * the lifecycle a binding needs.
   */
  bind?: (
    buffer: FileBackedTextBuffer,
    context: BufferStructuralContext
  ) => (() => void) | void
}

/**
 * The combined capability set, resolved once for the whole application.
 *
 * There is exactly one of these — not one per buffer. Each buffer evaluates it
 * against its own context and applies the result through a single compartment.
 */
export interface EditorCapabilityResolver {
  readonly capabilities: readonly EditorCapability[]
  /** Extensions for one buffer, in deterministic precedence order. */
  resolve(context: BufferStructuralContext): Extension[]
  /** Capabilities that want a live binding for this context. */
  bindings(context: BufferStructuralContext): readonly EditorCapability[]
}

/** What happened to a buffer, published for the session to record. */
export interface BufferChange {
  bufferId: BufferId
  docChanged: boolean
  version: number
  pathRevision: number
  /** Who caused it, from the transaction's origin annotation. */
  origin: string
  transactions: readonly Transaction[]
}

/** The result of folding an incoming external version into a buffer. */
export type BufferReconcileOutcome =
  /** Incoming content matched what the buffer already had. */
  | { kind: 'unchanged' }
  /** The buffer was clean, so the incoming content became the new base. */
  | { kind: 'adopted' }
  /**
   * The buffer had unsaved edits and the incoming content differs from its base.
   * Nothing was overwritten; the divergence is recorded for the user to resolve.
   */
  | { kind: 'diverged'; incoming: string }

/**
 * An immutable capture of a buffer.
 *
 * Holds the CodeMirror `Text` itself, which is persistent, so capturing is O(1)
 * and the captured document stays valid while the user keeps typing.
 */
export interface BufferSnapshot {
  bufferId: BufferId
  /** Absolute resource path. Null for a scratch buffer. */
  path: string | null
  pathRevision: number
  version: number
  languageId: string
  doc: Text
  content: string
  /** Cheap content identity, for change detection and write provenance. */
  contentId: string
  dirty: boolean
}

/**
 * An open document.
 *
 * The buffer owns the `EditorState`; a view is a disposable presentation of it.
 * Closing a pane must not discard the document or its undo history, so nothing
 * about mounting is a document lifecycle operation.
 *
 * `id` is generated and never derived from the path: a rename moves a buffer
 * without changing its identity, which is what lets background work hold a
 * reference across a move.
 */
export interface FileBackedTextBuffer {
  readonly id: BufferId
  readonly state: ReadonlySignal<EditorState>
  readonly text: ReadonlySignal<string>

  /** Absolute resource path. Null for a scratch buffer. */
  readonly path: ReadonlySignal<string | null>
  readonly name: ReadonlySignal<string>
  /** Increments on every path change. Guards path-scoped async work. */
  readonly pathRevision: ReadonlySignal<number>
  /** Increments on every document-changing transaction. Guards stale writes. */
  readonly version: ReadonlySignal<number>

  readonly languageId: ReadonlySignal<string>
  readonly fileBacked: ReadonlySignal<boolean>
  readonly dirty: ReadonlySignal<boolean>
  /** Content last known to match the file on disk. */
  readonly baseContent: ReadonlySignal<string>
  /** Document version at which the base was captured. */
  readonly baseVersion: ReadonlySignal<number>
  /** Set when an external change could not be applied over local edits. */
  readonly divergence: ReadonlySignal<string | null>

  readonly readOnly: ReadonlySignal<boolean>
  readonly executing: ReadonlySignal<boolean>
  readonly hasView: ReadonlySignal<boolean>
  /**
   * True once the buffer has been disposed.
   *
   * A disposed buffer is inert: it still answers questions about the document it
   * held, and it accepts no further change. Anything holding a buffer id across
   * time has to be able to ask — a history entry that walked a closed buffer
   * backwards would move the document and write nothing, because the capability
   * that saves it is already gone.
   */
  readonly disposed: ReadonlySignal<boolean>
  readonly structuralContext: ReadonlySignal<BufferStructuralContext>

  /**
   * The dispatch boundary.
   *
   * Every state change — typing in a view, a command, an LSP response, a
   * modelling action, an agent, filesystem reconciliation — arrives here. One
   * boundary is what makes change events, versioning, and stale-work rejection
   * possible at all.
   */
  dispatch(...specs: TransactionSpec[]): void
  /** The same boundary, for an attached view's already-built transactions. */
  dispatchTransactions(transactions: readonly Transaction[]): void

  /**
   * Run a CodeMirror `StateCommand` against this buffer.
   *
   * Works with no view mounted, which is the whole point: undo has to survive
   * closing the pane.
   */
  runCommand(
    command: (target: {
      state: EditorState
      dispatch: (transaction: Transaction) => void
    }) => boolean
  ): boolean

  /** Mount a view into `parent`. Returns a disposer. One view at a time. */
  attachView(parent: HTMLElement): () => void

  setPath(path: string | null): void
  setExecuting(executing: boolean): void
  setReadOnly(readOnly: boolean): void

  /**
   * Record that the file now matches this content.
   *
   * Rejected, returning false, if the buffer has moved on past `version` — that
   * is a stale save completing after a newer edit, and accepting it would report
   * a dirty buffer as clean.
   */
  markSaved(input: { version: number; content: string }): boolean

  /** Fold in an external version of the file without clobbering local edits. */
  reconcile(incoming: string): BufferReconcileOutcome
  /** Accept a recorded divergence, replacing local content. */
  acceptDivergence(): void
  /** Keep local content and forget the divergence. */
  dismissDivergence(): void

  /** O(1) immutable capture, valid after the user keeps typing. */
  snapshot(): BufferSnapshot

  onChange(listener: (change: BufferChange) => void): () => void
  dispose(): void
}

function combineCapabilities(
  contributions: readonly EditorCapability[]
): EditorCapabilityResolver {
  // Later contributions with the same id replace earlier ones, so an app or a
  // plugin can override a core capability by re-declaring its id.
  const byId = new Map<string, EditorCapability>()
  for (const capability of contributions) byId.set(capability.id, capability)

  const capabilities = Array.from(byId.values()).toSorted(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
  )

  const applicable = (context: BufferStructuralContext) =>
    capabilities.filter((capability) => capability.appliesTo?.(context) ?? true)

  return {
    capabilities,
    resolve(context) {
      return applicable(context)
        .filter((capability) => capability.extension !== undefined)
        .map((capability) => capability.extension?.(context) ?? [])
    },
    bindings(context) {
      return applicable(context).filter(
        (capability) => capability.bind !== undefined
      )
    },
  }
}

export const buffersContract = defineContract({
  /**
   * One application-level value spec for capabilities.
   *
   * Deliberately not one registry or value spec per buffer: capabilities are
   * installed once and evaluated many times.
   */
  editorCapabilitiesValueSpec: defineValueSpec<
    EditorCapability,
    EditorCapabilityResolver
  >({
    name: 'editor.capabilities',
    defaultValue: combineCapabilities([]),
    combine: combineCapabilities,
  }),
  /** Themes are separate so a host app can restyle without touching behaviour. */
  editorThemesValueSpec: appendValueSpec<Extension>('editor.themes'),
})

export const { editorCapabilitiesValueSpec, editorThemesValueSpec } =
  buffersContract

export { combineCapabilities }
