import type { Coords2d } from '@src/lang/std/sketch'
import { getAngle } from '@src/lib/utils'

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

export function subVec(a: Coords2d, b: Coords2d): Coords2d {
  return [a[0] - b[0], a[1] - b[1]]
}

export function normalizeVec(v: Coords2d): Coords2d {
  const magnitude = Math.sqrt(v[0] * v[0] + v[1] * v[1])
  if (magnitude === 0) {
    return [0, 0]
  }
  return [v[0] / magnitude, v[1] / magnitude]
}

export function cross2d(a: Coords2d, b: Coords2d): number {
  return a[0] * b[1] - a[1] * b[0]
}

export function distance2d(a: Coords2d, b: Coords2d): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return Math.sqrt(dx * dx + dy * dy)
}

export function isValidNumber(value: number): boolean {
  return typeof value === 'number' && !Number.isNaN(value) && isFinite(value)
}

export function rotateVec(v: Coords2d, rad: number): Coords2d {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [v[0] * cos - v[1] * sin, v[0] * sin + v[1] * cos]
}

export function closestPointOnRay(
  rayOrigin: Coords2d,
  rayDirection: Coords2d,
  pointToCheck: Coords2d,
  allowNegative = false
) {
  const normalizedDir = normalizeVec(rayDirection)
  const originToPoint = subVec(pointToCheck, rayOrigin)

  let t =
    originToPoint[0] * normalizedDir[0] + originToPoint[1] * normalizedDir[1]

  if (!allowNegative) {
    t = Math.max(0, t)
  }

  return {
    closestPoint: [
      rayOrigin[0] + normalizedDir[0] * t,
      rayOrigin[1] + normalizedDir[1] * t,
    ] as Coords2d,
    t,
  }
}
