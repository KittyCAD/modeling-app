import { EllipseCurve } from 'three'

/**
 * An arc as a list of points, ported unchanged from the existing app.
 *
 * Two things in it are worth the file. The first is the fixed hundred samples,
 * and the original's comment explains why it is fixed rather than adapted to the
 * arc's length: `Line2` cannot have its point count changed after the geometry is
 * built, so adapting would mean rebuilding the geometry on every zoom.
 *
 * The second is the full-circle guard. THREE's `EllipseCurve` collapses a nominal
 * `start + 2π` sweep into a near-zero arc when floating point pushes the delta
 * slightly past 2π — so a circle drawn that way vanishes, intermittently, for
 * reasons nothing on screen can explain.
 */

const TAU = Math.PI * 2
const FULL_CIRCLE_TOLERANCE = 1e-12

/** Enough for a full circle to read as round; see the note above on why it is fixed. */
const NUMBER_OF_POINTS = 100

const isFullCircleSweep = (startAngle: number, endAngle: number) =>
  Math.abs(Math.abs(endAngle - startAngle) - TAU) <= FULL_CIRCLE_TOLERANCE

function fullCirclePositions(input: {
  center: [number, number]
  radius: number
  startAngle: number
  ccw: boolean
}): number[] {
  const direction = input.ccw ? 1 : -1
  const positions: number[] = []

  for (let index = 0; index <= NUMBER_OF_POINTS; index += 1) {
    const angle =
      input.startAngle + direction * (index / NUMBER_OF_POINTS) * TAU
    positions.push(
      input.center[0] + input.radius * Math.cos(angle),
      input.center[1] + input.radius * Math.sin(angle),
      0
    )
  }

  return positions
}

export function createArcPositions(input: {
  center: [number, number]
  radius: number
  startAngle: number
  endAngle: number
  ccw: boolean
}): number[] {
  const { center, radius, startAngle, endAngle, ccw } = input

  if (isFullCircleSweep(startAngle, endAngle)) {
    return fullCirclePositions({ center, radius, startAngle, ccw })
  }

  const curve = new EllipseCurve(
    center[0],
    center[1],
    radius,
    radius,
    startAngle,
    endAngle,
    !ccw,
    0
  )

  return curve
    .getPoints(NUMBER_OF_POINTS)
    .flatMap((point) => [point.x, point.y, 0])
}
