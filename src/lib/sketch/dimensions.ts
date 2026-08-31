import type {
  ApiConstraint,
  ApiObjectId,
  ConstraintSegment,
  Number as ApiNumber,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { NumericSuffix } from '@rust/kcl-lib/bindings/NumericSuffix'
import type { SketchSelectionId } from '@src/contracts/sketchSession'
import { millimetres } from '@src/lib/kcl/units'
import type { PlanePoint } from '@src/lib/scene/projection'
import { classify } from '@src/lib/sketch/constraints'
import { roundOff } from '@src/lib/sketch/draft'
import { objectAt, pointAt } from '@src/lib/sketch/sceneGraph'

/**
 * Dimensions: the constraints that carry a number.
 *
 * A dimension is an ordinary constraint to kcl-lib — `Distance` and `Angle` sit
 * in the same union as `Parallel` — and the difference is that it has a *value*,
 * which is a thing to read and to edit. Which is why it earns a module: the
 * value has to be measured off the current geometry before it can be asked for,
 * and what kind of dimension a selection means is decided by what was picked.
 *
 * Ported from `dimensionTool.ts`, narrowed to what applies without a live label
 * drag. The existing app decides between an absolute distance, a horizontal one
 * and a vertical one by *where the label is dropped* — above two points means
 * their horizontal separation, beside them means the vertical one — which needs a
 * phase this does not have yet. Absolute distance is what it falls back to there
 * too, so a dimension applied here is one the existing app would also produce;
 * it is the two axis-aligned variants that are not reachable.
 */

/**
 * A position for drawing, rather than for writing.
 *
 * Everything measured here stays in the *file's* unit, because that is what a
 * constraint's value and its label position are written in. A position handed to
 * whoever draws it has to be millimetres instead, which is the unit the plane
 * frame and the camera are in — so the conversion happens at that boundary and
 * nowhere else.
 */
const forDrawing = (at: PlanePoint, units: NumericSuffix): PlanePoint => ({
  x: millimetres(at.x, units),
  y: millimetres(at.y, units),
})

/** Angles are always written in degrees, whatever the file's length unit is. */
const ANGLE_UNITS: NumericSuffix = 'Deg'

const number = (value: number, units: NumericSuffix): ApiNumber => ({
  value: roundOff(value),
  units,
})

const asSegment = (id: SketchSelectionId): ConstraintSegment =>
  id === 'origin' ? 'ORIGIN' : id

/** Where a selected point is, in the plane. Origin included. */
function positionOf(
  graph: SceneGraph,
  id: SketchSelectionId
): PlanePoint | null {
  if (id === 'origin') return { x: 0, y: 0 }

  const point = pointAt(graph, id)
  return point ? { x: point.x, y: point.y } : null
}

/** The two ends of a selected line. */
function endsOf(
  graph: SceneGraph,
  id: ApiObjectId
): [PlanePoint, PlanePoint] | null {
  const object = objectAt(graph, id)
  if (object?.kind.type !== 'Segment') return null
  const segment = object.kind.segment
  if (segment.type !== 'Line') return null

  const start = positionOf(graph, segment.start)
  const end = positionOf(graph, segment.end)
  return start && end ? [start, end] : null
}

const subtract = (a: PlanePoint, b: PlanePoint): PlanePoint => ({
  x: a.x - b.x,
  y: a.y - b.y,
})

const middle = (a: PlanePoint, b: PlanePoint): PlanePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})

const magnitude = (vector: PlanePoint) => Math.hypot(vector.x, vector.y)

const cross = (a: PlanePoint, b: PlanePoint) => a.x * b.y - a.y * b.x

/** How far a point is from an infinite line. */
function distanceToLine(
  point: PlanePoint,
  line: [PlanePoint, PlanePoint]
): number | null {
  const along = subtract(line[1], line[0])
  const length = magnitude(along)
  if (length === 0) return null

  return Math.abs(cross(along, subtract(point, line[0]))) / length
}

/** Below this two lines are treated as pointing the same way. */
const PARALLEL_EPSILON = 1e-6

const areParallel = (
  first: [PlanePoint, PlanePoint],
  second: [PlanePoint, PlanePoint]
) => {
  const a = subtract(first[1], first[0])
  const b = subtract(second[1], second[0])
  const lengths = magnitude(a) * magnitude(b)
  if (lengths === 0) return false

  return Math.abs(cross(a, b)) / lengths < PARALLEL_EPSILON
}

/**
 * The angle from one line to another, counterclockwise, in degrees.
 *
 * Both lines are taken in the direction they were drawn, which is what makes the
 * answer reproducible: the same two lines always give the same number, and a
 * user who wanted the other angle can edit the value.
 */
function angleBetween(
  first: [PlanePoint, PlanePoint],
  second: [PlanePoint, PlanePoint]
): number {
  const a = subtract(first[1], first[0])
  const b = subtract(second[1], second[0])
  const sweep = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x)
  const degrees = ((sweep * 180) / Math.PI) % 360

  return degrees < 0 ? degrees + 360 : degrees
}

/** A dimension, and where its label wants to sit. */
export interface Dimension {
  constraint: ApiConstraint
  /** In the plane, so whoever draws the label can place it. */
  labelAt: PlanePoint
}

/**
 * The dimension a selection means, or null.
 *
 * Exactly two things, which is the existing app's rule, and what they are decides
 * what the dimension is:
 *
 *  - two points — how far apart they are;
 *  - a point and a line — how far the point is from the line;
 *  - two parallel lines — how far apart they are;
 *  - two lines that are not parallel — the angle between them.
 *
 * The value is measured off the geometry as it is now, because that is what a
 * dimension means when it is applied: *this* distance, from here on. Changing it
 * afterwards is what moves the model.
 */
