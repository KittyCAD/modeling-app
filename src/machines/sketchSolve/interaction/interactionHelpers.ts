import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { Coords2d } from '@src/lang/util'
import { distance2d, dot2d, polar2d, subVec } from '@src/lib/utils2d'
import { getAngleDiff, isArray } from '@src/lib/utils'
import {
  getControlPointSplinePoints,
  getArcPoints,
  getLinePoints,
  isConstraint,
  isArcLikeSegment,
  isControlPointSplineSegment,
  isLineSegment,
  isPointSegment,
  sampleControlPointSplinePoints,
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

export function getClosestPointOnLineSegment(
  point: Coords2d,
  line: readonly [Coords2d, Coords2d]
): { closestPoint: Coords2d; distance: number } {
  const [start, end] = line
  const segment = subVec(end, start)
  const segmentLengthSquared = dot2d(segment, segment)
  if (segmentLengthSquared === 0) {
    return {
      closestPoint: [...start],
      distance: distance2d(point, start),
    }
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

  return {
    closestPoint,
    distance: distance2d(point, closestPoint),
  }
}

export function getClosestPointOnArcSegment(
  point: Coords2d,
  arc: ArcPoints
): { closestPoint: Coords2d; distance: number } {
  const { center, start, end } = arc
  const radius = distance2d(center, start)
  if (radius === 0) {
    return {
      closestPoint: [...center],
      distance: distance2d(point, center),
    }
  }

  const pointAngle = Math.atan2(point[1] - center[1], point[0] - center[0])
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0])
  const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0])

  const sweepAngle = getAngleDiff(startAngle, endAngle, true)
  const pointSweepAngle = getAngleDiff(startAngle, pointAngle, true)
  const isWithinArcSweep = pointSweepAngle <= sweepAngle

  if (isWithinArcSweep) {
    const closestPoint: Coords2d = polar2d(center, radius, pointAngle)
    return {
      closestPoint,
      distance: Math.abs(distance2d(point, center) - radius),
    }
  }

  const closestPoint: Coords2d =
    distance2d(point, start) <= distance2d(point, end) ? [...start] : [...end]
  return {
    closestPoint,
    distance: distance2d(point, closestPoint),
  }
}

export function getClosestPointOnCircleSegment(
  point: Coords2d,
  circle: CirclePoints
): { closestPoint: Coords2d; distance: number } {
  const { center, start } = circle
  const radius = distance2d(center, start)
  if (radius === 0) {
    return {
      closestPoint: [...center],
      distance: distance2d(point, center),
    }
  }

  const pointAngle = Math.atan2(point[1] - center[1], point[0] - center[0])
  const closestPoint: Coords2d = [
    center[0] + radius * Math.cos(pointAngle),
    center[1] + radius * Math.sin(pointAngle),
  ]

  return {
    closestPoint,
    distance: Math.abs(distance2d(point, center) - radius),
  }
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
        ? getClosestPointOnArcSegment(mousePosition, hitObject).distance
        : hitObject.type === 'line'
          ? getClosestPointOnLineSegment(mousePosition, hitObject.line).distance
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
  const centerScreenPosition = localToScreen(
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

function localToScreen(
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

export function getSketchHoverDistance(scale: number) {
  return 10 * scale
}

/**
 * Finds the closest apiObject to mousePosition within hoverDistance (which is given in sketch space).
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
  const hoverDistance = getSketchHoverDistance(scale)
  let mouseScreenPosition: Coords2d | undefined
  const getMouseScreenPosition = () =>
    (mouseScreenPosition ??= localToScreen(
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
        const distance = getClosestPointOnLineSegment(
          mousePosition,
          linePoints
        ).distance
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
          ? getClosestPointOnCircleSegment(mousePosition, arcPoints).distance
          : getClosestPointOnArcSegment(mousePosition, arcPoints).distance
        if (distance <= hoverDistance) {
          candidates.push({
            distance,
            apiObject,
          })
        }
      }
      return
    }

    if (isControlPointSplineSegment(apiObject)) {
      const controlPoints = getControlPointSplinePoints(apiObject, objects)
      if (controlPoints) {
        const sampledPoints = sampleControlPointSplinePoints(
          controlPoints,
          Math.max(
            1,
            Math.min(apiObject.kind.segment.degree, controlPoints.length - 1)
          )
        )
        let closestDistance = Number.POSITIVE_INFINITY

        for (let index = 0; index < sampledPoints.length - 1; index++) {
          closestDistance = Math.min(
            closestDistance,
            getClosestPointOnLineSegment(mousePosition, [
              sampledPoints[index],
              sampledPoints[index + 1],
            ]).distance
          )
        }

        if (closestDistance <= hoverDistance) {
          candidates.push({
            distance: closestDistance,
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
    const priorityDiff = aPriority - bPriority
    if (priorityDiff !== 0) {
      // Take the segment with the higher priority
      return priorityDiff
    }

    // If both segments are points and they are at the same distance, find the one with a higher id.
    // This is to avoid flickering between 2 coincident points.
    if (
      isPointSegment(a.apiObject) &&
      isPointSegment(b.apiObject) &&
      Math.abs(a.distance - b.distance) < 1e-8
    ) {
      return b.apiObject.id - a.apiObject.id
    }
    return a.distance - b.distance
  })
}

function getApiObjectSelectionPriority(apiObject: ApiObject) {
  if (isInvisibleConstraintObject(apiObject)) {
    // Invisible constraints take precedence over everything
    return 0
  }

  if (isPointSegment(apiObject)) {
    // Points take precedence over lines, this is to prefer selecting the point when hovering near the end of a line.
    // (We could also only take precedence if the point is owned by a line..)
    return 1
  }

  if (isControlPointSplineSegment(apiObject)) {
    return 3
  }

  return 2
}
