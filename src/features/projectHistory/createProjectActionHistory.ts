import { undoDepth } from '@codemirror/commands'
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

  /**
   * Where each action sits in each buffer's undo stack, `actionId → path → depth`.
   *
   * Kept beside the actions rather than on them: a `ProjectAction` is a label
   * that gets rendered and persisted, and this is a fact about one live
   * `EditorState` that stops being true the moment the buffer is closed.
   */
  const depths = new Map<string, Map<string, number>>()

  const forgetDepths = (actionId: string) => {
    depths.delete(actionId)
  }

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

      /*
       * Where the action landed in each buffer's undo stack, captured now.
       *
       * Now, because it can only be read from a live `EditorState` and it is only
       * meaningful immediately after the dispatches: this runs directly after the
       * writer finished writing, and every writer already dispatches with
       * `isolateHistory.of('full')`, so the action owns exactly one group and this
       * is its depth.
       *
       * A writer that types something between its last dispatch and this call
       * records a depth one too low, and `undoTargetFor` then declines — Ctrl-Z
       * falls back to the buffer, which is the safe direction to be wrong in.
       */
      const perPath = new Map<string, number>()
      for (const path of action.paths) {
        const buffer = bufferForPath(path)
        if (buffer === undefined) continue
        perPath.set(path, undoDepth(buffer.state.peek()))
      }
      depths.set(action.id, perPath)

      const next = [...actions.peek(), action]
      const trimmed =
        next.length > depth ? next.slice(next.length - depth) : next
      for (const dropped of next.slice(0, next.length - trimmed.length)) {
        forgetDepths(dropped.id)
      }
      actions.value = trimmed
    },

    undoTargetFor(path, currentDepth) {
      /*
       * Zero means the buffer has nothing to undo — or has no history extension
       * at all, in which case every action would match and Ctrl-Z would revert
       * something the user cannot see the stack for. Declining is right for both.
       */
      if (currentDepth === 0) return null

      /*
       * The newest action *that touched this buffer*, not the newest action
       * overall. Ctrl-Z is a question about the file somebody is looking at, and
       * an action that changed a different file is not the answer to it — while
       * the newest one here, undone completely, is.
       */
      for (let at = actions.value.length - 1; at >= 0; at -= 1) {
        const action = actions.value[at]
        if (!action.paths.includes(path)) continue
        if (depths.get(action.id)?.get(path) !== currentDepth) return null
        return held(action) ? action : null
      }
      return null
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
      forgetDepths(actionId)

      return outcome
    },

    forget(actionId) {
      actions.value = actions.peek().filter((each) => each.id !== actionId)
      forgetDepths(actionId)
    },
  }
}
