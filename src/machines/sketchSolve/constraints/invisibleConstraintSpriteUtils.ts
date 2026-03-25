import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { Coords2d } from '@src/lang/util'
import { lerp2d } from '@src/lib/utils2d'
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

// Pinned hover-preview state for hidden non-visual constraints.
export type ConstraintHoverPopup = {
  segmentId: number
  position: Coords2d
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

// Returns the (sketch space) position of a non-visual anchor determined by the segments
// the constraint is constraining.
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
    case 'Perpendicular':
      return averageVectors(
        constraint.lines
          .map((lineId) => getLineAnchor(lineId, objects))
          .filter(isVector3)
      )
    case 'Parallel':
      return (
        getLineAnchor(constraint.lines[0], objects, 0.7) ??
        averageVectors(
          constraint.lines
            .map((lineId) => getLineAnchor(lineId, objects))
            .filter(isVector3)
        )
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

export function findInvisibleConstraintsForSegment(
  segment: ApiObject | undefined | null,
  objects: ApiObject[]
): number[] {
  return objects
    .filter(
      (constraint): constraint is InvisibleConstraintObject =>
        isInvisibleConstraintObject(constraint) &&
        isConstrainingSegment(constraint, segment)
    )
    .map((constraint) => constraint.id)
}

export function findSegmentsForInvisibleConstraint(
  constraint: InvisibleConstraintObject,
  objects: ApiObject[]
): number[] {
  const constrainedIds = (() => {
    switch (constraint.kind.constraint.type) {
      case 'Coincident':
        return constraint.kind.constraint.segments
      case 'Horizontal':
      case 'Vertical':
        return [constraint.kind.constraint.line]
      case 'LinesEqualLength':
      case 'Parallel':
      case 'Perpendicular':
        return constraint.kind.constraint.lines
      case 'Tangent':
        return constraint.kind.constraint.input
    }
  })()

  return Array.from(
    new Set(constrainedIds.filter((id) => objects[id]?.kind.type === 'Segment'))
  )
}

// Returns if the given non-visual constraint is constraining the given segment.
// If yes, the constraint is shown when hovering the segment.
export function isConstrainingSegment(
  constraint: InvisibleConstraintObject,
  segment: ApiObject | undefined | null
): boolean {
  switch (constraint.kind.constraint.type) {
    case 'Coincident':
      return isPointSegment(segment)
        ? constraint.kind.constraint.segments.includes(segment.id)
        : false
    case 'Horizontal':
    case 'Vertical':
      return (
        isLineSegment(segment) && constraint.kind.constraint.line === segment.id
      )
    case 'LinesEqualLength':
    case 'Parallel':
    case 'Perpendicular':
      return (
        isLineSegment(segment) &&
        constraint.kind.constraint.lines.includes(segment.id)
      )
    case 'Tangent':
      return (
        (isLineSegment(segment) || isArcLikeSegment(segment)) &&
        constraint.kind.constraint.input.includes(segment.id)
      )
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

function getLineAnchor(
  lineId: number,
  objects: ApiObject[],
  positionAlongLine = 0.5
): Vector3 | null {
  const linePoints = getLinePoints(objects[lineId], objects)
  if (!linePoints) {
    return null
  }

  const anchor = lerp2d(linePoints[0], linePoints[1], positionAlongLine)
  return new Vector3(anchor[0], anchor[1], 0)
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
