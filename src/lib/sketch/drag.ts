import type {
  ApiObject,
  ApiObjectId,
  ApiPoint2d,
  ExistingSegmentCtor,
  Expr,
  Number as ApiNumber,
  SceneGraph,
  SegmentCtor,
  SegmentDragAnchor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import type { PlanePoint } from '@src/lib/scene/projection'
import { expr, roundOff } from '@src/lib/sketch/draft'
import { objectAt } from '@src/lib/sketch/sceneGraph'

/**
 * Moving geometry that is already in the sketch.
 *
 * The interesting half of dragging is not the pointer, it is *what to ask the
 * solver for*, and the existing app's `moveTool` is where that was worked out.
 * Three ideas, ported:
 *
 * 1. **A point is dragged to the cursor. A body is translated.** Grabbing the
 *    middle of a line means "move this line", so every point of it moves by the
 *    same vector — while grabbing an end means "put this end there".
 * 2. **A body also gets a drag anchor**, which is kcl-lib's own mechanism: a
 *    hidden fixed point the segment must pass through while solving. Without it
 *    a constrained segment cannot follow the cursor at all, because translating
 *    its points is a request the constraints are free to refuse; with it the
 *    solver slides the segment along its remaining freedom instead.
 * 3. **Coincident points move together.** A corner of a profile is several
 *    points at one place, and moving only the one under the cursor asks the
 *    solver to break the coincidence — which it can satisfy by moving the *other*
 *    segment instead, so the corner appears to tear.
 *
 * Pure, and given a graph rather than a service: everything here is arithmetic
 * over what the last solve produced.
 */

/** A vector in the plane. */
export interface PlaneVector {
  x: number
  y: number
}

/** What one drag step asks the frontend for. */
export interface DragPlan {
  /** New constructors for everything that moves. */
  edits: readonly ExistingSegmentCtor[]
  /**
   * Cursor points a segment body must pass through.
   *
   * Empty when a point is being dragged: a point *is* the position being asked
   * for, so there is nothing for the solver to slide along.
   */
  anchors: readonly SegmentDragAnchor[]
  /**
   * Segments to hold rigid for the duration of the solve.
   *
   * The dragged body is excluded — it is anchored instead — so this is what
   * stops the rest of an edited selection from being reshaped while one part of
   * it is pulled.
   */
  anchorSegmentIds: readonly ApiObjectId[]
}

const EMPTY_PLAN: DragPlan = { edits: [], anchors: [], anchorSegmentIds: [] }

/** The value of an expression, when it has one. */
const valueOf = (
  value: Expr
): { value: number; units: NumericSuffix } | null =>
  value.type === 'Variable' ? null : { value: value.value, units: value.units }

/**
 * A coordinate moved by a vector.
 *
 * `applyVectorToPoint2D`. A coordinate written as a *variable reference* rather
 * than a number cannot be moved by arithmetic — the number lives elsewhere — so
 * it is left exactly as it was rather than replaced with a guess.
 */
const shifted = (
  point: ApiPoint2d<Expr>,
  by: PlaneVector
): ApiPoint2d<Expr> => {
  const x = valueOf(point.x)
  const y = valueOf(point.y)
  if (!x || !y) return point

  return {
    x: { type: 'Var', value: roundOff(x.value + by.x), units: x.units },
    y: { type: 'Var', value: roundOff(y.value + by.y), units: y.units },
  }
}

/** A point's current position, as an expression pair the solver may move. */
function positionOf(
  graph: SceneGraph,
  pointId: ApiObjectId
): ApiPoint2d<Expr> | null {
  const object = objectAt(graph, pointId)
  if (object?.kind.type !== 'Segment') return null
  const segment = object.kind.segment
  if (segment.type !== 'Point') return null

  return {
    x: {
      type: 'Var',
      value: segment.position.x.value,
      units: segment.position.x.units,
    },
    y: {
      type: 'Var',
      value: segment.position.y.value,
      units: segment.position.y.units,
    },
  }
}

/**
 * The segment's constructor, from its own points.
 *
 * `buildSegmentCtorFromObject`. Read back out of the graph rather than taken
 * from the segment's stored `ctor`, because the stored one is what the *source*
 * says and the points are where the solver has since put them. Null when a
 * point is missing, which is a graph mid-renumbering rather than something to
 * paper over.
 */
export function ctorOf(
  graph: SceneGraph,
  object: ApiObject
): SegmentCtor | null {
  if (object.kind.type !== 'Segment') return null
  const segment = object.kind.segment

  switch (segment.type) {
    case 'Point': {
      const position = positionOf(graph, object.id)
      return position ? { type: 'Point', position } : null
    }

    case 'Line': {
      const start = positionOf(graph, segment.start)
      const end = positionOf(graph, segment.end)
      return start && end ? { type: 'Line', start, end } : null
    }

    case 'Arc': {
      const start = positionOf(graph, segment.start)
      const end = positionOf(graph, segment.end)
      const center = positionOf(graph, segment.center)
      if (!start || !end || !center) return null
      return {
        type: 'Arc',
        start,
        end,
        center,
        ...(segment.direction ? { direction: segment.direction } : {}),
      }
    }

    case 'Circle': {
      const start = positionOf(graph, segment.start)
      const center = positionOf(graph, segment.center)
      if (!start || !center) return null
      return {
        type: 'Circle',
        start,
        center,
        construction: segment.construction,
      }
    }

    case 'ControlPointSpline': {
      const points = segment.controls.map((id) => positionOf(graph, id))
      if (points.some((point) => point === null)) return null
      return {
        type: 'ControlPointSpline',
        points: points as ApiPoint2d<Expr>[],
        construction: segment.construction,
      }
    }
  }
}

/** The same constructor, translated. */
function translated(ctor: SegmentCtor, by: PlaneVector): SegmentCtor {
  switch (ctor.type) {
    case 'Point':
      return { ...ctor, position: shifted(ctor.position, by) }
    case 'Line':
      return {
        ...ctor,
        start: shifted(ctor.start, by),
        end: shifted(ctor.end, by),
      }
    case 'Arc':
      return {
        ...ctor,
        start: shifted(ctor.start, by),
        end: shifted(ctor.end, by),
        center: shifted(ctor.center, by),
      }
    case 'Circle':
      return {
        ...ctor,
        start: shifted(ctor.start, by),
        center: shifted(ctor.center, by),
      }
    case 'ControlPointSpline':
      return {
        ...ctor,
        points: ctor.points.map((point) => shifted(point, by)),
      }
  }
}

/**
 * Every point coincident with this one, however far the chain goes.
 *
 * `getCoincidentCluster`: a breadth-first walk of the coincidence constraints,
 * because coincidence is transitive and a closed profile's corner can be three
 * or four points deep.
 */
export function coincidentCluster(
  graph: SceneGraph,
  pointId: ApiObjectId
): readonly ApiObjectId[] {
  const found = new Set<ApiObjectId>([pointId])
  const pending: ApiObjectId[] = [pointId]

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue

    for (const object of graph.objects) {
      if (object?.kind.type !== 'Constraint') continue
      const constraint = object.kind.constraint
      if (constraint.type !== 'Coincident') continue

      const ids = constraint.segments.filter(
        (segment): segment is ApiObjectId => segment !== 'ORIGIN'
      )
      if (!ids.includes(current)) continue

      for (const id of ids) {
        if (found.has(id)) continue
        if (!isPoint(graph, id)) continue
        found.add(id)
        pending.push(id)
      }
    }
  }

  return [...found]
}

