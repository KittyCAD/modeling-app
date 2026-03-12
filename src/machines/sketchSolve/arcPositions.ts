import { EllipseCurve } from 'three'

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

  const points = arcStart.getPoints(numberOfPoints)
  const positions: number[] = []
  points.forEach((p) => {
    positions.push(p.x, p.y, 0)
  })

  return positions
}
