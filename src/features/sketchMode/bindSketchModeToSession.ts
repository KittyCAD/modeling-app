import { type ReadonlySignal, effect } from '@preact/signals'

export interface SketchModeBindingDependencies {
  /** Whether the scene's active mode is the sketching one. */
  sketching: ReadonlySignal<boolean>
  /** Whether a sketch is open for editing. */
  open: ReadonlySignal<boolean>
  /** Open the sketch the user is in. */
  enter: () => Promise<void>
  /** Write it back, which runs the program. */
  exit: () => Promise<void>
  /** Land back in the mode you start in. */
  leaveMode: () => void
}

/**
 * Sketch mode *is* an open sketch.
 *
 * They were two things, and the split did not survive contact with the app: the
 * mode was derived from where the cursor was and cost nothing, the session had
 * to be opened deliberately and cost an execution — so Sketch mode could be
 * entered without a session, and every tool it showed was dead. A mode whose
 * buttons are all greyed out is not a mode, it is a mistake somebody is looking
 * at.
 *
 * So the two are kept in step here, and the useful half of the distinction moves
 * to *availability*: being in a sketch is what makes the mode reachable, and
 * entering it is what opens the sketch. Selection no longer enters anything,
 * which it should never have done once entering cost a real execution.
 *
 * **Edges, not levels.** Every rule here fires on a change rather than on a
 * state, and that is what stops the two chasing each other: finishing a sketch
 * leaves the mode, and leaving the mode does *not* then reopen the sketch,
 * because the mode was not just entered. Written as levels this is an infinite
 * loop, and a plausible-looking one.
 */
export function bindSketchModeToSession(
  dependencies: SketchModeBindingDependencies
): () => void {
  const { sketching, open, enter, exit, leaveMode } = dependencies

  let wasSketching = sketching.peek()
  let wasOpen = open.peek()
  /** Set when opening failed, so a mode we cannot honour is not retried. */
  let refused = false

  return effect(() => {
    const nowSketching = sketching.value
    const nowOpen = open.value

    const entered = nowSketching && !wasSketching
    const left = !nowSketching && wasSketching
    const closed = !nowOpen && wasOpen

    wasSketching = nowSketching
    wasOpen = nowOpen

    // A fresh arrival is allowed to try again.
    if (entered) refused = false

    if (entered && !nowOpen && !refused) {
      void enter().then(() => {
        /*
         * Opening can fail — nothing has run yet, the cursor is not where it was
         * — and the mode must not be left standing without a sketch behind it.
         * That state is the whole thing this file exists to make impossible.
         */
        if (open.peek()) return
        refused = true
        leaveMode()
      })
      return
    }

    if (left && nowOpen) {
      void exit()
      return
    }

    /*
     * Finished from inside: the sketch was written back and the mode has nothing
     * left to be about.
     */
    if (closed && nowSketching) leaveMode()
  })
}
