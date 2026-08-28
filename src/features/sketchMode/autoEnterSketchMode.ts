import { type ReadonlySignal, effect } from '@preact/signals'
import type { SketchBlockRange } from '@src/lib/kclStdlib/program'

export interface AutoEnterSketchModeDependencies {
  /** The sketch the selection is in, or null. */
  sketch: ReadonlySignal<SketchBlockRange | null>
  /** Whether the mode is already the sketching one. */
  sketching: ReadonlySignal<boolean>
  /**
   * Whether the keystrokes are going somewhere else.
   *
   * A DOM fact, checked at the moment of the decision rather than tracked: the
   * element that has focus is the only thing that reliably knows.
   */
  isTyping: () => boolean
  enter: () => void
}

/**
 * Follow the user into a sketch.
 *
 * Selecting something inside a sketch *is* the request to edit that sketch, so
 * asking for the mode as well would be asking twice. This is also what makes a
 * future "Start sketch" tool complete in one step: it writes a sketch block and
 * selects it, and the mode follows from the file.
 *
 * Entering is treated as an event rather than a state, which is the difference
 * between helpful and insufferable. Moving into a *different* sketch enters;
 * being in one already does not. So someone who switches to Model while their
 * cursor sits in a sketch stays in Model, instead of being dragged back on the
 * next repaint.
 *
 * Never while something else is taking keystrokes. Typing in the command palette
 * while a sketch happens to be selected is not a request to change mode, and a
 * toolbar that rearranges itself under an open palette is a toolbar that moved
 * the button somebody was about to click.
 */
export function autoEnterSketchMode(
  dependencies: AutoEnterSketchModeDependencies
): () => void {
  const { sketch, sketching, isTyping, enter } = dependencies

  let enteredFor: string | null = null

  return effect(() => {
    const current = sketch.value

    if (!current) {
      // Leaving means the next arrival is a new event, including a return to the
      // same sketch.
      enteredFor = null
      return
    }

    if (current.name === enteredFor) return
    if (sketching.value) {
      // Already there — whether by this or by hand. Record it, so leaving and
      // returning is what enters again.
      enteredFor = current.name
      return
    }
    if (isTyping()) return

    enteredFor = current.name
    enter()
  })
}

/**
 * Whether keystrokes are going into a field rather than into the app.
 *
 * The code editor is excluded on purpose: a cursor moved into a sketch block *is*
 * the signal this feature exists to follow, and the editor is where that happens.
 * What this is for is the command palette, a rename field, an argument prompt —
 * transient inputs where a mode change would move the ground underneath someone
 * mid-sentence.
 */
export function isTypingOutsideTheEditor(): boolean {
  const element = document.activeElement
  if (!(element instanceof HTMLElement)) return false
  if (element.closest('.cm-editor')) return false

  return element.matches('input, textarea, select') || element.isContentEditable
}
