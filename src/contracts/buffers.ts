import type { ReadonlySignal } from '@preact/signals'

/**
 * An open document.
 *
 * Buffers are stable and views are disposable: hiding a pane must not discard
 * the document, its dirty state, or its undo history. `id` never changes, and
 * `path` can change under it — a rename is not a new buffer.
 *
 * This is the phase-one shape: identity, naming, and dirty tracking only. The
 * CodeMirror `EditorState` and the single dispatch boundary that every
 * transaction passes through land with the editor itself; nothing here should
 * be read as final until they do.
 */
export interface EditorBuffer {
  readonly id: string
  readonly path: ReadonlySignal<string>
  readonly name: ReadonlySignal<string>
  /** e.g. `kcl`, `markdown`, `plaintext`. Selects editor capabilities. */
  readonly languageId: string
  readonly dirty: ReadonlySignal<boolean>
  /** Increments on every committed change. Used to reject stale work. */
  readonly version: ReadonlySignal<number>
}
