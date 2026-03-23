import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { Vector3 } from 'three'

import {
  getArcPoints,
  getLinePoints,
  isArcLikeSegment,
  isConstraint,
  isLineSegment,
  isPointSegment,
  pointToVec3,
} from '@src/machines/sketchSolve/constraints/constraintUtils'

export type InvisibleConstraint = Extract<
  ApiConstraint,
  {
    type:
      | 'Coincident'
      | 'Horizontal'
      | 'Vertical'
      | 'LinesEqualLength'
      | 'Parallel'
      | 'Perpendicular'
      | 'Tangent'
  }
>

export type InvisibleConstraintObject = ApiObject & {
  kind: { type: 'Constraint'; constraint: InvisibleConstraint }
}

export function isInvisibleConstraintObject(
  obj: ApiObject | undefined | null
): obj is InvisibleConstraintObject {
  if (!obj || !isConstraint(obj)) {
    return false
  }

  switch (obj.kind.constraint.type) {
    case 'Coincident':
    case 'Horizontal':
    case 'Vertical':
    case 'LinesEqualLength':
    case 'Parallel':
    case 'Perpendicular':
    case 'Tangent':
      return true
    default:
      return false
  }
}

export function getInvisibleConstraintSpriteLabel(
  type: InvisibleConstraint['type']
) {
  switch (type) {
    case 'Coincident':
      return 'C'
    case 'Horizontal':
      return 'H'
    case 'Vertical':
      return 'V'
    case 'LinesEqualLength':
      return '='
    case 'Parallel':
      return '||'
    case 'Perpendicular':
      return '90'
    case 'Tangent':
      return 'T'
  }
}

export function getInvisibleConstraintAnchor(
  obj: InvisibleConstraintObject,
  objects: ApiObject[]
): Vector3 | null {
  const constraint = obj.kind.constraint

  switch (constraint.type) {
    case 'Coincident': {
      const pointAnchors = constraint.segments
        .map((segmentId) => objects[segmentId])
        .filter(isPointSegment)
        .map(pointToVec3)

      if (pointAnchors.length > 0) {
        return averageVectors(pointAnchors)
      }

      return averageVectors(
        constraint.segments
          .map((segmentId) => getObjectAnchor(segmentId, objects))
          .filter(isVector3)
      )
    }
    case 'Horizontal':
    case 'Vertical':
      return getLineAnchor(constraint.line, objects)
    case 'LinesEqualLength':
    case 'Parallel':
    case 'Perpendicular':
      return averageVectors(
        constraint.lines
          .map((lineId) => getLineAnchor(lineId, objects))
          .filter(isVector3)
      )
    case 'Tangent': {
      const sharedPoint = getSharedEndpointAnchor(constraint.input, objects)
      if (sharedPoint) {
        return sharedPoint
      }

      return averageVectors(
        constraint.input
          .map((objectId) => getObjectAnchor(objectId, objects))
          .filter(isVector3)
      )
    }
  }
}

function getObjectAnchor(
  objectId: number,
  objects: ApiObject[]
): Vector3 | null {
  const object = objects[objectId]

  if (isPointSegment(object)) {
    return pointToVec3(object)
  }

  if (isLineSegment(object)) {
    return getLineAnchor(objectId, objects)
  }

  if (isArcLikeSegment(object)) {
    const arcPoints = getArcPoints(object, objects)
    if (!arcPoints) {
      return null
    }

    return new Vector3(arcPoints.center[0], arcPoints.center[1], 0)
  }

  return null
}

function getLineAnchor(lineId: number, objects: ApiObject[]): Vector3 | null {
  const linePoints = getLinePoints(objects[lineId], objects)
  if (!linePoints) {
    return null
  }

  return new Vector3(
    (linePoints[0][0] + linePoints[1][0]) * 0.5,
    (linePoints[0][1] + linePoints[1][1]) * 0.5,
    0
  )
}

function getSharedEndpointAnchor(
  objectIds: number[],
  objects: ApiObject[]
): Vector3 | null {
  if (objectIds.length < 2) {
    return null
  }

  const endpointSets = objectIds
    .map((objectId) => getEndpointIds(objects[objectId]))
    .filter((ids): ids is number[] => ids.length > 0)

  if (endpointSets.length < 2) {
    return null
  }

  const sharedIds = endpointSets.reduce<number[]>((sharedIds, endpointIds) => {
    if (sharedIds.length === 0) {
      return [...endpointIds]
    }

    return sharedIds.filter((endpointId) => endpointIds.includes(endpointId))
  }, [])

  return averageVectors(
    sharedIds
      .map((pointId) => objects[pointId])
      .filter(isPointSegment)
      .map(pointToVec3)
  )
}

function getEndpointIds(obj: ApiObject | undefined | null): number[] {
  if (isLineSegment(obj)) {
    return [obj.kind.segment.start, obj.kind.segment.end]
  }

  if (obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Arc') {
    return [obj.kind.segment.start, obj.kind.segment.end]
  }

  if (obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Circle') {
    return [obj.kind.segment.start]
  }

  if (isPointSegment(obj)) {
    return [obj.id]
  }

  return []
}

function averageVectors(vectors: Vector3[]): Vector3 | null {
  if (vectors.length === 0) {
    return null
  }

  return vectors
    .reduce((sum, vector) => sum.add(vector), new Vector3())
    .multiplyScalar(1 / vectors.length)
}

function isVector3(value: Vector3 | null): value is Vector3 {
  return value instanceof Vector3
}
