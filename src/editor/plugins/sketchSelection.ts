import { Annotation } from '@codemirror/state'

// Marks CodeMirror selection transactions that were written by sketch solve.
const selectionDispatchedBySketchSolveAnnotation = Annotation.define<true>()

// The sketch selection listener checks for this marker before forwarding editor
// selection changes back into sketch solve. Without that check, clicking on a
// segment in sketch solve would:
// - update sketch-solve selection
// - write the selection into CodeMirror
// - trigger a second, unnecessary `refreshSelectionStyling` call
export const selectionDispatchedBySketchSolveEvent =
  selectionDispatchedBySketchSolveAnnotation.of(true)

export { selectionDispatchedBySketchSolveAnnotation }
