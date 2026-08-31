import type { ApiObjectId } from '@rust/kcl-lib/bindings/FrontendApi'
import type { PlanePoint } from '@src/lib/scene/projection'
import type { SketchDrawing, SketchShape } from '@src/lib/sketch/drawing'

/**
 * What is under the pointer, worked out rather than asked.
 *
 * Ported from `src/machines/sketchSolve/interaction/interactionHelpers.ts` —
 * the closest-point maths, the hover radius, the priority order and the
 * tie-breaks are all the existing app's, because all four are tuning rather
 * than arithmetic and the tuning is the part that took the time.
 *
 * Two-dimensional, in the sketch's own plane, which is the whole point: picking
 * a sketch involves no renderer, no ray casts and no round trip to the engine,
 * so it is exact, instantaneous, and identical whoever is drawing. Engine
 * picking is suppressed while a sketch is open for the same reason — the engine
 * is showing the *last executed* model, and a segment drawn a moment ago is not
 * in it.
 */

const TAU = Math.PI * 2

/**
 * How much slack the pointer gets, in pixels.
 *
 * The existing app's `getSketchHoverDistance`, which is `10 * scale` in world
 * units. Ours is stated in pixels and converted by the caller, because only the
 * projection knows how big a pixel is on the plane — but it is the same ten.
 */
export const SKETCH_HOVER_DISTANCE_PX = 10

/** Something the pointer is near, and how near. */
export interface SketchHit {
  kind: 'vertex' | 'segment'
  id: ApiObjectId
  /** In plane units. */
  distance: number
  /** The nearest point *on* the thing, which is what snapping wants. */
  closest: PlanePoint
}

const gap = (a: PlanePoint, b: PlanePoint) => Math.hypot(b.x - a.x, b.y - a.y)

/**
 * The nearest point on a finite line, and how far away it is.
 *
 * `getClosestPointOnLineSegment`. Clamped to the segment, so the nearest point
 * to something past the end is the end — not a point on the infinite line
 * beyond it.
 */
export function closestOnLine(
  at: PlanePoint,
  from: PlanePoint,
  to: PlanePoint
): { closest: PlanePoint; distance: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return { closest: from, distance: gap(at, from) }

  const along = ((at.x - from.x) * dx + (at.y - from.y) * dy) / lengthSquared
  const t = Math.min(1, Math.max(0, along))
  const closest = { x: from.x + t * dx, y: from.y + t * dy }

  return { closest, distance: gap(at, closest) }
}

const normalizeAngle = (angle: number) => ((angle % TAU) + TAU) % TAU

/**
 * Whether a direction falls inside an arc's sweep.
 *
 * A sweep of zero is read as a whole turn, because that is what start and end
 * meeting means for an arc: a closed one. Reading it literally would make a full
 * arc unpickable everywhere, which looks like the arc not being there at all.
 */
function withinSweep(
  start: number,
  end: number,
  at: number,
  clockwise: boolean
): boolean {
  const sweep = clockwise
    ? normalizeAngle(start - end)
    : normalizeAngle(end - start)
  const offset = clockwise
    ? normalizeAngle(start - at)
    : normalizeAngle(at - start)

  return sweep === 0 || offset <= sweep
}

/** `getClosestPointOnCircleSegment`: the nearest point on the rim. */
export function closestOnCircle(
  at: PlanePoint,
  center: PlanePoint,
  radius: number
): { closest: PlanePoint; distance: number } {
  if (radius === 0) return { closest: center, distance: gap(at, center) }

  const angle = Math.atan2(at.y - center.y, at.x - center.x)
  return {
    closest: {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    },
    distance: Math.abs(gap(at, center) - radius),
  }
}

