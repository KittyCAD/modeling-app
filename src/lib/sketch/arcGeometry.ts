import type { ArcDirection } from '@rust/kcl-lib/bindings/FrontendApi'
import type { PlanePoint } from '@src/lib/scene/projection'

/**
 * The arithmetic behind an arc drawn through three points.
 *
 * Ported from `threePointArcToolImpl`, which gets the centre from kcl-lib's
 * `calculate_circle_from_3_points` — the same formula written here because it is
 * wanted on every pointer move and a WASM round trip per move is a round trip
 * for six multiplications.
 *
 * Two facts a three-point arc rests on. The centre is the circumcentre of the
 * triangle the three points make, and the *direction* cannot be derived from
 * start and end alone: both sweeps join the same two points, and which one was
 * meant is decided by the third point being on it.
 */

const TAU = Math.PI * 2

/** Below this the arithmetic stops meaning anything. The existing app's value. */
const EPSILON = 1e-6

/**
 * The centre of the circle through three points, or null.
 *
 * Null for collinear points, where there is no circle. kcl-lib's own helper
 * answers with the centroid in that case, which the existing app then rejects by
 * radius — but a live preview has a better option than a nonsense arc: decline
 * to reshape, and leave the last arc that made sense on screen.
 */
export function threePointArcCenter(
  start: PlanePoint,
  end: PlanePoint,
  through: PlanePoint
): PlanePoint | null {
  /*
   * Twice the signed area of the triangle, which is zero exactly when the three
   * points are in a line.
   */
  const determinant =
    2 *
    (start.x * (end.y - through.y) +
      end.x * (through.y - start.y) +
      through.x * (start.y - end.y))

  if (Math.abs(determinant) < EPSILON) return null

  const startSquared = start.x * start.x + start.y * start.y
  const endSquared = end.x * end.x + end.y * end.y
  const throughSquared = through.x * through.x + through.y * through.y

  /*
   * Every point satisfies (x - cx)² + (y - cy)² = r², so subtracting one
   * equation from the other two eliminates the radius and leaves two linear
   * equations in the centre.
   */
  const center = {
    x:
      (startSquared * (end.y - through.y) +
        endSquared * (through.y - start.y) +
        throughSquared * (start.y - end.y)) /
      determinant,
    y:
      (startSquared * (through.x - end.x) +
        endSquared * (start.x - through.x) +
        throughSquared * (end.x - start.x)) /
      determinant,
  }

  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null

  const radius = Math.hypot(end.x - center.x, end.y - center.y)
  return radius < EPSILON ? null : center
}

const normalise = (angle: number) => ((angle % TAU) + TAU) % TAU

/** How far it is from one angle to another, going the stated way round. */
const span = (from: number, to: number, counterclockwise: boolean) => {
  const difference = normalise(to - from)
  return counterclockwise ? difference : (TAU - difference) % TAU
}

/**
 * Which way the arc sweeps.
 *
 * Not derivable from the endpoints: both sweeps join the same two points. What
 * decides it is whether the third point lies on the counterclockwise sweep — if
 * it does, that is the arc that was drawn, and if it does not, the other one was.
 */
export function threePointArcDirection(
  center: PlanePoint,
  start: PlanePoint,
  end: PlanePoint,
  through: PlanePoint
): ArcDirection {
  const angleOf = (point: PlanePoint) =>
    Math.atan2(point.y - center.y, point.x - center.x)

  const startAngle = angleOf(start)
  const toEnd = span(startAngle, angleOf(end), true)
  const toThrough = span(startAngle, angleOf(through), true)

  return toThrough <= toEnd + EPSILON ? 'ccw' : 'cw'
}

/** Halfway between two points, which is where a fresh arc's centre starts. */
export const midpoint = (a: PlanePoint, b: PlanePoint): PlanePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
})
