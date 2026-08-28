import { signal } from '@preact/signals'
import type { ProjectFile } from '@src/contracts/projects'
import type { ProjectSession } from '@src/contracts/projectSession'
import { basename, dirname, joinPath, uniqueFileName } from '@src/lib/paths'

/**
 * What the file tree is doing, apart from the files themselves.
 *
 * At module scope rather than in the component, for two reasons. The panel
 * unmounts every time the code panel is toggled shut, and a tree that forgot
 * which folders were open each time you glanced at the model would be worse than
 * no memory at all. And the same state is driven from three places — the rows,
 * the panel's header actions, and the commands in the palette — which as
 * component state would mean threading it through all of them.
 *
 * Reset when the *project* changes, which is the only time any of it stops
 * making sense.
 */

export type DraftMode = 'file' | 'directory' | 'rename'

export interface Draft {
  mode: DraftMode
  /**
   * The directory a new entry goes in, or the entry being renamed.
   *
   * Project-relative. The empty string is the project root, which is a real
   * target rather than a missing one.
   */
  target: string
  value: string
  error: string | null
  busy: boolean
}

export interface DeleteRequest {
  path: string
  error: string | null
  busy: boolean
}

/** Directories currently open, by project-relative path. */
export const expandedPaths = signal<ReadonlySet<string>>(new Set())
/** The row that operations act on when nothing names one. */
export const selectedPath = signal<string | null>(null)
export const draft = signal<Draft | null>(null)
export const pendingDelete = signal<DeleteRequest | null>(null)

/**
 * Forget everything when the project changes, and only then.
 *
 * Tracked here rather than by the view because the view mounts and unmounts
 * constantly — every toggle of the code panel — and none of those is a reason to
 * collapse the tree someone just opened.
 */
let lastProjectId: string | null = null

export function syncProject(projectId: string | null) {
  if (projectId === lastProjectId) return
  lastProjectId = projectId
  resetFileExplorerState()
}

export function resetFileExplorerState() {
  expandedPaths.value = new Set()
  selectedPath.value = null
  draft.value = null
  pendingDelete.value = null
}

export function toggleExpanded(path: string) {
  const next = new Set(expandedPaths.value)
  if (!next.delete(path)) next.add(path)
  expandedPaths.value = next
}

export function expandPath(path: string) {
  if (!path || expandedPaths.value.has(path)) return
  expandedPaths.value = new Set([...expandedPaths.value, path])
}

export function collapseAll() {
  expandedPaths.value = new Set()
}

/**
 * Reject a name before the filesystem has to.
 *
 * Only the things that are wrong whatever the platform: a separator would make
 * this a move rather than a rename, and the dot names address a directory rather
 * than name one. Everything else — reserved names, length limits, case-only
 * differences on a case-insensitive volume — is the filesystem's to refuse, and
 * it will say so more accurately than a guess here.
 */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'A name is needed.'
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return 'A name cannot contain a slash.'
  }
  if (trimmed === '.' || trimmed === '..') return 'That name is not usable.'
  return null
}

/** The entry at a project-relative path, at whatever depth it sits. */
export function findEntry(
  files: readonly ProjectFile[],
  path: string
): ProjectFile | undefined {
  for (const candidate of files) {
    if (candidate.path === path) return candidate
    const inside = findEntry(candidate.children ?? [], path)
    if (inside) return inside
  }
  return undefined
}

/** Names taken in one directory, for defaulting a new one that is free. */
export function namesIn(
  files: readonly ProjectFile[],
  directory: string
): readonly string[] {
  if (!directory) return files.map((file) => file.name)
  return (findEntry(files, directory)?.children ?? []).map((file) => file.name)
}

/**
 * The directory an operation started from a row should act in.
 *
 * A directory acts on itself; a file acts on the directory holding it, because
 * "new file" while a file is selected means beside it, not inside it.
 */
export function directoryFor(
  files: readonly ProjectFile[],
  path: string | null
): string {
  if (!path) return ''

  const entry = findEntry(files, path)
  if (!entry) return ''
  return entry.kind === 'directory' ? entry.path : dirname(entry.path)
}

const DEFAULT_FILE_NAME = 'untitled.kcl'
const DEFAULT_DIRECTORY_NAME = 'untitled'

export function startCreate(
  mode: 'file' | 'directory',
  directory: string,
  siblings: readonly string[]
) {
  pendingDelete.value = null
  // The target has to be open or the row would appear nowhere.
  expandPath(directory)

  draft.value = {
    mode,
    target: directory,
    value: uniqueFileName(
      mode === 'file' ? DEFAULT_FILE_NAME : DEFAULT_DIRECTORY_NAME,
      siblings
    ),
    error: null,
    busy: false,
  }
}

export function startRename(path: string) {
  if (!path) return
  pendingDelete.value = null
  draft.value = {
    mode: 'rename',
    target: path,
    value: basename(path),
    error: null,
    busy: false,
  }
}

export function updateDraft(value: string) {
  const current = draft.value
  if (!current) return
  // The error clears on the next keystroke: it described the name that was
  // submitted, and this is a different one.
  draft.value = { ...current, value, error: null }
}

export function cancelDraft() {
  draft.value = null
}

/**
 * Do what the draft says, and keep it open if it cannot be done.
 *
 * A rejected name leaves the row in place with the reason under it, because the
 * alternative — closing the row and reporting elsewhere — throws away what was
 * typed at the moment it becomes most useful.
 */
export async function submitDraft(session: ProjectSession): Promise<void> {
  const current = draft.value
  if (!current || current.busy) return

  const name = current.value.trim()
  const invalid = validateEntryName(name)
  if (invalid) {
    draft.value = { ...current, error: invalid }
    return
  }

  const path =
    current.mode === 'rename'
      ? joinPath(dirname(current.target), name)
      : joinPath(current.target, name)

  if (current.mode === 'rename' && path === current.target) {
    draft.value = null
    return
  }

  draft.value = { ...current, busy: true, error: null }

  try {
    if (current.mode === 'file') {
      await session.createFile(path)
      // Opening it is the reason it was created. Nothing else in the app has to
      // agree: opening a file changes what is on screen, not what is executing.
      await session.openFile(path)
    } else if (current.mode === 'directory') {
      await session.createDirectory(path)
      expandPath(path)
    } else {
      await session.renameEntry(current.target, path)
    }

    draft.value = null
    selectedPath.value = path
  } catch (error) {
    draft.value = {
      ...current,
      busy: false,
      error: error instanceof Error ? error.message : 'That did not work.',
    }
  }
}

export function requestDelete(path: string) {
  if (!path) return
  draft.value = null
  pendingDelete.value = { path, error: null, busy: false }
}

export function cancelDelete() {
  pendingDelete.value = null
}

export async function confirmDelete(session: ProjectSession): Promise<void> {
  const current = pendingDelete.value
  if (!current || current.busy) return

  pendingDelete.value = { ...current, busy: true, error: null }

  try {
    await session.deleteEntry(current.path)
    pendingDelete.value = null
    if (selectedPath.value === current.path) selectedPath.value = null
  } catch (error) {
    pendingDelete.value = {
      ...current,
      busy: false,
      error: error instanceof Error ? error.message : 'That did not work.',
    }
  }
}
