import type { PlanePoint } from '@src/lib/scene/projection'
import type { DraftState } from '@src/lib/sketch/draft'
import type { SketchShape } from '@src/lib/sketch/drawing'
import type { SketchToolId } from '@src/lib/sketch/tools'

/**
 * The one thing drawn in a sketch that is not the solver's answer.
 *
 * Everything else on screen comes from the graph: the rubber band is a real
 * segment, moved by a preview solve on every pointer event, so what is drawn is
 * always what the solver would give you. That is the arrangement worth
 * protecting, and this is the narrow exception to it.
 *
 * The exception exists because some shapes cannot be written from one click. A
 * circle of no radius has no rim point for the solver to hold an opinion about,
 * so between the centre click and the rim click there is nothing in the sketch —
 * and therefore nothing the solver could be asked. Drawing the shape-to-be from
 * the collected clicks and the pointer is the only honest option, and it is what
 * the existing app does for the same shapes.
 *
 * Kept as far away from the real geometry as possible: it produces shapes with a
 * sentinel id, it is only ever drawn as a draft, and nothing picks or snaps to
 * it.
 */

/**
 * The id every preview shape carries.
 *
 * Negative, so it cannot collide with a real one: the graph is a flat array and
 * an object's id *is* its index. Anything that looks it up finds nothing, which
 * is what makes a preview unpickable and undraggable for free.
 */
export const PREVIEW_ID = -1

const base = {
  id: PREVIEW_ID,
  construction: false,
  /** Never constrained: it is not in the sketch, so it has no freedom to report. */
  freedom: null,
} as const

/**
 * What to draw for a shape that has been started but not written.
 *
 * Empty for every state that has real geometry to show, which is most of them —
 * a line being dragged open is a segment in the sketch and is drawn from the
 * graph like anything else.
 */
export function previewShapes(
  state: DraftState,
  tool: SketchToolId | null,
  pointer: PlanePoint | null
): readonly SketchShape[] {
  if (state.kind !== 'pending' || !pointer) return []

  const [start] = state.points
  if (!start) return []

  switch (tool) {
    case 'circle': {
      const radius = Math.hypot(pointer.x - start.x, pointer.y - start.y)
      if (radius <= 0) return []
      return [{ ...base, kind: 'circle', center: start, radius }]
    }

    default:
      return []
  }
}
