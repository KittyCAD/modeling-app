import { isolateHistory } from '@codemirror/commands'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type { ChangeHistory } from '@src/lib/collab/changeHistory'
import {
  type StrandedRange,
  inverseForContribution,
} from '@src/lib/collab/revert'

export interface RevertOutcome {
  /** Paths that were undone. */
  reverted: readonly string[]
  /**
   * Paths that could not be.
   *
   * Either no buffer is open for them, or the history that would undo them is
   * gone — beyond the log's horizon, or refused because the file changed outside
   * the app. Reported per path rather than collapsed into a boolean, because a
   * turn spanning three files can succeed on two of them and the user should be
   * told which.
   */
  missing: readonly string[]
  /**
   * Text somebody else typed inside the reverted blocks.
   *
   * Preserved, not deleted — mapping a deletion over an insertion inside it keeps
   * the insertion. Reported so the caller can say it will be left stranded rather
   * than pretending the file comes back clean.
   */
  stranded: readonly (StrandedRange & { path: string })[]
}

/**
 * Undo one contribution across every file it touched.
 *
 * The single implementation, shared by the agent's per-turn revert and the
 * project-wide action history — two near-identical copies of change algebra being
 * exactly the kind of thing that drifts until one of them is subtly wrong.
 *
 * **The revert always enters the buffer's own history**, and there is no option to
 * keep it out. An earlier version had one, on the reasoning that a project-wide
 * undo stack should not grow a mirror of itself inside every file. Running it
 * showed that hiding the revert from history *corrupts the document*: the buffer
 * still holds an undo entry for the edit being reverted, CodeMirror maps that
 * entry through the revert's changes, and the next Ctrl-Z applies an inverse that
 * has already been applied — `width = 10` came back as `width = 1010`. History
 * cannot know a change it was not shown has already undone what it remembers.
 *
 * So the revert is a change to the buffer like any other, and one Ctrl-Z after it
 * puts the reverted work back. A duplicated entry is a cosmetic cost; a document
 * that mangles itself on the next keystroke is not.
 *
 * Partial success is normal. A turn that changed three files and can only be
 * undone in two leaves the third alone and says so; the alternative is refusing
 * to undo anything because one file moved on.
 */
export function revertContribution(input: {
  contributionId: string
  /** Project-relative paths the contribution touched. */
  paths: readonly string[]
  changeHistory: ChangeHistory
  bufferForPath: (path: string) => FileBackedTextBuffer | undefined
}): RevertOutcome {
  const { contributionId, paths, changeHistory, bufferForPath } = input

  const reverted: string[] = []
  const missing: string[] = []
  const stranded: (StrandedRange & { path: string })[] = []

  for (const path of paths) {
    const buffer = bufferForPath(path)
    if (buffer === undefined) {
      missing.push(path)
      continue
    }

    const inverse = inverseForContribution({
      applied: changeHistory.entries(path),
      contributionId,
    })
    if (inverse.changes === null) {
      missing.push(path)
      continue
    }

    for (const range of inverse.stranded) stranded.push({ ...range, path })

    buffer.dispatch({
      changes: inverse.changes,
      /*
       * Its own undo group. Without this the revert merges with whatever was typed
       * moments before it — history groups by time — and one Ctrl-Z would step
       * past both.
       */
      annotations: [isolateHistory.of('full')],
    })

    reverted.push(path)
  }

  return { reverted, missing, stranded }
}
