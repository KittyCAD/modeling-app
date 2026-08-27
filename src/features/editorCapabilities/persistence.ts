import type { FileSystem } from '@src/contracts/fileSystem'
import type { FsOperationQueue } from '@src/contracts/fsOperations'
import type { EditorCapability } from '@src/contracts/buffers'
import { hashString } from '@src/lib/hash'

/** How long to wait after the last keystroke before writing. */
const SAVE_DEBOUNCE_MS = 600

export interface PersistenceDependencies {
  fileSystem: () => FileSystem
  queue: () => FsOperationQueue
  onSaveError?: (input: { path: string; error: unknown }) => void
}

/**
 * Autosave, as a buffer binding rather than a CodeMirror extension.
 *
 * This is the capability that proves the binding shape is needed: a
 * `updateListener` only fires while a view is mounted, so an extension-based
 * autosave would silently stop saving a buffer whose pane is closed — exactly
 * the buffer most likely to be forgotten about.
 *
 * Three properties worth keeping:
 *
 * - **Debounced and coalesced per buffer.** One write per quiet moment, not one
 *   per keystroke.
 * - **Serialized through the operation queue**, so two saves of one file cannot
 *   interleave.
 * - **Version-checked on completion.** A save that started before a newer edit
 *   does not mark the buffer clean; `markSaved` rejects it and the next
 *   debounce writes the newer content.
 */
export function createPersistenceCapability(
  dependencies: PersistenceDependencies
): EditorCapability {
  return {
    id: 'editor.persistence',
    order: 100,
    // Only file-backed, writable buffers. A scratch buffer has nowhere to go,
    // and a read-only one must not be written back.
    appliesTo: (context) => context.fileBacked && !context.readOnly,

    bind: (buffer) => {
      let timer: number | undefined
      let disposed = false

      const flush = () => {
        const path = buffer.path.peek()
        if (!path || !buffer.dirty.peek()) return

        // Captured before the await, so the completion check compares against
        // the version that was actually written.
        const version = buffer.version.peek()
        const content = buffer.text.peek()
        const contentId = hashString(content)

        void dependencies
          .queue()
          .enqueue(path, async () => {
            dependencies.queue().recordWrite(path, contentId)
            await dependencies.fileSystem().writeTextFile(path, content)
          })
          .then(() => {
            if (disposed) return
            // Rejected if the buffer moved on: reporting a dirty buffer clean is
            // worse than saving again.
            buffer.markSaved({ version, content })
          })
          .catch((error) => {
            if (disposed) return
            console.error(`persistence: could not save ${path}`, error)
            dependencies.onSaveError?.({ path, error })
          })
      }

      const schedule = () => {
        window.clearTimeout(timer)
        timer = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
      }

      const stop = buffer.onChange((change) => {
        if (!change.docChanged) return
        // Reconciliation is the filesystem talking to us; writing it back would
        // be an echo, and a rename's path change is not a content change.
        if (change.origin === 'reconcile' || change.origin === 'capability') {
          return
        }
        schedule()
      })

      return () => {
        disposed = true
        window.clearTimeout(timer)
        stop()
        // A pending edit is written on the way out rather than dropped, since
        // the binding is torn down when the buffer closes.
        flush()
      }
    },
  }
}
