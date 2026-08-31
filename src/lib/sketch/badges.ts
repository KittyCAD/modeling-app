import type { IconName } from '@kittycad/ui-kit'
import type {
  ApiConstraint,
  ApiObjectId,
  SceneGraph,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { PlanePoint } from '@src/lib/scene/projection'
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

  return middle(segment.points.map((point) => ({ x: point.x, y: point.y })))
}

/** Where a point or segment id sits, whichever it turns out to be. */
function anchorOf(
  graph: SceneGraph,
  id: ApiObjectId | 'ORIGIN'
): PlanePoint | null {
  if (id === 'ORIGIN') return { x: 0, y: 0 }

  const point = pointAt(graph, id)
  if (point) return { x: point.x, y: point.y }

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
