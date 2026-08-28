import type { ApiObjectId } from '@rust/kcl-lib/bindings/FrontendApi'
import type { PlanePoint } from '@src/lib/scene/projection'
import type { SketchDrawing, SketchShape } from '@src/lib/sketch/drawing'

/**
 * What is under the pointer, worked out rather than asked.
 *
 * Two-dimensional arithmetic in the sketch's own plane, which is the whole
 * point: picking a sketch involves no renderer, no ray casts and no round trip
 * to the engine, so it is exact, instantaneous, and identical whoever is
 * drawing. Engine picking is suppressed while a sketch is open for the same
 * reason — the engine is showing the *last executed* model, and a segment drawn
 * a moment ago is not in it.
 *
 * Everything is in millimetres in the plane, including the tolerance. Turning a
 * pointer's few pixels of slack into millimetres is the projection's job, since
 * only it knows how far away the plane is.
 */

const TAU = Math.PI * 2

export type SketchPick =
  /** A point somebody can grab: an endpoint, a centre, a control. */
  | { kind: 'vertex'; id: ApiObjectId; at: PlanePoint; distance: number }
  /** The body of a segment. */
  | { kind: 'segment'; id: ApiObjectId; distance: number }

const gap = (a: PlanePoint, b: PlanePoint) => Math.hypot(b.x - a.x, b.y - a.y)

/** How far a point is from a finite line, not from the infinite one through it. */
function toSegment(at: PlanePoint, from: PlanePoint, to: PlanePoint): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return gap(at, from)

  const along = ((at.x - from.x) * dx + (at.y - from.y) * dy) / lengthSquared
  const clamped = Math.min(1, Math.max(0, along))

  return gap(at, { x: from.x + clamped * dx, y: from.y + clamped * dy })
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

/** How far the pointer is from a shape, in plane units. */
export function distanceToShape(shape: SketchShape, at: PlanePoint): number {
  switch (shape.kind) {
    case 'line':
      return toSegment(at, shape.from, shape.to)

    case 'circle':
      return Math.abs(gap(at, shape.center) - shape.radius)

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
        return Math.abs(gap(at, shape.center) - shape.radius)
      }

      // Past either end the nearest part of the arc is the end itself.
      return Math.min(gap(at, shape.start), gap(at, shape.end))
    }

    case 'polyline': {
      let nearest = Number.POSITIVE_INFINITY
      for (let index = 1; index < shape.points.length; index += 1) {
        const from = shape.points[index - 1]
        const to = shape.points[index]
        if (from && to) nearest = Math.min(nearest, toSegment(at, from, to))
      }
      return nearest
    }
  }
}

/**
 * What the pointer is over, or null for empty space.
 *
 * Vertices win over segments they sit on, always — a click near the end of a
 * line means the end of the line, because that is the thing you can drag and
 * constrain, and the line is still reachable everywhere else along it. Among
 * things of the same sort the nearest wins.
 */
export function pickInSketch(
  drawing: SketchDrawing,
  at: PlanePoint,
  tolerance: number
): SketchPick | null {
  let vertex: SketchPick | null = null
  for (const candidate of drawing.vertices) {
    const distance = gap(at, candidate.at)
    if (distance > tolerance) continue
    if (vertex && vertex.distance <= distance) continue
    vertex = { kind: 'vertex', id: candidate.id, at: candidate.at, distance }
  }
  if (vertex) return vertex

  let segment: SketchPick | null = null
  for (const shape of drawing.shapes) {
    const distance = distanceToShape(shape, at)
    if (distance > tolerance) continue
    if (segment && segment.distance <= distance) continue
    segment = { kind: 'segment', id: shape.id, distance }
  }

  return segment
}
