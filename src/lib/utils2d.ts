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