/** The nearest point on a shape, and how far the pointer is from it. */
export function closestOnShape(
  shape: SketchShape,
  at: PlanePoint
): { closest: PlanePoint; distance: number } {
  switch (shape.kind) {
    case 'line':
      return closestOnLine(at, shape.from, shape.to)

    case 'circle':
      return closestOnCircle(at, shape.center, shape.radius)

    case 'arc': {
      const angle = Math.atan2(at.y - shape.center.y, at.x - shape.center.x)
      const start = Math.atan2(
        shape.start.y - shape.center.y,
        shape.start.x - shape.center.x
      )
      const end = Math.atan2(
        shape.end.y - shape.center.y,
        shape.end.x - shape.center.x
      )

      if (withinSweep(start, end, angle, shape.clockwise)) {
        return closestOnCircle(at, shape.center, shape.radius)
      }

      // Past either end the nearest part of the arc is the end itself.
      return gap(at, shape.start) <= gap(at, shape.end)
        ? { closest: shape.start, distance: gap(at, shape.start) }
        : { closest: shape.end, distance: gap(at, shape.end) }
    }

    case 'polyline': {
      let nearest = { closest: at, distance: Number.POSITIVE_INFINITY }
      for (let index = 1; index < shape.points.length; index += 1) {
        const from = shape.points[index - 1]
        const to = shape.points[index]
        if (!from || !to) continue
        const leg = closestOnLine(at, from, to)
        if (leg.distance < nearest.distance) nearest = leg
      }
      return nearest
    }
  }
}

/** Kept for callers that only want the number. */
export const distanceToShape = (shape: SketchShape, at: PlanePoint): number =>
  closestOnShape(shape, at).distance

/**
 * Which kinds win when two things overlap.
 *
 * `getApiObjectSelectionPriority`, minus the invisible-constraint tier that has
 * nothing to occupy it yet. Points beat curves so that hovering near the end of
 * a line offers the end — the thing you can drag and constrain — and the line is
 * still reachable everywhere else along it. Splines come last because their
 * control polygon covers a lot of ground that belongs to whatever is under it.
 */
const priorityOf = (
  hit: { kind: 'vertex' | 'segment' },
  shape?: SketchShape
) => {
  if (hit.kind === 'vertex') return 1
  return shape?.kind === 'polyline' ? 3 : 2
}

/**
 * Everything within reach of the pointer, nearest and most specific first.
 *
 * A list rather than one answer, because more than one thing can be under the
 * pointer and the caller decides what to do about it: a click takes the first, a
 * snap looks for a particular kind, and a future alt-click cycles.
 *
 * `tolerance` is in plane units — pixels converted by whoever knows the zoom.
 */
export function hitsInSketch(
  drawing: SketchDrawing,
  at: PlanePoint,
  tolerance: number
): readonly SketchHit[] {
  const shapes = new Map(drawing.shapes.map((shape) => [shape.id, shape]))
  const hits: SketchHit[] = []

  for (const vertex of drawing.vertices) {
    const distance = gap(at, vertex.at)
    if (distance > tolerance) continue
    hits.push({
      kind: 'vertex',
      id: vertex.id,
      distance,
      closest: vertex.at,
    })
  }

  for (const shape of drawing.shapes) {
    const near = closestOnShape(shape, at)
    if (near.distance > tolerance) continue
    hits.push({
      kind: 'segment',
      id: shape.id,
      distance: near.distance,
      closest: near.closest,
    })
  }

  return hits.sort((a, b) => {
    const byPriority =
      priorityOf(a, shapes.get(a.id)) - priorityOf(b, shapes.get(b.id))
    if (byPriority !== 0) return byPriority

    /*
     * Coincident points are decided by id, not by which was found first.
     *
     * Two points at the same place is the normal state of a closed profile, and
     * a comparison that leaves their order to floating-point noise makes the
     * hover flicker between them as the pointer sits still. The existing app
     * takes the higher id; what matters is only that it is stable.
     */
    if (
      a.kind === 'vertex' &&
      b.kind === 'vertex' &&
      Math.abs(a.distance - b.distance) < 1e-8
    ) {
      return b.id - a.id
    }

    return a.distance - b.distance
  })
}

/** What the pointer is over, or null for empty space. */
export function pickInSketch(
  drawing: SketchDrawing,
  at: PlanePoint,
  tolerance: number
): SketchHit | null {
  return hitsInSketch(drawing, at, tolerance)[0] ?? null
}
