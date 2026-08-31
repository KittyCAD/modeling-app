import type {
  ApiConstraint,
  ApiObjectId,
  ExistingSegmentCtor,
  SceneGraph,
  SegmentCtor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import type { PlanePoint } from '@src/lib/scene/projection'
import { expr } from '@src/lib/sketch/draft'
import { objectAt } from '@src/lib/sketch/sceneGraph'

/**
 * A rectangle, which is four lines and eight constraints.
 *
 * The only tool so far whose shape is not a segment. It is worth saying why it is
 * built this way rather than as one: the frontend has no rectangle, and it should
 * not — a rectangle is four lines that are *described* as a rectangle, and the
 * description is the constraints. Written any other way it would be four lines
 * that merely happen to look square, and the first drag would prove it.
 *
 * So the eight are load-bearing, and each says something different:
 *
 *  - four **coincidences**, corner to corner, which make it a closed loop rather
 *    than four separate edges;
 *  - two **parallels**, one per pair of opposite sides;
 *  - one **perpendicular**, between two adjacent sides, which is what makes the
 *    corners square;
 *  - one **horizontal**, on the top, which pins the orientation.
 *
 * Ported from `rectUtils.ts`, including which lines each constraint names. The
 * set is not unique — several combinations would hold the same shape — and this
 * is the one the existing app's sketches contain, so a file drawn in one app
 * reads the same in the other.
 *
 * The layout the ids follow:
 *
 * ```
 *   start4, end3      start3, end2
 *         o----line3----o
 *         |             |
 *       line4         line2
 *         |             |
 *         o----line1----o
 *   start1, end4      start2, end1
 * ```
 */

/** The corners, anticlockwise from the origin one. */
export interface RectangleCorners {
  start1: PlanePoint
  start2: PlanePoint
  start3: PlanePoint
  start4: PlanePoint
}

/** What a built rectangle left behind. */
export interface RectangleDraft {
  /** In drawing order, which is the order `cornerEdits` re-specifies them in. */
  lineIds: readonly ApiObjectId[]
  /** Everything created, for throwing the whole thing away again. */
  segmentIds: readonly ApiObjectId[]
  constraintIds: readonly ApiObjectId[]
}

/**
 * How big a rectangle is before it has been dragged out.
 *
 * Small but not zero: the solver is asked to satisfy eight constraints on it the
 * moment it exists, and a degenerate rectangle has no orientation for the
 * horizontal and the perpendicular to hold. The existing app's minimum draft
 * delta, for the same reason.
 */
const INITIAL_SIZE = 0.01

/** And for a centred one, which is drawn outwards from the click. */
const INITIAL_HALF_SIZE = 5

const corners = (min: PlanePoint, max: PlanePoint): RectangleCorners => ({
  start1: { x: min.x, y: min.y },
  start2: { x: max.x, y: min.y },
  start3: { x: max.x, y: max.y },
  start4: { x: min.x, y: max.y },
})

/** Where a rectangle starts, before the pointer has said how big it is. */
export function initialCorners(
  origin: PlanePoint,
  mode: RectangleMode
): RectangleCorners {
  if (mode === 'centerRectangle') {
    return corners(
      { x: origin.x - INITIAL_HALF_SIZE, y: origin.y - INITIAL_HALF_SIZE },
      { x: origin.x + INITIAL_HALF_SIZE, y: origin.y + INITIAL_HALF_SIZE }
    )
  }

  return corners(origin, {
    x: origin.x + INITIAL_SIZE,
    y: origin.y + INITIAL_SIZE,
  })
}

export type RectangleMode = 'cornerRectangle' | 'centerRectangle'

/**
 * Where the corners are, for a pointer at `point`.
 *
 * A corner rectangle keeps the *clicked* corner as `start1` even when the drag
 * crosses into another quadrant, rather than re-sorting the corners into
 * min/max. The existing app does this deliberately: anything constrained to that
 * corner — a snap, most often — should stay on the corner the user picked rather
 * than jumping to whichever one is now bottom-left.
 */
export function cornersFor(
  mode: RectangleMode,
  origin: PlanePoint,
  point: PlanePoint
): RectangleCorners {
  if (mode === 'centerRectangle') {
    const halfWidth = Math.abs(point.x - origin.x)
    const halfHeight = Math.abs(point.y - origin.y)
    return corners(
      { x: origin.x - halfWidth, y: origin.y - halfHeight },
      { x: origin.x + halfWidth, y: origin.y + halfHeight }
    )
  }

  return {
    start1: origin,
    start2: { x: point.x, y: origin.y },
    start3: point,
    start4: { x: origin.x, y: point.y },
  }
}

const line = (
  from: PlanePoint,
  to: PlanePoint,
  units: NumericSuffix
): SegmentCtor => ({
  type: 'Line',
  start: { x: expr(from.x, units), y: expr(from.y, units) },
  end: { x: expr(to.x, units), y: expr(to.y, units) },
})

/** The four sides, in drawing order, for a set of corners. */
export const sidesOf = (
  at: RectangleCorners,
  units: NumericSuffix
): readonly SegmentCtor[] => [
  line(at.start1, at.start2, units),
  line(at.start2, at.start3, units),
  line(at.start3, at.start4, units),
  line(at.start4, at.start1, units),
]

/** Re-specifying the four sides, which is what a drag of the rectangle is. */
export function cornerEdits(
  draft: RectangleDraft,
  at: RectangleCorners,
  units: NumericSuffix
): readonly ExistingSegmentCtor[] {
  const sides = sidesOf(at, units)

  return draft.lineIds.flatMap((id, index) => {
    const ctor = sides[index]
    return ctor ? [{ id, ctor }] : []
  })
}

/** The two ends of a line that is already in the graph. */
function endsOf(
  graph: SceneGraph,
  id: ApiObjectId
): { start: ApiObjectId; end: ApiObjectId } | null {
  const object = objectAt(graph, id)
  if (object?.kind.type !== 'Segment') return null
  const segment = object.kind.segment
  if (segment.type !== 'Line') return null

  return { start: segment.start, end: segment.end }
}

/**
 * The eight constraints that make four lines a rectangle.
 *
 * Given the ids of the four lines and the graph they now live in, because the
 * coincidences are between *points* and only the graph knows which points those
 * lines ended up with.
 */
export function rectangleConstraints(
  graph: SceneGraph,
  lineIds: readonly ApiObjectId[]
): readonly ApiConstraint[] {
  const [line1, line2, line3, line4] = lineIds
  if (
    line1 === undefined ||
    line2 === undefined ||
    line3 === undefined ||
    line4 === undefined
  ) {
    return []
  }

  const ends = [line1, line2, line3, line4].map((id) => endsOf(graph, id))
  const [first, second, third, fourth] = ends
  if (!first || !second || !third || !fourth) return []

  return [
    // Close the loop: each line's end meets the next line's start.
    { type: 'Coincident', segments: [first.end, second.start] },
    { type: 'Coincident', segments: [second.end, third.start] },
    { type: 'Coincident', segments: [third.end, fourth.start] },
    { type: 'Coincident', segments: [fourth.end, first.start] },
    // Opposite sides stay opposite.
    { type: 'Parallel', lines: [line2, line4] },
    { type: 'Parallel', lines: [line3, line1] },
    // One right angle, which the parallels make into four.
    { type: 'Perpendicular', lines: [line1, line2] },
    // And an orientation, so the rectangle cannot rotate as it is dragged.
    { type: 'Horizontal', line: line3 },
  ]
}

/**
 * What building a rectangle needs from the frontend.
 *
 * A port rather than the service, so the sequence can be tested without WASM —
 * and so this file stays about *what* a rectangle is rather than about who holds
 * the session.
 */
export interface RectangleWriter {
  addSegment(
    sketchId: ApiObjectId,
    segment: SegmentCtor,
    options?: { label?: string; checkpoint?: boolean }
  ): Promise<WrittenOutcome>
  addConstraint(
    sketchId: ApiObjectId,
    constraint: ApiConstraint,
    options?: { checkpoint?: boolean }
  ): Promise<WrittenOutcome>
}

/** As much of a mutation's answer as building a rectangle reads. */
export interface WrittenOutcome {
  /** The whole file, as the frontend would now write it. */
  text: string
  graph: SceneGraph
  newObjects: readonly ApiObjectId[]
  /** Carried through so the caller can drop what it was holding. */
  invalidatesIds: boolean
}

/** The label the existing app gives a rectangle's sides. */
export const RECTANGLE_SEGMENT_LABEL = 'rectangle-segment'

const lastOf = (
  graph: SceneGraph,
  newObjects: readonly ApiObjectId[],
  wanted: 'Segment' | 'Constraint'
): ApiObjectId | null => {
  for (const id of [...newObjects].reverse()) {
    if (objectAt(graph, id)?.kind.type === wanted) return id
  }
  return null
}

/**
 * Write the four lines, then the eight constraints.
 *
 * In that order and not interleaved, because a constraint names the *points* the
 * lines ended up with, and those only exist once the lines do. Each call is
 * awaited for the same reason: the frontend holds one copy of the file, so two
 * in flight would each answer with a file that does not contain the other's
 * work.
 *
 * Checkpointed once, on the last call. The eight constraints and the four lines
 * are one thing somebody did and should be one thing to undo.
 *
 * Null when a line did not come back. A rectangle missing a side is not
 * something to carry on building constraints against — the ids would name the
 * wrong objects.
 */
export async function buildRectangle(
  writer: RectangleWriter,
  sketchId: ApiObjectId,
  origin: PlanePoint,
  mode: RectangleMode,
  units: NumericSuffix
): Promise<{ draft: RectangleDraft; outcome: WrittenOutcome } | null> {
  const lineIds: ApiObjectId[] = []
  const segmentIds: ApiObjectId[] = []
  let last: WrittenOutcome | null = null

  for (const side of sidesOf(initialCorners(origin, mode), units)) {
    const outcome = await writer.addSegment(sketchId, side, {
      label: RECTANGLE_SEGMENT_LABEL,
      checkpoint: false,
    })
    last = outcome

    const lineId = lastOf(outcome.graph, outcome.newObjects, 'Segment')
    if (lineId === null) return null

    lineIds.push(lineId)
    segmentIds.push(
      ...outcome.newObjects.filter(
        (id) => objectAt(outcome.graph, id)?.kind.type === 'Segment'
      )
    )
  }

  if (!last) return null

  const constraints = rectangleConstraints(last.graph, lineIds)
  const constraintIds: ApiObjectId[] = []

  for (const [index, constraint] of constraints.entries()) {
    const outcome = await writer.addConstraint(sketchId, constraint, {
      checkpoint: index === constraints.length - 1,
    })
    last = outcome

    const id = lastOf(outcome.graph, outcome.newObjects, 'Constraint')
    if (id !== null) constraintIds.push(id)
  }

  /*
   * The last answer, and only the last.
   *
   * Every call hands back the whole file, so writing each one would put twelve
   * edits and twelve undo entries into the buffer for one rectangle. The last
   * contains all of them.
   */
  return { draft: { lineIds, segmentIds, constraintIds }, outcome: last }
}
