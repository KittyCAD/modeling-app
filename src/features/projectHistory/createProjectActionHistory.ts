import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type {
  ProjectAction,
  ProjectActionHistory,
} from '@src/contracts/projectHistory'
import type { ChangeHistory } from '@src/lib/collab/changeHistory'
import { inverseForContribution } from '@src/lib/collab/revert'
import { revertContribution } from '@src/lib/collab/revertContribution'

/** How many actions to remember. Older ones are dropped, not undone. */
const DEFAULT_DEPTH = 50

/**
 * The project's own undo stack.
 *
 * Holds labels and paths; the changes live in `ChangeHistory`. That split is the
 * whole design — an action is undoable exactly as long as the change history for
 * its files still holds its rows, so "can this be undone" is a question with one
 * answer rather than two records that might disagree.
 *
 * Bounded by depth so an all-day session does not accumulate forever. Dropping an
 * action does not undo it or discard its changes; it only stops offering to undo
 * it, which is the honest thing for something far enough back that the file has
 * moved on regardless.
 */
export function createProjectActionHistory(dependencies: {
  changeHistory: ChangeHistory
  bufferForPath: (path: string) => FileBackedTextBuffer | undefined
  depth?: number
}): ProjectActionHistory {
  const { changeHistory, bufferForPath, depth = DEFAULT_DEPTH } = dependencies

  const actions = signal<readonly ProjectAction[]>([])

  /** True while the change history still holds rows for the action. */
  const held = (action: ProjectAction) =>
    action.paths.some((path) =>
      changeHistory
        .entries(path)
        .some((entry) => entry.contributionId === action.id)
    )

  return {
    entries: computed(() => actions.value),

    undoable: computed(() => {
      // Newest first: the one Ctrl-Z would reach for, if it were bound.
      for (let at = actions.value.length - 1; at >= 0; at -= 1) {
        const action = actions.value[at]
        if (held(action)) return action
      }
      return null
    }),

    record(action) {
      /*
       * An action that changed nothing is not worth offering to undo, and it
       * would sit at the top of the stack shadowing the one somebody meant.
       */
      if (action.paths.length === 0) return

      /*
       * Recorded once. An id is a contribution, and the same contribution offered
       * twice is one thing that happened — a duplicate would sit at the top of the
       * stack shadowing the action somebody meant, and reverting it would drop both
       * entries at once.
       */
      if (actions.peek().some((each) => each.id === action.id)) return

      const next = [...actions.peek(), action]
      actions.value =
        next.length > depth ? next.slice(next.length - depth) : next
    },

    canRevert(actionId): ReadonlySignal<boolean> {
      return computed(() => {
        const action = actions.value.find((each) => each.id === actionId)
        if (action === undefined) return false
        /*
         * Asked of the change history rather than answered from a flag. A flag
         * would have to be invalidated by everything that can invalidate
         * history — a horizon, a file edited outside the app, a buffer closed —
         * and would be wrong the first time one of them was forgotten.
         */
        return action.paths.some(
          (path) =>
            inverseForContribution({
              applied: changeHistory.entries(path),
              contributionId: actionId,
            }).changes !== null
        )
      })
    },

    revert(actionId) {
      const action = actions.peek().find((each) => each.id === actionId)
      if (action === undefined) {
        return { reverted: [], missing: [], stranded: [] }
      }

      /*
       * The revert enters each buffer's own history, deliberately — see
       * `revertContribution`, where trying to keep it out was found to corrupt the
       * document on the next Ctrl-Z. So an action undone here can be put back with
       * one Ctrl-Z in the file it touched, which is also the more predictable
       * behaviour to explain.
       */
      const outcome = revertContribution({
        contributionId: actionId,
        paths: action.paths,
        changeHistory,
        bufferForPath,
      })

      /*
       * Dropped once undone, whatever the outcome. An action that was reverted is
       * not undoable again, and one that failed on every path is not going to
       * start working — leaving either in the list offers a button that does
       * nothing.
       */
      actions.value = actions.peek().filter((each) => each.id !== actionId)

      return outcome
    },

    forget(actionId) {
      actions.value = actions.peek().filter((each) => each.id !== actionId)
    },
  }
}
