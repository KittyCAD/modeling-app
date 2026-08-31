import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ChangeHistory } from '@src/lib/collab/changeHistory'
import type { RevertOutcome } from '@src/lib/collab/revertContribution'

/**
 * The panel that draws the history.
 *
 * Here rather than in the feature because an area is addressed by things that
 * must not import its implementation — the project's layout preset places it,
 * and a command toggles it.
 */
export const HISTORY_AREA_ID = 'project.history'

/**
 * One coordinated change to the project.
 *
 * A modelling operation, an agent turn, a project mutation — anything that wrote
 * to more than one place and should be undone as a unit. The `id` is also the
 * `contributionId` carried on every transaction it dispatched, which is what
 * makes undoing it possible at all: this record is a label, not a copy of the
 * change.
 */
export interface ProjectAction {
  /** Also the `contributionId` on every transaction the action dispatched. */
  id: string
  /** Past tense and specific: "Extruded profile001 by 10". */
  label: string
  at: number
  /** Opaque collaborator id, or null for the local user. */
  author: string | null
  /** Project-relative paths it changed. */
  paths: readonly string[]
}

/**
 * What has been done to the project, and how to undo it.
 *
 * The missing half of undo (#13353). CodeMirror's history is per `EditorState`,
 * so a change spanning three files is three undo stacks by construction and
 * `Ctrl-Z` in one of them undoes a third of an operation. This is the coordinated
 * stack the app never had.
 *
 * Deliberately **not** a second record of what changed. Every coordinated writer
 * already tags its transactions with a contribution id, and `ChangeHistory`
 * already holds the changes; this is a labelled index over them. A parallel copy
 * of the edits would be a second source of truth whose only distinctive ability
 * is disagreeing with the first.
 *
 * **Bound to `Ctrl-Z`**, through `undoTargetFor` — see the capability in
 * `editorCapabilities/projectUndo.ts` for how the precedence question is
 * answered without reading CodeMirror's history internals.
 */
export interface ProjectActionHistory {
  /** Newest last, the order they were applied. */
  readonly entries: ReadonlySignal<readonly ProjectAction[]>
  /** The newest action that can still be undone, if any. */
  readonly undoable: ReadonlySignal<ProjectAction | null>
  /** Record what a coordinated writer just did. */
  record(action: ProjectAction): void
  /** Whether an action's changes are still exactly undoable. */
  canRevert(actionId: string): ReadonlySignal<boolean>
  /**
   * The action `Ctrl-Z` should undo in this buffer, or null to let the buffer
   * undo its own newest edit.
   *
   * Answered by comparing `undoDepth` against the depth recorded when the action
   * was applied. That is the whole precedence rule, and it is a question about
   * *position in the undo stack* rather than about time: the buffer's newest
   * transaction is the wrong thing to ask about, because undoing the user's own
   * typing is itself a transaction, and after it the action is once again the
   * next thing to undo.
   *
   * Not a signal. It is asked once per keystroke against the state that keystroke
   * sees, and a stale answer here would revert the wrong thing.
   */
  undoTargetFor(path: string, undoDepth: number): ProjectAction | null
  /**
   * Undo one action across every file it touched.
   *
   * **Text only.** Reverting projects the inverse of the action's *edits* through
   * everything that came after them; a file the action created is not removed and
   * one it deleted is not restored. Deliberate: `deleteEntry` moves a file to the
   * OS trash and recreating it from a snapshot would produce a new file wearing
   * the old name, which is a different claim than "undone". An action that
   * created or deleted files should say so in its label.
   *
   * Partial success is normal and reported: a file whose history is gone is left
   * alone rather than the whole action refusing.
   */
  revert(actionId: string): RevertOutcome
  /** Drop an action, once its history is no longer worth holding. */
  forget(actionId: string): void
}

export const projectHistoryContract = defineContract({
  /**
   * The applied-change log, shared.
   *
   * A service rather than a private field, because two things need the same log
   * and neither can hold a partial one: undoing any contribution means projecting
   * its inverse through *everything* that happened afterwards, including other
   * writers' edits and the user's typing.
   */
  changeHistoryService: defineService<ChangeHistory>('collab.changeHistory'),
  projectHistoryService: defineService<ProjectActionHistory>(
    'projectHistory.service'
  ),
})

export const { changeHistoryService, projectHistoryService } =
  projectHistoryContract
