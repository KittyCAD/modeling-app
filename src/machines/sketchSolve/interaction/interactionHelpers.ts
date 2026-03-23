import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import { distance2d, dot2d, subVec } from '@src/lib/utils2d'
import { getAngleDiff, isArray } from '@src/lib/utils'
import {
  getArcPoints,
  getLinePoints,
  isConstraint,
  isArcLikeSegment,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { Group } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'

type ArcPoints = {
  center: Coords2d
  start: Coords2d
  end: Coords2d
  isCircle?: boolean
}
type LinePoints = {
  type: 'line'
  line: [Coords2d, Coords2d]
}
type HitObject = ({ type: 'arc' } & ArcPoints) | LinePoints
type ConstraintHitObjects = HitObject[] | 'auto'

function distanceToLineSegment(
  point: Coords2d,
  line: readonly [Coords2d, Coords2d]
): number {
  const [start, end] = line
  const segment = subVec(end, start)
  const segmentLengthSquared = dot2d(segment, segment)
  if (segmentLengthSquared === 0) {
    return distance2d(point, start)
  }

  const startToPoint = subVec(point, start)
  const t = Math.max(
    0,
    Math.min(1, dot2d(startToPoint, segment) / segmentLengthSquared)
  )
  const closestPoint: Coords2d = [
    start[0] + segment[0] * t,
    start[1] + segment[1] * t,
  ]

  return distance2d(point, closestPoint)
}

function distanceToArcSegment(point: Coords2d, arc: ArcPoints): number {
  const { center, start, end, isCircle = false } = arc
  const radius = distance2d(center, start)
  if (radius === 0) {
    return distance2d(point, center)
  }

  if (isCircle) {
    return Math.abs(distance2d(point, center) - radius)
  }

  const pointAngle = Math.atan2(point[1] - center[1], point[0] - center[0])
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0])

  const sweepAngle = getAngleDiff(startAngle, endAngle, true)
  const pointSweepAngle = getAngleDiff(startAngle, pointAngle, true)
  const isWithinArcSweep = pointSweepAngle <= sweepAngle

  if (isWithinArcSweep) {
    return Math.abs(distance2d(point, center) - radius)
  }

  return Math.min(distance2d(point, start), distance2d(point, end))
}

function getAutoHitObjects(line: Line2): LinePoints[] {
  const instanceStart = line.geometry.getAttribute?.('instanceStart')
  const instanceEnd = line.geometry.getAttribute?.('instanceEnd')
  if (!instanceStart || !instanceEnd) {
    return []
  }

  const segmentCount = Math.min(instanceStart.count, instanceEnd.count)
  const hitObjects: LinePoints[] = []
  for (let index = 0; index < segmentCount; index++) {
    hitObjects.push({
      type: 'line',
      line: [
        [instanceStart.getX(index), instanceStart.getY(index)],
        [instanceEnd.getX(index), instanceEnd.getY(index)],
      ],
    })
  }
  return hitObjects
}

// Constraint objects contain HitObject information in userData in the children of the Group
function getConstraintHitObjects(constraintGroup: Group): HitObject[] {
  const hitObjects: HitObject[] = []

  constraintGroup.traverse((child) => {
    if (!('hitObjects' in child.userData)) {
      return
    }

    const childHitObjects = child.userData.hitObjects as ConstraintHitObjects
    if (childHitObjects === 'auto') {
      if (child instanceof Line2) {
        hitObjects.push(...getAutoHitObjects(child))
      }
    } else if (isArray(childHitObjects)) {
      hitObjects.push(...childHitObjects)
    }
  })

  return hitObjects
}

function getClosestConstraintHitDistance(
  mousePosition: Coords2d,
  constraintGroup: Group
): number | null {
  let closestDistance: number | null = null

  for (const hitObject of getConstraintHitObjects(constraintGroup)) {
    const distance =
      hitObject.type === 'arc'
        ? distanceToArcSegment(mousePosition, hitObject)
        : distanceToLineSegment(mousePosition, hitObject.line)

    closestDistance =
      closestDistance === null ? distance : Math.min(closestDistance, distance)
  }

  return closestDistance
}

export type ClosestApiObject = {
  distance: number
  apiObject: ApiObject
}

/**
 * Finds the closest apiObject to mousePosition (which is given in sketch space).
 * Uses ApiObjects instead of the three.js scene.
 * Constraints still use the three.js group to avoid having to set up its hit areas manually.
 */
export function findClosestApiObjects(
  mousePosition: Coords2d,
  objects: ApiObject[],
  sceneInfra: SceneInfra
): ClosestApiObject[] {
  const sketchSceneObject = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  const scale = sceneInfra.getClientSceneScaleFactor(
    sketchSceneObject instanceof Group ? sketchSceneObject : null
  )
  // hoverDistance adds some extra hit area for segments to hover over / click on.
  // All segments outside of hoverDistance are dropped.
  // Points always take precedence over other segments to make them easier to target
  // when they overlap line or arc geometry.
  const hoverDistance = 8 * scale

  const candidates: ClosestApiObject[] = []

  objects.forEach((apiObject) => {
    if (isPointSegment(apiObject)) {
      const { position } = apiObject.kind.segment
      const distance = distance2d(mousePosition, [
        position.x.value,
        position.y.value,
      ])
      if (distance <= hoverDistance) {
        candidates.push({
          distance,
          apiObject,
        })
      }
      return
    }

    if (isLineSegment(apiObject)) {
      const linePoints = getLinePoints(apiObject, objects)
      if (linePoints) {
        const distance = distanceToLineSegment(mousePosition, linePoints)
        if (distance <= hoverDistance) {
          candidates.push({
            distance,
            apiObject,
          })
        }
      }
      return
    }

    if (isArcLikeSegment(apiObject)) {
      const arcPoints = getArcPoints(apiObject, objects)
      if (arcPoints) {
        const distance = distanceToArcSegment(mousePosition, arcPoints)
        if (distance <= hoverDistance) {
          candidates.push({
            distance,
            apiObject,
          })
        }
      }
      return
    }

    if (isConstraint(apiObject)) {
      const constraintGroup = sceneInfra.scene.getObjectByName(
        String(apiObject.id)
      )
      if (!(constraintGroup instanceof Group) || !constraintGroup.visible) {
        return
      }

      const distance = getClosestConstraintHitDistance(
        mousePosition,
        constraintGroup
      )

      if (distance !== null && distance <= hoverDistance) {
        candidates.push({
          distance,
          apiObject,
        })
      }
    }
  })

  return candidates.sort((a, b) => {
    const aPriority = isPointSegment(a.apiObject) ? 0 : 1
    const bPriority = isPointSegment(b.apiObject) ? 0 : 1
    return aPriority - bPriority || a.distance - b.distance
  })
}
