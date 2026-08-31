import type { IconName } from '@kittycad/ui-kit'
import type {
  ApiConstraint,
  ApiObjectId,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { millimetres } from '@src/lib/kcl/units'
import type { PlanePoint } from '@src/lib/scene/projection'
import { coincidentCluster } from '@src/lib/sketch/drag'
import { objectAt, pointAt, segmentAt } from '@src/lib/sketch/sceneGraph'

/**
 * Constraints, as things on screen.
 *
 * A constraint is an object in the graph with no geometry of its own, which
 * leaves two questions: where to draw it, and what to draw. Both are answered
 * here, as a pure function of the graph, so the layer that puts them on screen
 * knows only "an icon at a plane point".
 *
 * Why this matters beyond decoration: a constraint that is not drawn cannot be
 * *selected*, and a constraint that cannot be selected cannot be deleted. So
 * until there were badges, a wrong constraint could only be undone by editing
 * the KCL by hand.
 *
 * The anchors are simpler than the existing app's, which lays its badges out in
 * screen space along the segment they belong to and reserves room for the
 * dimension lines. This puts each on the thing it constrains and lets the layer
 * fan out anything that collides. Same information, less machinery, and the
 * ported part is the one that matters: which icon means which constraint.
 *
 * Positions are in millimetres, like the drawing's, because that is the unit the
 * plane frame and the camera are in. The graph reports whatever the file was
 * written in, so every coordinate converts on the way through — a file in inches
 * would otherwise place its badges twenty-five times too far out.
 */

export interface ConstraintBadge {
  id: ApiObjectId
  at: PlanePoint
  icon: IconName
  /** What it says on hover, and to a screen reader. */
  title: string
}

/** Which glyph means which constraint. The existing app's pairings. */
const ICONS: Partial<Record<ApiConstraint['type'], IconName>> = {
  Coincident: 'coincident',
  Midpoint: 'midpoint',
  Parallel: 'parallel',
  Perpendicular: 'perpendicular',
  LinesEqualLength: 'equal',
  EqualRadius: 'equal',
  Tangent: 'tangent',
  Symmetric: 'symmetric',
  Horizontal: 'horizontal',
  Vertical: 'vertical',
  Fixed: 'fix',
}

const TITLES: Partial<Record<ApiConstraint['type'], string>> = {
  Coincident: 'Coincident',
  Midpoint: 'Midpoint',
  Parallel: 'Parallel',
  Perpendicular: 'Perpendicular',
  LinesEqualLength: 'Equal length',
  EqualRadius: 'Equal radius',
  Tangent: 'Tangent',
  Symmetric: 'Symmetric',
  Horizontal: 'Horizontal',
  Vertical: 'Vertical',
  Fixed: 'Fixed',
}

const middle = (points: readonly PlanePoint[]): PlanePoint | null => {
  if (points.length === 0) return null

  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  )
  return { x: total.x / points.length, y: total.y / points.length }
}

/** Where a segment id sits: the average of its points. */
function centreOf(graph: SceneGraph, id: ApiObjectId): PlanePoint | null {
  const segment = segmentAt(graph, id)
  if (!segment) return null

  return middle(
    segment.points.map((point) => ({
      x: millimetres(point.x, point.units),
      y: millimetres(point.y, point.units),
    }))
  )
}

/** Where a point or segment id sits, whichever it turns out to be. */
function anchorOf(
  graph: SceneGraph,
  id: ApiObjectId | 'ORIGIN'
): PlanePoint | null {
  if (id === 'ORIGIN') return { x: 0, y: 0 }

  const point = pointAt(graph, id)
  if (point) {
    return {
      x: millimetres(point.x, point.units),
      y: millimetres(point.y, point.units),
    }
  }

  return centreOf(graph, id)
}

/**
 * Where one constraint belongs.
 *
 * On the thing it constrains, and where a constraint names several things, on
 * the first — which is the one the user picked first, so it is the one they are
 * most likely to be looking at.
 */
function placeOf(
  graph: SceneGraph,
  constraint: ApiConstraint
): PlanePoint | null {
  switch (constraint.type) {
    case 'Coincident':
      return anchorOf(graph, constraint.segments[0] ?? 'ORIGIN')

    case 'Midpoint':
      return anchorOf(graph, constraint.point)

    case 'Horizontal':
    case 'Vertical':
      return 'line' in constraint
        ? centreOf(graph, constraint.line)
        : anchorOf(graph, constraint.points[0] ?? 'ORIGIN')

    case 'Parallel':
    case 'Perpendicular':
    case 'LinesEqualLength':
      return constraint.lines[0] === undefined
        ? null
        : centreOf(graph, constraint.lines[0])

    case 'Tangent':
    case 'EqualRadius':
      return constraint.input[0] === undefined
        ? null
        : centreOf(graph, constraint.input[0])

    case 'Symmetric':
      return centreOf(graph, constraint.axis)

    case 'Fixed':
      return constraint.points[0]
        ? anchorOf(graph, constraint.points[0].point)
        : null

    default:
      // The dimensions, which carry their own label position and are drawn as a
      // value rather than as an icon.
      return null
  }
}

