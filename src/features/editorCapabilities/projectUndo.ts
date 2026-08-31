import { undoDepth } from '@codemirror/commands'
import type { StateCommand } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { EditorCapability } from '@src/contracts/buffers'
import type { ProjectActionHistory } from '@src/contracts/projectHistory'
import { projectActionToUndo } from '@src/lib/collab/projectUndo'

export interface ProjectUndoDependencies {
  /** Absent in a build with no project history, which changes nothing. */
  history: () => ProjectActionHistory | null
  /**
   * The buffer's path as the project names it, from its absolute one.
   *
   * Asked at keystroke time rather than captured with the extension: a buffer
   * can be renamed while it is open, and the structural context that built the
   * extension is deliberately not rebuilt for something that volatile.
   */
  relativePathFor: (absolutePath: string) => string | null
}

/**
 * `Ctrl-Z`, when the newest thing to undo is a project action.
 *
 * A modelling operation or an agent turn can write three files, and CodeMirror's
 * history is per `EditorState` — so undoing one is three undo stacks and three
 * keystrokes, in three panes, and the middle one leaves the project in a state
 * nothing asked for. This is the extension that makes one keystroke undo the
 * whole thing.
 *
 * **The precedence question, and how it is answered without reading history
 * internals.** The obvious test — "is the buffer's newest transaction part of the
 * action?" — is wrong, because undoing the user's own typing is *itself* a
 * transaction: after it, the newest transaction is an undo, while the thing the
 * next Ctrl-Z would actually reach is the action. The question is about position
 * in the stack, not about what happened last, and `undoDepth` is the only public
 * answer to it. So the action records its depth when it lands, and this compares.
 *
 * Verified rather than assumed, because the whole binding rests on it: an action
 * dispatched with `isolateHistory.of('full')` sits at depth 1; the user's typing
 * takes it to 2 (further keystrokes join that group); one undo returns it to 1,
 * with the action once again on top. So the comparison recovers exactly the
 * moments when Ctrl-Z would have undone the action's own edit — and at every
 * other moment it declines and the buffer behaves normally.
 *
 * **What this deliberately does not do.** Pressing Ctrl-Z *again*, right after a
 * project revert, is an ordinary buffer undo of the revert — so it puts the
 * action back in this file only. The revert has to enter buffer history (keeping
 * it out corrupts the document — see `revertContribution`), which means the
 * buffer's linear stack now contains a there-and-back-again that project history
 * cannot collapse. Making that second keystroke project-wide too was tried on
 * paper and rejected: it makes repeated Ctrl-Z alternate between undo and redo
 * forever instead of walking backwards, which is worse than a transient
 * half-restored file that the third keystroke resolves.
 */
export function createProjectUndoCapability(
  dependencies: ProjectUndoDependencies
): EditorCapability {
  const { history, relativePathFor } = dependencies

  return {
    id: 'editor.projectUndo',
    /*
     * Ahead of `editor.baseline`, which is where `historyKeymap` lives. Lower
     * order is earlier in the resolved array and CodeMirror gives earlier
     * extensions higher precedence, so this handler is offered the keystroke
     * first and returning `false` hands it straight to `undo`.
     */
    order: -1,
    appliesTo: (context) => context.path !== null && !context.readOnly,
    extension: (context) => {
      const absolute = context.path
      if (absolute === null) return []

      return keymap.of([
        {
          key: 'Mod-z',
          run: projectUndoCommand({ history, relativePathFor, absolute }),
        },
      ])
    },
  }
}

/**
 * The command, separately, so it can be run without a mounted view.
 *
 * A `StateCommand` rather than a `Command` for the same reason `undo` is one:
 * it needs the state and a dispatch, nothing about the DOM, and that makes it
 * runnable through `buffer.runCommand` in a test.
 */
export function projectUndoCommand(input: {
  history: () => ProjectActionHistory | null
  relativePathFor: (absolutePath: string) => string | null
  absolute: string
}): StateCommand {
  const { history, relativePathFor, absolute } = input

  return ({ state }) => {
    const projectHistory = history()
    const action = projectActionToUndo({
      history: projectHistory,
      path: relativePathFor(absolute),
      undoDepth: undoDepth(state),
    })
    if (action === null || projectHistory === null) return false

    /*
     * Dispatched by the revert itself, into every buffer the action touched —
     * including this one, which is why nothing is dispatched here. Returning
     * `true` is what stops `undo` from also running and undoing the revert we
     * just applied.
     */
    projectHistory.revert(action.id)
    return true
  }
}