export function dimensionFor(
  graph: SceneGraph,
  selection: readonly SketchSelectionId[],
  units: NumericSuffix
): Dimension | null {
  if (selection.length !== 2) return null

  const [firstId, secondId] = selection as [
    SketchSelectionId,
    SketchSelectionId,
  ]
  const first = classify(graph, firstId)
  const second = classify(graph, secondId)

  const isPointLike = (kind: string) => kind === 'point' || kind === 'origin'

  if (isPointLike(first.kind) && isPointLike(second.kind)) {
    const from = positionOf(graph, firstId)
    const to = positionOf(graph, secondId)
    if (!from || !to) return null

    const distance = magnitude(subtract(to, from))
    if (distance === 0) return null

    return {
      constraint: {
        type: 'Distance',
        segments: [asSegment(firstId), asSegment(secondId)],
        distance: number(distance, units),
        labelPosition: labelNumber(middle(from, to), units),
        source: { expr: `${roundOff(distance)}`, is_literal: true },
      },
      labelAt: forDrawing(middle(from, to), units),
    }
  }

  if (first.kind === 'line' && second.kind === 'line') {
    const line0 = endsOf(graph, firstId as ApiObjectId)
    const line1 = endsOf(graph, secondId as ApiObjectId)
    if (!line0 || !line1) return null

    if (areParallel(line0, line1)) {
      const distance = distanceToLine(line0[0], line1)
      if (distance === null || distance === 0) return null

      const labelAt = middle(
        middle(line0[0], line0[1]),
        middle(line1[0], line1[1])
      )
      return {
        constraint: {
          type: 'Distance',
          segments: [firstId as ApiObjectId, secondId as ApiObjectId],
          distance: number(distance, units),
          labelPosition: labelNumber(labelAt, units),
          source: { expr: `${roundOff(distance)}`, is_literal: true },
        },
        labelAt: forDrawing(labelAt, units),
      }
    }

    const angle = angleBetween(line0, line1)
    /*
     * Where the two lines meet, or near enough: the midpoint of their midpoints.
     * An angle label belongs by the vertex, and computing the true intersection
     * would place it off the drawing whenever the lines do not actually cross.
     */
    const labelAt = middle(
      middle(line0[0], line0[1]),
      middle(line1[0], line1[1])
    )

    return {
      constraint: {
        type: 'Angle',
        lines: [firstId as ApiObjectId, secondId as ApiObjectId],
        angle: number(angle, ANGLE_UNITS),
        labelPosition: labelNumber(labelAt, units),
        source: { expr: `${roundOff(angle)}deg`, is_literal: true },
      },
      labelAt: forDrawing(labelAt, units),
    }
  }

  // A point and a line, in either order: how far the point is from the line.
  const point = isPointLike(first.kind) ? firstId : secondId
  const line = isPointLike(first.kind) ? secondId : firstId
  if (
    !isPointLike(classify(graph, point).kind) ||
    classify(graph, line).kind !== 'line'
  ) {
    return null
  }

  const from = positionOf(graph, point)
  const ends = endsOf(graph, line as ApiObjectId)
  if (!from || !ends) return null

  const distance = distanceToLine(from, ends)
  if (distance === null || distance === 0) return null

  const labelAt = middle(from, middle(ends[0], ends[1]))

  return {
    constraint: {
      type: 'Distance',
      segments: [asSegment(point), line as ApiObjectId],
      distance: number(distance, units),
      labelPosition: labelNumber(labelAt, units),
      source: { expr: `${roundOff(distance)}`, is_literal: true },
    },
    labelAt: forDrawing(labelAt, units),
  }
}

const labelNumber = (at: PlanePoint, units: NumericSuffix) => ({
  x: number(at.x, units),
  y: number(at.y, units),
})

/** The value a dimension carries, for reading it and for editing it. */
export interface DimensionValue {
  id: ApiObjectId
  value: number
  units: NumericSuffix
  /** Where the label is, in the plane. */
  at: PlanePoint | null
  /** What kind it is, for the prefix a radius or a diameter wants. */
  type: ApiConstraint['type']
}

/**
 * Every dimension in the graph, with its value and where its label sits.
 *
 * Read from the constraint rather than remembered, because the solver owns it:
 * dragging geometry that a dimension does not pin changes nothing, and dragging
 * geometry it does changes the *geometry*, not the number.
 */
export function dimensionsOf(
  graph: SceneGraph,
  sketchId: ApiObjectId
): readonly DimensionValue[] {
  const sketch = objectAt(graph, sketchId)
  if (sketch?.kind.type !== 'Sketch') return []

  const found: DimensionValue[] = []

  for (const id of sketch.kind.constraints) {
    const object = objectAt(graph, id)
    if (object?.kind.type !== 'Constraint') continue

    const constraint = object.kind.constraint
    const measure =
      constraint.type === 'Distance' ||
      constraint.type === 'HorizontalDistance' ||
      constraint.type === 'VerticalDistance'
        ? constraint.distance
        : constraint.type === 'Angle'
          ? constraint.angle
          : constraint.type === 'Radius'
            ? constraint.radius
            : constraint.type === 'Diameter'
              ? constraint.diameter
              : null

    if (!measure) continue

    const label =
      'labelPosition' in constraint ? constraint.labelPosition : undefined

    found.push({
      id,
      value: measure.value,
      units: measure.units,
      at: label
        ? forDrawing({ x: label.x.value, y: label.y.value }, label.x.units)
        : null,
      type: constraint.type,
    })
  }

  return found
}
