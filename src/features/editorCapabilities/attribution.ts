import { RangeSet, RangeValue, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { cssVar, tokens } from '@kittycad/ui-kit/tokens'
import type { EditorCapability } from '@src/contracts/buffers'
import { originOf } from '@src/lib/buffers/annotations'

/** One collaborator's claim on a stretch of text. */
class AuthorMark extends RangeValue {
  constructor(readonly author: string) {
    super()
  }

  override eq(other: AuthorMark) {
    return other.author === this.author
  }
}

/**
 * Who wrote which stretch of the document.
 *
 * Held in a `StateField` and mapped through every transaction's changes, so a
 * mark follows the text it belongs to as the user edits around it. That is the
 * whole reason the identity rides on the transaction annotation rather than in a
 * side table: the field sees it with no extra plumbing, and a side table would
 * have to be told about every edit separately and would drift the first time
 * somebody forgot.
 *
 * **Volatile, not structural.** It changes on every keystroke, and
 * `BufferStructuralContext` is explicitly not for that — a volatile value in the
 * structural context rebuilds the whole capability bundle on every edit, and
 * there is a test asserting typing never does that.
 *
 * **Not persisted.** Attribution is a session-lifetime fact. Storing per-file
 * ranges would be a second durability design, and it is not worth opening one
 * for a gutter.
 */
const attributionField = StateField.define<RangeSet<AuthorMark>>({
  create: () => RangeSet.empty,

  update(marks, transaction) {
    /*
     * Follow the text first, so existing marks are in the new document's
     * coordinates before anything is added — then drop the ones that collapsed.
     *
     * `map` does not remove a range whose text was deleted; it returns a
     * zero-length range at the deletion point. Left in, that draws a stripe on a
     * line the writer no longer wrote anything on, which is worse than no
     * attribution: it claims something false about somebody's file.
     */
    let next = marks
      .map(transaction.changes)
      .update({ filter: (from, to) => to > from })

    const author = originOf(transaction).author
    if (author === undefined || !transaction.docChanged) return next

    /*
     * `fromB`/`toB` are the inserted range in the *new* document, which is what a
     * mark has to be placed against. A zero-length range is a pure deletion:
     * nothing was written, so there is nothing to attribute.
     */
    const added: { from: number; to: number; value: AuthorMark }[] = []
    transaction.changes.iterChanges((_fromA, _toA, fromB, toB) => {
      if (toB > fromB)
        added.push({ from: fromB, to: toB, value: new AuthorMark(author) })
    })
    if (added.length === 0) return next

    next = next.update({ add: added, sort: true })
    return next
  },
})

/** The marks currently held for a document, for presence and for tests. */
export function authoredRanges(
  state: { field: (field: typeof attributionField) => RangeSet<AuthorMark> },
  author?: string
): { from: number; to: number; author: string }[] {
  const found: { from: number; to: number; author: string }[] = []
  const cursor = state.field(attributionField).iter()

  while (cursor.value !== null) {
    if (author === undefined || cursor.value.author === author) {
      found.push({
        from: cursor.from,
        to: cursor.to,
        author: cursor.value.author,
      })
    }
    cursor.next()
  }

  return found
}

/**
 * Draw the marks.
 *
 * A line decoration rather than a gutter marker: a remote edit is usually whole
 * statements, the question worth answering at a glance is "which lines are not
 * mine", and a per-line mark answers it without competing with the diagnostics
 * gutter for space.
 */
const attributionDecorations = EditorView.decorations.compute(
  [attributionField],
  (state) => {
    const marks = state.field(attributionField)
    if (marks.size === 0) return Decoration.none

    const lines = new Set<number>()
    const cursor = marks.iter()
    while (cursor.value !== null) {
      const first = state.doc.lineAt(cursor.from).number
      const last = state.doc.lineAt(
        Math.min(cursor.to, state.doc.length)
      ).number
      for (let line = first; line <= last; line += 1) lines.add(line)
      cursor.next()
    }

    const decorations = [...lines]
      .sort((left, right) => left - right)
      .map((line) =>
        Decoration.line({ class: 'zds-attributed' }).range(
          state.doc.line(line).from
        )
      )

    return Decoration.set(decorations)
  }
)

/**
 * The stripe itself.
 *
 * A datum stripe in the accent colour, the same motif the rest of the app uses to
 * mark "this row is the one in play" — a tree row, the active buffer tab, the
 * conversation you are talking to. Reusing it here says *somebody else wrote
 * this* in a vocabulary the app has already taught.
 *
 * Deliberately not a background tint: the editor's background carries selection
 * and search highlighting already, and a third meaning competing for it would
 * make all three harder to read.
 */
const attributionTheme = EditorView.theme({
  '.zds-attributed': {
    boxShadow: `inset ${cssVar(tokens.size.datumStripe)} 0 0 0 ${cssVar(
      tokens.accent
    )}`,
  },
})

/**
 * Mark text a remote collaborator wrote.
 *
 * Contributed to every buffer rather than only KCL ones: a collaborator can edit
 * anything in the project, and a file whose attribution silently stopped working
 * because of its extension would be worse than none.
 */
const attributionExtension = [
  attributionField,
  attributionDecorations,
  attributionTheme,
]

export const attributionCapability: EditorCapability = {
  id: 'editor.attribution',
  order: 7,
  /*
   * One constant, returned as-is. The extension must not depend on the context,
   * because a capability whose extension differs between calls asks the buffer
   * to reconfigure — and a value that changes per edit in the structural context
   * would rebuild the whole bundle on every keystroke.
   */
  extension: () => attributionExtension,
}

export { attributionField }
