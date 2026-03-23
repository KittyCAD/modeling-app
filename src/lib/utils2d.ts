import type { Coords2d } from '@src/lang/util'
import { getAngle } from '@src/lib/utils'

export function deg2Rad(deg: number): number {
  return (deg * Math.PI) / 180
}

export const TAU = Math.PI * 2

export function getTangentPointFromPreviousArc(
  lastArcCenter: Coords2d,
  lastArcCCW: boolean,
  lastArcEnd: Coords2d
): Coords2d {
  const angleFromOldCenterToArcStart = getAngle(lastArcCenter, lastArcEnd)
  const tangentialAngle = angleFromOldCenterToArcStart + (lastArcCCW ? -90 : 90)

  return polar2d(lastArcEnd, 10, deg2Rad(tangentialAngle))
}

export function polar2d(
  center: Coords2d,
  radius: number,
  angle: number
): Coords2d {
  return [
    center[0] + Math.cos(angle) * radius,
    center[1] + Math.sin(angle) * radius,
  ]
}

// Returns the signed angle between 2 2D vectors in radians.
// The order of parameter matters:
// getSignedAngleBetweenVec(a, b) = 2 * PI - getSignedAngleBetweenVec(b, a).
// The returned value is in the range [-PI, PI].
//
// Note: utils/getAngle return the unsigned angle.
export function getSignedAngleBetweenVec(a: Coords2d, b: Coords2d) {
  // cross = |a||b| sin(theta)
  // dot = |a||b| cos(theta)
  // atan2(|a||b| sin(theta), |a||b| cos(theta))
  // -> atan2(sin(theta), cos(theta))
  // -> theta
  return Math.atan2(cross2d(a, b), dot2d(a, b))
}

export function getMinorAngleBetweenVec(a: Coords2d, b: Coords2d) {
  const length_a = length2d(a)
  const length_b = length2d(b)
  if (length_a === 0 || length_b === 0) return 0
  return Math.acos(dot2d(a, b) / length_a / length_b)
}

export function addVec(a: Coords2d, b: Coords2d): Coords2d {
  return [a[0] + b[0], a[1] + b[1]]
}

export function scaleVec(a: Coords2d, scale: number): Coords2d {
  return [a[0] * scale, a[1] * scale]
}

export function rotateVec2d(v: Coords2d, angleRadians: number): Coords2d {
  const cosAngle = Math.cos(angleRadians)
  const sinAngle = Math.sin(angleRadians)
  return [v[0] * cosAngle - v[1] * sinAngle, v[0] * sinAngle + v[1] * cosAngle]
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

// Takes a vector given by 2 coords and rotates it 90deg CCW.
export function perpendicular(v: Coords2d): Coords2d {
  return [-v[1], v[0]]
}

export function dot2d(a: Coords2d, b: Coords2d): number {
  return a[0] * b[0] + a[1] * b[1]
}

export function distance2d(a: Coords2d, b: Coords2d): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return Math.sqrt(dx * dx + dy * dy)
}

export function length2d(a: Coords2d): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1])
}

export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
}

export function intersectRanges(
  a: Coords2d,
  b: Coords2d
): [number, number] | null {
  const start = Math.max(a[0], b[0])
  const end = Math.min(a[1], b[1])
  return end >= start ? [start, end] : null
}

export function pointsAreEqual(
  a: Coords2d,
  b: Coords2d,
  epsilon = 1e-8
): boolean {
  return Math.abs(a[0] - b[0]) < epsilon && Math.abs(a[1] - b[1]) < epsilon
}

export function isValidNumber(value: number): boolean {
  return typeof value === 'number' && !Number.isNaN(value) && isFinite(value)
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
