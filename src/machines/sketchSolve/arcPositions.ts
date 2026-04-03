import { EllipseCurve } from 'three'

const TAU = Math.PI * 2
const FULL_CIRCLE_TOLERANCE = 1e-12

function isFullCircleSweep(startAngle: number, endAngle: number): boolean {
  return (
    Math.abs(Math.abs(endAngle - startAngle) - TAU) <= FULL_CIRCLE_TOLERANCE
  )
}

function createFullCirclePositions({
  center,
  radius,
  startAngle,
  ccw,
  numberOfPoints,
}: {
  center: [number, number]
  radius: number
  startAngle: number
  ccw: boolean
  numberOfPoints: number
}): number[] {
  const direction = ccw ? 1 : -1
  const positions: number[] = []

  for (let i = 0; i <= numberOfPoints; i++) {
    const t = i / numberOfPoints
    const angle = startAngle + direction * t * TAU
    positions.push(
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
      0
    )
  }

  return positions
}

/**
 * Similar to src/clientSideScene/segments.ts / createArcGeometry, but:
 * - uses LineGeometry which supports screen space line thickness
 * - isDashed parameter not supported (yet)
 */
export function createArcPositions({
  center,
  radius,
  startAngle,
  endAngle,
  ccw,
}: {
  center: [number, number]
  radius: number
  startAngle: number
  endAngle: number
  ccw: boolean
}): number[] {
  const arcStart = new EllipseCurve(
    center[0],
    center[1],
    radius,
    radius,
    startAngle,
    endAngle,
    !ccw,
    0
  )

  // Adaptive segmentation: use 100 for a full circle and proportionally less based on the arc length
  // This doesn't work unfortunately without recreating the geometry and at that point it's not worth it:
  // https://discourse.threejs.org/t/adding-points-drawcount-for-line2-dynamically/48980/4
  //
  // const angleDiff = getAngleDiff(startAngle, endAngle, ccw)
  // const numberOfPoints = Math.ceil(100 * (angleDiff / (Math.PI * 2)))

  const numberOfPoints = 100

  // Three's EllipseCurve can collapse nominal startAngle + 2π sweeps into a
  // near-zero arc when floating point rounding pushes the delta slightly above 2π.
  if (isFullCircleSweep(startAngle, endAngle)) {
    return createFullCirclePositions({
      center,
      radius,
      startAngle,
      ccw,
      numberOfPoints,
    })
  }

  const points = arcStart.getPoints(numberOfPoints)
  const positions: number[] = []
  points.forEach((p) => {
    positions.push(p.x, p.y, 0)
  })

  return positions
}
