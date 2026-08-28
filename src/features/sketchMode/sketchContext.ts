import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import type { ExecutedProgram } from '@src/contracts/kclScene'
import type { SketchBlockRange } from '@src/lib/kclStdlib/program'
import { sketchBlockAt } from '@src/lib/kclStdlib/program'

/**
 * Where the text cursor is, and which program it addresses.
 *
 * `executing` is the only condition on it. An offset from another buffer
 * addresses this program's text by coincidence, and a cursor in `bracket.kcl`
 * must not put you inside a sketch in `main.kcl`.
 *
 * Focus deliberately does *not* gate this. It was tried, to make sketch mode
 * escapable, and it took the mode away from the case that needs it most: Start
 * sketch writes a block with the code panel closed, so there is no view to hold
 * focus and the sketch it just made would not count. Leaving is now something the
 * user says — a click on nothing, or Escape — rather than something inferred from
 * where the keyboard is.
 */
export interface SketchCursor {
  offset: number
  /** Whether the buffer holding it is the one being executed. */
  executing: boolean
}

/**
 * The sketch the user is in, if any.
 *
 * "In a sketch" is read from the file rather than remembered. There is no
 * enter-sketch-mode event to miss and no leave to forget: a selection is inside a
 * `sketch { … }` block or it is not, and the program says which. That is what
 * lets a mode be derived from state instead of maintained alongside it.
 *
 * The scene selection comes first, because clicking geometry is the more
 * deliberate act — the cursor is wherever it was left, and often left in the
 * middle of whatever was typed last.
 *
 * Offsets are compared against the program that was last *executed*, which lags
 * the buffer while somebody types. A sketch written a moment ago therefore
 * becomes a place to be one run later, which is why writing one has to be
 * followed by a run rather than by a mode change.
 */
export function sketchContextAt(
  program: ExecutedProgram | null,
  selection: readonly SourceRange[],
  cursor: SketchCursor | null
): SketchBlockRange | null {
  if (!program) return null

  for (const range of selection) {
    const found = sketchBlockAt(program.ast, range[0])
    if (found) return found
  }

  if (!cursor || !cursor.executing) return null

  /*
   * A cursor past the end of what was executed says nothing.
   *
   * The text has grown since the run, so the offset addresses a program that no
   * longer exists. Answering from it would put someone in a sketch because of
   * where a *different* file's braces were.
   */
  if (cursor.offset > program.source.length) return null

  return sketchBlockAt(program.ast, cursor.offset)
}
