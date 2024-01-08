import { Coords2d } from 'lang/std/sketch'
import { getAngle } from './utils'

function getSlope(
  start: Coords2d,
  end: Coords2d
): {
  slope: number
  perpSlope: number
} {
  const slope =
    start[0] - end[0] === 0
      ? Infinity
      : (start[1] - end[1]) / (start[0] - end[0])

  // Calculate the slope of the line perpendicular to the above line
  const perpSlope = slope === Infinity ? 0 : -1 / slope
  return {
    slope,
    perpSlope,
  }
}

function intersect(
  point1: Coords2d,
  slope1: number,
  point2: Coords2d,
  slope2: number
): Coords2d {
  const x =
    Math.abs(slope1) === Infinity
      ? point1[0]
      : Math.abs(slope2) === Infinity
      ? point2[0]
      : (point2[1] - slope2 * point2[0] - point1[1] + slope1 * point1[0]) /
        (slope1 - slope2)
  const y =
    Math.abs(slope1) !== Infinity
      ? slope1 * x - slope1 * point1[0] + point1[1]
      : slope2 * x - slope2 * point2[0] + point2[1]
  return [x, y]
}

function normalizeRad(angle: number): number {
  const draft = angle % (Math.PI * 2)
  return draft < Math.PI * 2 ? draft + Math.PI * 2 : draft
}

function deltaAngle({
  fromAngle,
  toAngle,
}: {
  fromAngle: number
  toAngle: number
}): number {
  const normFromAngle = normalizeRad(fromAngle)
  const normToAngle = normalizeRad(toAngle)
  const provisional = normToAngle - normFromAngle
  if (provisional > -Math.PI && provisional <= Math.PI) return provisional

  if (provisional > Math.PI) return provisional - Math.PI * 2
  if (provisional < -Math.PI) return provisional + Math.PI * 2
  return provisional
}

function deg2Rad(deg: number): number {
  return (deg * Math.PI) / 180
}
function rad2Deg(rad: number): number {
  return (rad * 180) / Math.PI
}

//determine if a list of 3 or more points is clockwise or CCW
export function isPointsCCW(list: Coords2d[]): number {
  // CCW is positive as that the Math convention
  let sum = 0
  list.forEach((point, index) => {
    const prevPoint = list.slice(index - 1)[0] // slice will loop back for negative indexes
    sum += (prevPoint[0] + point[0]) * (prevPoint[1] - point[1])
  })
  return Math.sign(sum)
}

// tanPreviousPoint and arcStartPoint make up a straight segment leading into the arc (of which the arc should be tangential). The arc should start at arcStartPoint and end at, arcEndPoint
// With this information we should everything we need to calculate the arc's center and radius. However there is two tangential arcs possible, that just varies on their direction
// One is obtuse where the arc smoothly flows from the straight segment, and the other would be acute that immediately cuts back in the other direction. The obtuse boolean is there to control for this.
export function getTangentialArcToInfo({
  arcStartPoint,
  arcEndPoint,
  tanPreviousPoint,
  obtuse = true,
}: {
  arcStartPoint: Coords2d
  arcEndPoint: Coords2d
  tanPreviousPoint: Coords2d
  obtuse?: boolean
}): {
  center: Coords2d
  arcMidPoint: Coords2d
  radius: number
} {
  const { perpSlope: tangentialLinePerpSlope } = getSlope(
    tanPreviousPoint,
    arcStartPoint
  )

  // Calculate the midpoint of the line segment between arcStartPoint and arcEndPoint
  const midPoint: Coords2d = [
    (arcStartPoint[0] + arcEndPoint[0]) / 2,
    (arcStartPoint[1] + arcEndPoint[1]) / 2,
  ]
  const slopeMidPointLine = getSlope(arcStartPoint, midPoint)

  let center: Coords2d = [0, 0]
  let radius = 0
  const getMidPoint = (
    _center: Coords2d,
    arcStartPoint: Coords2d,
    arcEndPoint: Coords2d,
    _radius: number,
    obtuse: boolean
  ): Coords2d => {
    const angleFromCenterToArcStart = getAngle(_center, arcStartPoint)
    const angleFromCenterToArcEnd = getAngle(_center, arcEndPoint)
    const _deltaAng = deltaAngle({
      fromAngle: deg2Rad(angleFromCenterToArcStart),
      toAngle: deg2Rad(angleFromCenterToArcEnd),
    })
    const deltaAng = _deltaAng / 2 + deg2Rad(angleFromCenterToArcStart)
    const shortestArcMidPoint: [number, number] = [
      Math.cos(deltaAng) * _radius + _center[0],
      Math.sin(deltaAng) * _radius + _center[1],
    ]
    const oppositeDelta = deltaAng + Math.PI
    const longestArcMidPoint: [number, number] = [
      Math.cos(oppositeDelta) * _radius + _center[0],
      Math.sin(oppositeDelta) * _radius + _center[1],
    ]

    const rotationDirectionOriginalPoints = isPointsCCW([
      tanPreviousPoint,
      arcStartPoint,
      arcEndPoint,
    ])
    const rotationDirectionPointsOnArc = isPointsCCW([
      arcStartPoint,
      shortestArcMidPoint,
      arcEndPoint,
    ])
    let arcMidPoint =
      rotationDirectionOriginalPoints !== rotationDirectionPointsOnArc && obtuse
        ? longestArcMidPoint
        : shortestArcMidPoint
    return arcMidPoint
  }

  if (tangentialLinePerpSlope === slopeMidPointLine.slope) {
    center = midPoint
    radius = Math.sqrt(
      (arcStartPoint[0] - center[0]) ** 2 + (arcStartPoint[1] - center[1]) ** 2
    )
    const arcMidPoint = getMidPoint(
      center,
      arcStartPoint,
      arcEndPoint,
      radius,
      obtuse
    )
    return {
      center,
      radius,
      arcMidPoint,
    }
  }

  center = intersect(
    midPoint,
    slopeMidPointLine.perpSlope,
    arcStartPoint,
    tangentialLinePerpSlope
  )
  radius = Math.sqrt(
    (arcStartPoint[0] - center[0]) ** 2 + (arcStartPoint[1] - center[1]) ** 2
  )
  const arcMidPoint = getMidPoint(
    center,
    arcStartPoint,
    arcEndPoint,
    radius,
    obtuse
  )
  return {
    center,
    radius,
    arcMidPoint,
  }
}