/**
 * Which segments a constraint would light up, and the other way round.
 *
 * `findInvisibleConstraintsForSegment`, ported. This is what makes hovering a
 * segment show *its* constraints rather than all of them: a constraint is
 * attached to a segment when it says something about that segment, and what
 * counts as "about" differs per constraint — a parallel is about its lines, a
 * midpoint is about the line and the point, a symmetric is about its inputs *and*
 * its axis.
 *
 * A point brings its whole coincident cluster with it. A profile's corner is
 * several points at one place, and the constraints on a corner are spread across
 * them — so hovering the corner has to find all of them or it finds almost none.
 */
export function constraintsForSegment(
  graph: SceneGraph,
  segmentId: ApiObjectId
): readonly ApiObjectId[] {
  const object = objectAt(graph, segmentId)
  if (object?.kind.type !== 'Segment') return []

  const cluster =
    object.kind.segment.type === 'Point'
      ? new Set(coincidentCluster(graph, segmentId))
      : null

  const found: ApiObjectId[] = []

  for (const candidate of graph.objects) {
    if (candidate?.kind.type !== 'Constraint') continue
    const constraint = candidate.kind.constraint
    if (!ICONS[constraint.type]) continue

    const attached = cluster
      ? namesPointIn(constraint, cluster)
      : namesSegment(constraint, segmentId)

    if (attached) found.push(candidate.id)
  }

  return found
}

/** Whether a constraint names any point in a coincident cluster. */
function namesPointIn(
  constraint: ApiConstraint,
  cluster: ReadonlySet<ApiObjectId>
): boolean {
  const inCluster = (id: ApiObjectId | 'ORIGIN') =>
    id !== 'ORIGIN' && cluster.has(id)

  switch (constraint.type) {
    case 'Coincident':
      return constraint.segments.some(inCluster)
    case 'Horizontal':
    case 'Vertical':
      return 'points' in constraint ? constraint.points.some(inCluster) : false
    case 'Symmetric':
      return constraint.input.some(inCluster)
    case 'Midpoint':
      return inCluster(constraint.point)
    case 'Fixed':
      return constraint.points.some((point) => cluster.has(point.point))
    default:
      /*
       * A parallel says nothing about a *point*; it says something about the
       * lines the point happens to end. Attaching it to the point as well would
       * put every constraint in a profile on every corner of it.
       */
      return false
  }
}

/** Whether a constraint names this segment — a line, an arc or a circle. */
function namesSegment(
  constraint: ApiConstraint,
  segmentId: ApiObjectId
): boolean {
  switch (constraint.type) {
    case 'Coincident':
      return constraint.segments.some((id) => id === segmentId)
    case 'Horizontal':
    case 'Vertical':
      return 'line' in constraint
        ? constraint.line === segmentId
        : constraint.points.some((id) => id === segmentId)
    case 'Parallel':
    case 'Perpendicular':
    case 'LinesEqualLength':
      return constraint.lines.includes(segmentId)
    case 'Tangent':
    case 'EqualRadius':
      return constraint.input.includes(segmentId)
    case 'Midpoint':
      return constraint.segment === segmentId
    case 'Symmetric':
      // The axis counts: it is a line the constraint is about, and hovering it
      // should say why it cannot move freely.
      return (
        constraint.input.includes(segmentId) || constraint.axis === segmentId
      )
    default:
      return false
  }
}

/**
 * Every constraint in the sketch that has a badge.
 *
 * Dimensions are absent on purpose: they are drawn as their value, at the label
 * position they carry, which is a different thing on screen even though it is
 * the same thing in the graph.
 */
export function badgesOf(
  graph: SceneGraph,
  sketchId: ApiObjectId
): readonly ConstraintBadge[] {
  const sketch = objectAt(graph, sketchId)
  if (sketch?.kind.type !== 'Sketch') return []

  const found: ConstraintBadge[] = []

  for (const id of sketch.kind.constraints) {
    const object = objectAt(graph, id)
    if (object?.kind.type !== 'Constraint') continue

    const constraint = object.kind.constraint
    const icon = ICONS[constraint.type]
    const at = placeOf(graph, constraint)
    if (!icon || !at) continue

    found.push({
      id,
      at,
      icon,
      title: TITLES[constraint.type] ?? constraint.type,
    })
  }

  return found
}
