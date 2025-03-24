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
  rayDirection: Coords2d, // Should be normalized
  pointToCheck: Coords2d
): Coords2d {
  // Ensure direction is normalized
  const dirMagnitude = Math.sqrt(
    rayDirection[0] * rayDirection[0] + rayDirection[1] * rayDirection[1]
  )
  const normalizedDir: Coords2d = [
    rayDirection[0] / dirMagnitude,
    rayDirection[1] / dirMagnitude,
  ]

  // Vector from origin to point
  const toPoint: Coords2d = [
    pointToCheck[0] - rayOrigin[0],
    pointToCheck[1] - rayOrigin[1],
  ]

  // Project toPoint onto the ray direction
  const projection =
    toPoint[0] * normalizedDir[0] + toPoint[1] * normalizedDir[1]

  // Clamp t to be ≥ 0 for ray (not a full line)
  const t = Math.max(0, projection)

  // Calculate the closest point
  return [
    rayOrigin[0] + normalizedDir[0] * t,
    rayOrigin[1] + normalizedDir[1] * t,
  ]
}
