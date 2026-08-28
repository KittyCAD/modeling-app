import type { LSPClient, WorkspaceFile } from '@codemirror/lsp-client'
import { Workspace } from '@codemirror/lsp-client'
import type { ChangeSet, Text, TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type { ProjectSession } from '@src/contracts/projectSession'
import { pathToUri, uriToPath } from '@src/features/kclLsp/uris'

/** The language the server serves. Anything else is not its business. */
const SERVED_LANGUAGE = 'kcl'

/**
 * What `syncFiles` reports, restated.
 *
 * The package uses this type in `Workspace.syncFiles` but does not export it, so
 * this is the same shape declared locally. Structural, so the override still
 * matches; if the package ever exports it, this goes.
 */
interface WorkspaceFileUpdate {
  file: WorkspaceFile
  prevDoc: Text
  changes: ChangeSet
}

interface TrackedFile extends WorkspaceFile {
  buffer: FileBackedTextBuffer
  /** Changes since the last sync, composed. Null when nothing moved. */
  pending: ChangeSet | null
  /** Set while a view holds this file. Null is normal, not an error. */
  view: EditorView | null
  stopWatching: () => void
}

/**
 * The open document set, as the session already knows it.
 *
 * The default workspace "only opens files that have an active editor, and only
 * allows one editor per file". That is the assumption this app is built to
 * violate: a buffer here outlives the pane that showed it, so closing a tab must
 * not tell the server the file is gone — the document is still open, still
 * edited, still the thing an import resolves to.
 *
 * So the file set is the *session's* KCL buffers, and a view is an optional
 * extra that some of them happen to have. `main` needed a headless second
 * `EditorView` and a family of synchronise methods to fake this; here it is what
 * the buffer collection already is.
 *
 * Two consequences worth keeping:
 *
 * - **Changes are accumulated, not diffed.** Every edit already arrives as a
 *   `ChangeSet` through the buffer's one dispatch boundary, so `syncFiles`
 *   composes what happened rather than comparing two documents and guessing.
 * - **A server-initiated edit goes through the buffer.** `updateFile` dispatches
 *   to the buffer rather than to a view, so a rename lands in a file whose pane
 *   is closed, and lands in its undo history, exactly as a local edit would.
 */
export class BufferWorkspace extends Workspace {
  files: TrackedFile[] = []

  constructor(
    client: LSPClient,
    private readonly session: () => ProjectSession | null
  ) {
    super(client)
  }

  /**
   * Reconcile with the session, and report what moved.
   *
   * Called by the client before it needs positions to mean something. Opening
   * and closing files is done here too: it is the one place that already has to
   * know which buffers exist, and doing it anywhere else would mean two answers
   * to the same question.
   */
  syncFiles(): readonly WorkspaceFileUpdate[] {
    this.reconcile()

    const updates: WorkspaceFileUpdate[] = []

    for (const file of this.files) {
      const changes = file.pending
      if (!changes) continue

      const prevDoc = file.doc
      file.pending = null
      file.doc = file.buffer.state.peek().doc
      file.version = file.buffer.version.peek()

      updates.push({ file, prevDoc, changes })
    }

    return updates
  }

  /** A view appeared for a file. The file itself may already have been open. */
  openFile(uri: string, _languageId: string, view: EditorView): void {
    const existing = this.files.find((file) => file.uri === uri)
    if (existing) {
      existing.view = view
      return
    }

    // A file the session does not have — a scratch buffer, or one opened after
    // the last sync. Reconciling picks it up and tells the server.
    this.reconcile()
    const found = this.files.find((file) => file.uri === uri)
    if (found) found.view = view
  }

  /**
   * A view went away. The file has not.
   *
   * This is the whole difference from the default workspace: closing the pane is
   * not closing the document, so the server keeps its view of the file. `didClose`
   * happens in `reconcile`, when the *buffer* is gone.
   */
  closeFile(uri: string, view: EditorView): void {
    const file = this.files.find((candidate) => candidate.uri === uri)
    if (file?.view === view) file.view = null
  }

  /** Dispatch a server-initiated edit through the buffer, not through a view. */
  updateFile(uri: string, update: TransactionSpec): void {
    const file = this.files.find((candidate) => candidate.uri === uri)
    if (!file) return
    file.buffer.dispatch(update)
  }

  /**
   * Bring a file to the front, for go-to-definition and friends.
   *
   * Only a file the session already has open. Opening one as a side effect of a
   * hover would move the user somewhere they did not ask to go, and the session's
   * `openFile` also makes the buffer active — so that decision belongs to a
   * command, not to a server response.
   */
  async displayFile(uri: string): Promise<EditorView | null> {
    const file = this.files.find((candidate) => candidate.uri === uri)
    if (!file) return null

    this.session()?.setActiveBuffer(file.buffer.id)
    return file.view
  }

  /** Called when the client connects. Every open file is announced. */
  connected(): void {
    this.reconcile()
    super.connected()
  }

  dispose(): void {
    for (const file of this.files) file.stopWatching()
    this.files = []
  }

  /**
   * Match the file set to the session's buffers.
   *
   * Additions are announced with `didOpen`, removals with `didClose`. A buffer
   * whose language is not the served one is not the server's business, and
   * neither is a scratch buffer with no path — the server addresses files by URI
   * and there is no URI for a document that is nowhere.
   */
  private reconcile(): void {
    const session = this.session()
    const buffers = session?.buffers.value ?? []

    const wanted = new Map<string, FileBackedTextBuffer>()
    for (const buffer of buffers) {
      const path = buffer.path.peek()
      if (path === null) continue
      if (buffer.languageId.peek() !== SERVED_LANGUAGE) continue
      wanted.set(pathToUri(path), buffer)
    }

    for (const file of [...this.files]) {
      const buffer = wanted.get(file.uri)
      // Still there, and still the same document.
      if (buffer === file.buffer) continue

      file.stopWatching()
      this.files = this.files.filter((candidate) => candidate !== file)
      this.client.didClose(file.uri)
    }

    for (const [uri, buffer] of wanted) {
      if (this.files.some((file) => file.uri === uri)) continue
      this.files.push(this.track(uri, buffer))
      this.client.didOpen(this.files[this.files.length - 1])
    }
  }

  private track(uri: string, buffer: FileBackedTextBuffer): TrackedFile {
    const file: TrackedFile = {
      uri,
      languageId: SERVED_LANGUAGE,
      version: buffer.version.peek(),
      doc: buffer.state.peek().doc as Text,
      buffer,
      pending: null,
      view: null,
      stopWatching: () => {},
      getView: () => file.view,
    }

    /*
     * Every edit is composed as it arrives.
     *
     * The buffer's one dispatch boundary means this sees typing, a command, an
     * LSP response and filesystem reconciliation alike — so `syncFiles` reports
     * what actually happened rather than diffing two documents and inventing a
     * change that fits.
     */
    file.stopWatching = buffer.onChange((change) => {
      if (!change.docChanged) return

      for (const transaction of change.transactions) {
        if (!transaction.docChanged) continue
        file.pending = file.pending
          ? file.pending.compose(transaction.changes)
          : transaction.changes
      }
    })

    return file
  }
}

/** The URI a buffer is addressed by, or null if it has no path. */
export function uriForBuffer(buffer: FileBackedTextBuffer): string | null {
  const path = buffer.path.peek()
  return path === null ? null : pathToUri(path)
}

export { uriToPath }
