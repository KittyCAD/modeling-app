import { Coords2d } from 'lang/std/sketch'

import { getAngle } from './utils'

export function deg2Rad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function getTangentPointFromPreviousArc(
  lastArcCenter: Coords2d,
  lastArcCCW: boolean,
  lastArcEnd: Coords2d
): Coords2d {
  const angleFromOldCenterToArcStart = getAngle(lastArcCenter, lastArcEnd)
  const tangentialAngle = angleFromOldCenterToArcStart + (lastArcCCW ? -90 : 90)
  return [
    Math.cos(deg2Rad(tangentialAngle)) * 10 + lastArcEnd[0],
    Math.sin(deg2Rad(tangentialAngle)) * 10 + lastArcEnd[1],
  ]
}

export function closestPointOnRay(
  rayOrigin: Coords2d,
  rayDirection: Coords2d,
  pointToCheck: Coords2d
): Coords2d {
  const dirMagnitude = Math.sqrt(
    rayDirection[0] * rayDirection[0] + rayDirection[1] * rayDirection[1]
  )
  const normalizedDir: Coords2d = [
    rayDirection[0] / dirMagnitude,
    rayDirection[1] / dirMagnitude,
  ]

  const originToPoint: Coords2d = [
    pointToCheck[0] - rayOrigin[0],
    pointToCheck[1] - rayOrigin[1],
  ]

  const projection =
    originToPoint[0] * normalizedDir[0] + originToPoint[1] * normalizedDir[1]

  const t = Math.max(0, projection)

  return [
    rayOrigin[0] + normalizedDir[0] * t,
    rayOrigin[1] + normalizedDir[1] * t,
  ]
}