/** Whether an id names a standalone point in this graph. */
export const isPoint = (graph: SceneGraph, id: ApiObjectId): boolean => {
  const object = objectAt(graph, id)
  return object?.kind.type === 'Segment' && object.kind.segment.type === 'Point'
}

/**
 * Whether this object can be taken hold of.
 *
 * A line that belongs to something else cannot: its owner — a rectangle, say —
 * is what decides where it goes, and editing it directly would fight whatever
 * wrote it. The existing app refuses the same case by building no constructor
 * for it.
 */
export function isDraggable(graph: SceneGraph, id: ApiObjectId): boolean {
  const object = objectAt(graph, id)
  if (object?.kind.type !== 'Segment') return false

  const segment = object.kind.segment
  if (segment.type === 'Line' && segment.owner != null) return false

  return true
}

/**
 * What to ask for, to move one thing from where it was to where the pointer is.
 *
 * `from` is not where the drag started: it is where the last *accepted* solve
 * put the pointer. A refused solve leaves it behind, so the next move asks for
 * the whole distance again rather than for one frame of it — which is what stops
 * a rejected constraint from silently offsetting the pointer from the geometry
 * for the rest of the drag.
 */
export function planDrag(
  graph: SceneGraph,
  grabbed: {
    id: ApiObjectId
    from: PlanePoint
    to: PlanePoint
    units: NumericSuffix
  }
): DragPlan {
  const object = objectAt(graph, grabbed.id)
  if (object?.kind.type !== 'Segment') return EMPTY_PLAN
  if (!isDraggable(graph, grabbed.id)) return EMPTY_PLAN

  const by = {
    x: grabbed.to.x - grabbed.from.x,
    y: grabbed.to.y - grabbed.from.y,
  }

  /*
   * A point goes where the pointer is, not where the vector points.
   *
   * The two differ once a solve has been refused or has moved the point
   * somewhere other than where it was asked to go, and the pointer is the
   * authority on where the user wants it.
   */
  if (object.kind.segment.type === 'Point') {
    const cluster = coincidentCluster(graph, grabbed.id)

    return {
      edits: cluster.flatMap((id) => {
        if (id === grabbed.id) {
          return [
            {
              id,
              ctor: {
                type: 'Point' as const,
                position: {
                  x: expr(grabbed.to.x, grabbed.units),
                  y: expr(grabbed.to.y, grabbed.units),
                },
              },
            },
          ]
        }

        const ctor = ctorOf(graph, objectAt(graph, id) as ApiObject)
        return ctor ? [{ id, ctor: translated(ctor, by) }] : []
      }),
      anchors: [],
      anchorSegmentIds: [],
    }
  }

  const ctor = ctorOf(graph, object)
  if (!ctor) return EMPTY_PLAN

  return {
    edits: [{ id: grabbed.id, ctor: translated(ctor, by) }],
    anchors: anchorableKinds.has(object.kind.segment.type)
      ? [
          {
            segmentId: grabbed.id,
            target: {
              x: number(grabbed.to.x, grabbed.units),
              y: number(grabbed.to.y, grabbed.units),
            },
          },
        ]
      : [],
    anchorSegmentIds: [],
  }
}

/**
 * Which bodies kcl-lib will hold against a cursor point.
 *
 * Lines, arcs and circles. A spline is translated without one, which is the
 * existing app's behaviour and follows from what an anchor means: there is no
 * single curve for a control polygon to be held against.
 */
const anchorableKinds = new Set(['Line', 'Arc', 'Circle'])

/** A plain number in the frontend's shape, for the fields that are not exprs. */
const number = (value: number, units: NumericSuffix): ApiNumber => ({
  value: roundOff(value),
  units,
})
