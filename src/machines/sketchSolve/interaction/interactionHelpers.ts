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
import { isInvisibleConstraintObject } from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { Group, Vector3 } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'

type ArcPoints = {
  center: Coords2d
  start: Coords2d
  end: Coords2d
  isCircle?: boolean
}
type CirclePoints = Pick<ArcPoints, 'center' | 'start'>
type LinePoints = {
  type: 'line'
  line: [Coords2d, Coords2d]
}
type ScreenRectHitObject = {
  type: 'screenRect'
  center: [number, number, number]
  sizePx: [number, number]
}
type HitObject =
  | ({ type: 'arc' } & ArcPoints)
  | LinePoints
  | ScreenRectHitObject
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
  const { center, start, end } = arc
  const radius = distance2d(center, start)
  if (radius === 0) {
    return distance2d(point, center)
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

function distanceToCircleSegment(
  point: Coords2d,
  circle: CirclePoints
): number {
  const { center, start } = circle
  const radius = distance2d(center, start)
  if (radius === 0) {
    return distance2d(point, center)
  }

  return Math.abs(distance2d(point, center) - radius)
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
  constraintGroup: Group,
  hoverDistance: number,
  sceneInfra: SceneInfra,
  sketchSceneGroup: Group | null,
  scale: number,
  getMouseScreenPosition: () => Coords2d
): number | null {
  let closestDistance: number | null = null

  for (const hitObject of getConstraintHitObjects(constraintGroup)) {
    const distance =
      hitObject.type === 'arc'
        ? distanceToArcSegment(mousePosition, hitObject)
        : hitObject.type === 'line'
          ? distanceToLineSegment(mousePosition, hitObject.line)
          : distanceToScreenRect(
              getMouseScreenPosition(),
              hitObject,
              sceneInfra,
              sketchSceneGroup,
              scale
            )

    const maxDistance =
      hitObject.type === 'screenRect' ? Number.POSITIVE_INFINITY : hoverDistance
    if (distance === null || distance > maxDistance) {
      continue
    }

    closestDistance =
      closestDistance === null ? distance : Math.min(closestDistance, distance)
  }

  return closestDistance
}

function distanceToScreenRect(
  mouseScreenPosition: Coords2d,
  hitObject: ScreenRectHitObject,
  sceneInfra: SceneInfra,
  sketchSceneGroup: Group | null,
  scale: number
): number | null {
  const centerScreenPosition = projectSketchPointToScreen(
    hitObject.center,
    sceneInfra,
    sketchSceneGroup
  )
  const halfWidth = hitObject.sizePx[0] / 2
  const halfHeight = hitObject.sizePx[1] / 2

  const offsetX = Math.abs(mouseScreenPosition[0] - centerScreenPosition[0])
  const offsetY = Math.abs(mouseScreenPosition[1] - centerScreenPosition[1])
  if (offsetX > halfWidth || offsetY > halfHeight) {
    return null
  }

  return distance2d(mouseScreenPosition, centerScreenPosition) * scale
}

function projectSketchPointToScreen(
  point: [number, number, number],
  sceneInfra: SceneInfra,
  sketchSceneGroup: Group | null
): Coords2d {
  const worldPoint = new Vector3(point[0], point[1], point[2])
  if (sketchSceneGroup) {
    sketchSceneGroup.localToWorld(worldPoint)
  }

  const projected = worldPoint.project(sceneInfra.camControls.camera)
  return [
    ((projected.x + 1) / 2) * sceneInfra.renderer.domElement.clientWidth,
    ((1 - projected.y) / 2) * sceneInfra.renderer.domElement.clientHeight,
  ]
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
  const sketchSceneGroup =
    sketchSceneObject instanceof Group ? sketchSceneObject : null
  const scale = sceneInfra.getClientSceneScaleFactor(sketchSceneGroup)
  // hoverDistance adds some extra hit area for segments to hover over / click on.
  // All segments outside of hoverDistance are dropped.
  // Visible non-visual constraints take precedence over overlapping geometry,
  // then points take precedence over other segments to keep them easy to target.
  const hoverDistance = 8 * scale
  let mouseScreenPosition: Coords2d | undefined
  const getMouseScreenPosition = () =>
    (mouseScreenPosition ??= projectSketchPointToScreen(
      [mousePosition[0], mousePosition[1], 0],
      sceneInfra,
      sketchSceneGroup
    ))

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
        const distance = arcPoints.isCircle
          ? distanceToCircleSegment(mousePosition, arcPoints)
          : distanceToArcSegment(mousePosition, arcPoints)
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
        constraintGroup,
        hoverDistance,
        sceneInfra,
        sketchSceneGroup,
        scale,
        getMouseScreenPosition
      )

      if (distance !== null) {
        candidates.push({
          distance,
          apiObject,
        })
      }
    }
  })

  return candidates.sort((a, b) => {
    const aPriority = getApiObjectSelectionPriority(a.apiObject)
    const bPriority = getApiObjectSelectionPriority(b.apiObject)
    return aPriority - bPriority || a.distance - b.distance
  })
}

function getApiObjectSelectionPriority(apiObject: ApiObject) {
  if (isInvisibleConstraintObject(apiObject)) {
    return 0
  }

  if (isPointSegment(apiObject)) {
    return 1
  }

  return 2
}
