import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { effect } from '@preact/signals'
import type { EditorCapability } from '@src/contracts/buffers'
import type { SelectionService } from '@src/contracts/selection'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { isTopLevel } from '@src/lib/kcl/artifacts'

/**
 * Show the code behind what was clicked.
 *
 * A binding rather than an extension, because it follows a service rather than
 * the document — and a binding survives the pane being closed, which is the
 * property this whole layer is built on.
 *
 * Only on the executing buffer. The artifact graph describes one program, and a
 * source range's third element says only whether it belongs to the main file —
 * so pointing a *different* buffer at an offset from this one would be a
 * confident guess at the wrong file.
 *
 * One direction only, on purpose. Cursor-to-selection is the other half and it
 * closes a loop: revealing sets the cursor, which would select, which would
 * reveal. That needs an origin to break it and is worth doing deliberately
 * rather than as a side effect of this.
 */
export function createSelectionRevealCapability(dependencies: {
  selection: () => SelectionService | undefined
}): EditorCapability {
  return {
    id: 'editor.selectionReveal',
    order: 30,
    appliesTo: (context) => context.executing,

    bind: (buffer) =>
      effect(() => {
        const entities = dependencies.selection()?.entities.value ?? []

        // The most recently added, which is what someone means by "the thing I
        // just clicked" when several are selected.
        const range = entities.at(-1)?.sourceRange
        if (!range) return

        /*
         * Only this file. The third element is the *module id*, and the
         * top-level module is zero — kcl-lib's own doc comment calls it
         * "whether the source range belongs to the 'main' file", which reads as
         * a boolean and is exactly backwards from what the Rust puts there.
         */
        if (!isTopLevel(range)) return
        const [from, to] = range

        const length = buffer.state.peek().doc.length
        if (from > length || to > length) return

        buffer.dispatch({
          selection: EditorSelection.range(from, to),
          effects: EditorView.scrollIntoView(from, { y: 'center' }),
          // Not an edit: no text changes, so persistence ignores it and history
          // never sees it.
          annotations: bufferOrigin.of('semantic'),
        })
      }),
  }
}
