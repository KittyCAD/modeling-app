import type { ProjectAction } from '@src/contracts/projectHistory'
import type { ProjectActionHistory } from '@src/contracts/projectHistory'

/**
 * Whether undo, right now, means undoing a whole project action.
 *
 * One implementation because there are **two** ways to undo in this app and they
 * have to agree: CodeMirror's `historyKeymap` inside a focused editor, and the
 * app-level `buffer.undo` command, which is what `⌘Z` means everywhere else —
 * the feature tree, the viewport, a panel. A version of this living only in the
 * editor capability would make one keystroke undo a three-file operation and the
 * same keystroke, one click away, undo a third of it.
 *
 * Reverting is left to the caller's `revert`, so this stays a decision rather
 * than an effect and can be asked speculatively.
 */
export function projectActionToUndo(input: {
  history: ProjectActionHistory | null
  /** The buffer's project-relative path, or null if it has none. */
  path: string | null
  /** `undoDepth` of the state the keystroke is acting on. */
  undoDepth: number
}): ProjectAction | null {
  const { history, path, undoDepth } = input
  if (history === null || path === null) return null
  return history.undoTargetFor(path, undoDepth)
}
