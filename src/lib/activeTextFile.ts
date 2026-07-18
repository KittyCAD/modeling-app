import { signal } from '@preact/signals-core'

import { EDITABLE_TEXT_FILE_EXTENSIONS } from '@src/lib/constants'
import { isPathNotFoundError } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { reportSystemIOError } from '@src/lib/systemIOErrorReporting'
import { reportRejection } from '@src/lib/trap'

/**
 * A non-KCL text file (e.g. Markdown or plain text) opened for editing in the
 * code pane. This lives entirely outside the KCL execution pipeline
 * (`KclManager`) so that opening/editing these files never triggers execution,
 * LSP, or WASM project loading.
 *
 * Note: the live edit buffer is intentionally NOT stored on this signal. Only
 * load state and the initially-loaded text are held here, so keystrokes don't
 * change the signal identity and force the editor to be recreated. The pending
 * write buffer below carries the live text instead.
 */
export type ActiveTextFile =
  | {
      path: string
      name: string
      text: string
      status: 'ready'
    }
  | {
      path: string
      name: string
      text: ''
      status: 'loading'
    }
  | {
      path: string
      name: string
      text: ''
      status: 'error'
      error: string
    }

export const activeTextFileSignal = signal<ActiveTextFile | null>(null)

const encoder = new TextEncoder()

/** Debounce for writing edits to disk, mirroring `KclManager.writeToFile`. */
const WRITE_DEBOUNCE_MS = 1000

/**
 * Guards the async read in `openActiveTextFile` against races: if a newer open
 * (or a clear) happens while an older read is in flight, the older read's result
 * is discarded.
 */
let latestOpenRequestId = 0

/**
 * The most recent unsaved edit, carrying its own path so a flush always writes
 * to the correct file even if the active file changes before the timer fires.
 */
let pendingWrite: { path: string; text: string } | null = null
let pendingWriteTimeout: ReturnType<typeof setTimeout> | undefined

/** Whether a file at `path` can be opened + edited as plain text in the code pane. */
export function isEditableTextFile(path: string): boolean {
  const lower = path.toLowerCase()
  return EDITABLE_TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

async function performWrite(path: string, text: string): Promise<void> {
  try {
    await fsZds.writeFile(path, encoder.encode(text))
  } catch (error) {
    // The file may have been deleted/moved out from under us (e.g. via the
    // file tree). Don't recreate it or surface a scary error in that case.
    if (isPathNotFoundError(error)) {
      return
    }
    reportSystemIOError({
      error,
      operation: 'save_text_file',
      risk: 'write',
      source: 'ActiveTextFile',
      extra: {
        phase: 'write',
        partialMutationPossible: true,
        dataLossPossible: true,
        contentLength: text.length,
      },
    })
    // Surface (but never throw) so a transient auto-save failure can't turn into
    // an unhandled rejection.
    reportRejection(error)
  }
}

/**
 * Flush any pending debounced write immediately. Used before switching to a
 * different file (or clearing) so edits typed within the debounce window aren't
 * lost. Writes to the pending write's own path, not the currently-active file.
 */
export async function flushActiveTextFileWrite(): Promise<void> {
  if (pendingWriteTimeout !== undefined) {
    clearTimeout(pendingWriteTimeout)
    pendingWriteTimeout = undefined
  }
  const write = pendingWrite
  pendingWrite = null
  if (write) {
    await performWrite(write.path, write.text)
  }
}

/**
 * Schedule a debounced write of the active text file's latest contents. Called
 * by the editor on every document change. Ignores writes whose path is no
 * longer the active file.
 */
export function scheduleActiveTextFileWrite(path: string, text: string): void {
  // `peek()` avoids creating a signal subscription from a non-reactive context.
  if (activeTextFileSignal.peek()?.path !== path) {
    return
  }
  pendingWrite = { path, text }
  if (pendingWriteTimeout !== undefined) {
    clearTimeout(pendingWriteTimeout)
  }
  pendingWriteTimeout = setTimeout(() => {
    pendingWriteTimeout = undefined
    const write = pendingWrite
    pendingWrite = null
    if (write) {
      void performWrite(write.path, write.text)
    }
  }, WRITE_DEBOUNCE_MS)
}

/** Clear the active text file, persisting any pending edits first. */
export function clearActiveTextFile(): void {
  // Fire-and-forget so this stays synchronous for React cleanup callers.
  void flushActiveTextFileWrite()
  latestOpenRequestId += 1
  activeTextFileSignal.value = null
}

/**
 * Open a text file for editing in the code pane. Persists any pending edits to
 * the previously-open file first, then reads the requested file from disk.
 */
export async function openActiveTextFile(path: string): Promise<void> {
  // Persist edits to the outgoing file before switching.
  await flushActiveTextFileWrite()

  const requestId = ++latestOpenRequestId
  const name = fsZds.basename(path)

  activeTextFileSignal.value = {
    path,
    name,
    text: '',
    status: 'loading',
  }

  try {
    const text = await fsZds.readFile(path, { encoding: 'utf-8' })
    if (requestId !== latestOpenRequestId) {
      return
    }
    activeTextFileSignal.value = {
      path,
      name,
      text,
      status: 'ready',
    }
  } catch (error) {
    if (requestId !== latestOpenRequestId) {
      return
    }
    activeTextFileSignal.value = {
      path,
      name,
      text: '',
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
