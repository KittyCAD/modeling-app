import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  DISTANCE_CONSTRAINT_BODY,
  DISTANCE_CONSTRAINT_LEADER_LINE,
} from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  createDimensionLine,
  updateConstraintLinePositions,
  updateDimensionLine,
} from '@src/machines/sketchSolve/constraints/DimensionLine'
import {
  type DistanceConstraint,
  getLinePointSegments,
  isArcSegment,
  isCircleSegment,
  isLineSegment,
  isPointSegment,
  pointToVec3,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { type Group, Vector3 } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'

const SEGMENT_OFFSET_PX = 30 // Distances are placed 30 pixels from the segment
const LEADER_LINE_OVERHANG = 2 // Leader lines have 2px overhang past arrows

export class DistanceConstraintBuilder {
  private readonly resources: ConstraintResources

  constructor(resources: ConstraintResources) {
    this.resources = resources
  }

  public init(obj: DistanceConstraint) {
    const group = createDimensionLine(obj, this.resources)
    this.createLeaderLines(group)
    return group
  }

  public update(
    group: Group,
    obj: DistanceConstraint,
    objects: ApiObject[],
    scale: number,
    sceneInfra: SceneInfra,
    selectedIds: number[],
    hoveredId: number | null
  ) {
    const points = getDistanceEndPoints(obj, objects)
    if (points) {
      const { p1, p2, distance } = points
      const labelPosition = getDistanceLabelPosition(obj)
      const { start, end, perp } = getDirections(
        obj,
        p1,
        p2,
        scale,
        labelPosition
      )
      const isCollapsedZeroAxisDistance =
        obj.kind.constraint.distance.value === 0 &&
        (obj.kind.constraint.type === 'HorizontalDistance' ||
          obj.kind.constraint.type === 'VerticalDistance')
      group.visible = true
      this.resources.updateConstraintGroup(
        group,
        obj.id,
        selectedIds,
        hoveredId,
        isCollapsedZeroAxisDistance ? 'dashed' : 'solid'
      )
      updateDimensionLine(
        start,
        end,
        group,
        obj,
        scale,
        sceneInfra,
        distance,
        false,
        labelPosition
      )
      if (isCollapsedZeroAxisDistance) {
        this.updateCollapsedZeroDistanceLine(start, perp, p1, p2, group, scale)
      }
      this.updateLeaderLines(
        start,
        end,
        perp,
        p1,
        p2,
        group,
        scale,
        isCollapsedZeroAxisDistance
      )
    }
  }

  private createLeaderLines(group: Group) {
    const materials = this.resources.materials

    const leadGeom1 = new LineGeometry()
    const leadLine1 = new Line2(leadGeom1, materials.default.line)
    leadLine1.userData.type = DISTANCE_CONSTRAINT_LEADER_LINE
    leadLine1.userData.hitObjects = 'auto'
    leadLine1.userData.segmentStart = new Vector3()
    leadLine1.userData.segmentEnd = new Vector3()
    updateConstraintLinePositions(leadLine1, [0, 0, 0, 100, 100, 0])
    group.add(leadLine1)

    const leadGeom2 = new LineGeometry()
    const leadLine2 = new Line2(leadGeom2, materials.default.line)
    leadLine2.userData.type = DISTANCE_CONSTRAINT_LEADER_LINE
    leadLine2.userData.hitObjects = 'auto'
    leadLine2.userData.segmentStart = new Vector3()
    leadLine2.userData.segmentEnd = new Vector3()
    updateConstraintLinePositions(leadLine2, [0, 0, 0, 100, 100, 0])
    group.add(leadLine2)
  }

  private updateLeaderLines(
    start: Vector3,
    end: Vector3,
    perp: Vector3,
    p1: Vector3,
    p2: Vector3,
    group: Group,
    scale: number,
    hidden = false
  ) {
    const leadLines = group.children.filter(
      (child) => child.userData.type === DISTANCE_CONSTRAINT_LEADER_LINE
    )
    const leadLine1 = leadLines[0] as Line2
    const leadLine2 = leadLines[1] as Line2

    leadLine1.visible = !hidden
    leadLine2.visible = !hidden
    if (hidden) {
      return
    }

    // Leader lines
    const extension = perp
      .clone()
      .normalize()
      .multiplyScalar(LEADER_LINE_OVERHANG * scale)
    const leadEnd1 = start.clone().add(extension)
    const leadEnd2 = end.clone().add(extension)

    updateConstraintLinePositions(leadLine1, [
      p1.x,
      p1.y,
      0,
      leadEnd1.x,
      leadEnd1.y,
      0,
    ])

    updateConstraintLinePositions(leadLine2, [
      p2.x,
      p2.y,
      0,
      leadEnd2.x,
      leadEnd2.y,
      0,
    ])
  }

  private updateCollapsedZeroDistanceLine(
    start: Vector3,
    perp: Vector3,
    p1: Vector3,
    p2: Vector3,
    group: Group,
    scale: number
  ) {
    const collapsedLine = group.children.find(
      (child) => child.userData.type === DISTANCE_CONSTRAINT_BODY
    ) as Line2 | undefined
    if (!collapsedLine) {
      return
    }

    const direction = perp.clone().normalize()
    const lineEnd = start
      .clone()
      .add(direction.clone().multiplyScalar(LEADER_LINE_OVERHANG * scale))
    const lineStart = getCollapsedZeroDistanceLineStart(
      [p1.x, p1.y],
      [p2.x, p2.y],
      [direction.x, direction.y]
    )

    updateConstraintLinePositions(collapsedLine, [
      lineStart[0],
      lineStart[1],
      0,
      lineEnd.x,
      lineEnd.y,
      0,
    ])
  }
}

function getDistanceLabelPosition(obj: DistanceConstraint) {
  const constraint = obj.kind.constraint
  if (!constraint.labelPosition) {
    return undefined
  }

  return new Vector3(
    constraint.labelPosition.x.value,
    constraint.labelPosition.y.value,
    0
  )
}

function getCollapsedZeroDistanceLineStart(
  p1: readonly [number, number],
  p2: readonly [number, number],
  direction: readonly [number, number]
): [number, number] {
  const p1Projection = p1[0] * direction[0] + p1[1] * direction[1]
  const p2Projection = p2[0] * direction[0] + p2[1] * direction[1]

  return p1Projection <= p2Projection ? [p1[0], p1[1]] : [p2[0], p2[1]]
}

export function getDistanceEndPoints(
  obj: DistanceConstraint,
  objects: ApiObject[]
) {
  const constraint = obj.kind.constraint
  const [p1Id, p2Id] = constraint.points
  const endpoints = getDistanceConstraintEndpointPositions(p1Id, p2Id, objects)

  if (endpoints) {
    const { p1, p2 } = endpoints
    return {
      p1,
      p2,
      distance: constraint.distance,
    }
  }
  return null
}

function getDistanceConstraintEndpointPositions(
  firstId: number | 'ORIGIN',
  secondId: number | 'ORIGIN',
  objects: ApiObject[]
) {
  const firstPoint = getDistanceConstraintPointPosition(firstId, objects)
  const secondPoint = getDistanceConstraintPointPosition(secondId, objects)
  if (firstPoint && secondPoint) {
    return { p1: firstPoint, p2: secondPoint }
  }

  const firstLine = getDistanceConstraintLinePoints(firstId, objects)
  const secondLine = getDistanceConstraintLinePoints(secondId, objects)
  const firstCircular = getDistanceConstraintCircular(firstId, objects)
  const secondCircular = getDistanceConstraintCircular(secondId, objects)

  if (firstPoint && secondLine) {
    return {
      p1: firstPoint,
      p2: projectPointToLine(firstPoint, secondLine),
    }
  }

  if (firstLine && secondPoint) {
    return {
      p1: projectPointToLine(secondPoint, firstLine),
      p2: secondPoint,
    }
  }

  if (firstPoint && secondCircular) {
    return {
      p1: firstPoint,
      p2: projectPointToCircular(firstPoint, secondCircular),
    }
  }

  if (firstCircular && secondPoint) {
    return {
      p1: projectPointToCircular(secondPoint, firstCircular),
      p2: secondPoint,
    }
  }

  if (firstLine && secondCircular) {
    const linePoint = projectPointToLine(secondCircular.center, firstLine)
    return {
      p1: linePoint,
      p2: projectPointToCircular(linePoint, secondCircular),
    }
  }

  if (firstCircular && secondLine) {
    const linePoint = projectPointToLine(firstCircular.center, secondLine)
    return {
      p1: projectPointToCircular(linePoint, firstCircular),
      p2: linePoint,
    }
  }

  if (firstCircular && secondCircular) {
    return getCircularCircularDistanceEndpointPositions(
      firstCircular,
      secondCircular
    )
  }

  if (firstLine && secondLine) {
    return {
      p1: firstLine.start,
      p2: projectPointToLine(firstLine.start, secondLine),
    }
  }

  return null
}

function getDistanceConstraintPointPosition(
  pointId: number | 'ORIGIN',
  objects: ApiObject[]
) {
  if (pointId === 'ORIGIN') {
    return new Vector3(0, 0, 0)
  }

  const pointObject = objects[pointId]
  return isPointSegment(pointObject) ? pointToVec3(pointObject) : null
}

function getDistanceConstraintLinePoints(
  lineId: number | 'ORIGIN',
  objects: ApiObject[]
) {
  if (lineId === 'ORIGIN') {
    return null
  }

  const lineObject = objects[lineId]
  if (!isLineSegment(lineObject)) {
    return null
  }

  const linePoints = getLinePointSegments(lineObject, objects)
  if (!linePoints) {
    return null
  }

  return {
    start: pointToVec3(linePoints[0]),
    end: pointToVec3(linePoints[1]),
  }
}

function getDistanceConstraintCircular(
  circularId: number | 'ORIGIN',
  objects: ApiObject[]
) {
  if (circularId === 'ORIGIN') {
    return null
  }

  const circularObject = objects[circularId]
  if (!isArcSegment(circularObject) && !isCircleSegment(circularObject)) {
    return null
  }

  const centerObject = objects[circularObject.kind.segment.center]
  const startObject = objects[circularObject.kind.segment.start]
  if (!isPointSegment(centerObject) || !isPointSegment(startObject)) {
    return null
  }

  const center = pointToVec3(centerObject)
  const start = pointToVec3(startObject)
  return {
    center,
    start,
    radius: center.distanceTo(start),
  }
}

function projectPointToLine(
  point: Vector3,
  line: { start: Vector3; end: Vector3 }
) {
  const lineVector = line.end.clone().sub(line.start)
  const lengthSq = lineVector.lengthSq()
  if (lengthSq === 0) {
    return line.start.clone()
  }

  const t = point.clone().sub(line.start).dot(lineVector) / lengthSq
  return line.start.clone().add(lineVector.multiplyScalar(t))
}

function projectPointToCircular(
  point: Vector3,
  circular: { center: Vector3; start: Vector3; radius: number }
) {
  const direction = point.clone().sub(circular.center)
  if (direction.lengthSq() === 0) {
    direction.copy(circular.start).sub(circular.center)
  }
  if (direction.lengthSq() === 0) {
    direction.set(1, 0, 0)
  }

  return circular.center
    .clone()
    .add(direction.normalize().multiplyScalar(circular.radius))
}

function getCircularCircularDistanceEndpointPositions(
  firstCircular: { center: Vector3; start: Vector3; radius: number },
  secondCircular: { center: Vector3; start: Vector3; radius: number }
) {
  const direction = secondCircular.center.clone().sub(firstCircular.center)
  if (direction.lengthSq() === 0) {
    direction.copy(firstCircular.start).sub(firstCircular.center)
  }
  if (direction.lengthSq() === 0) {
    direction.set(1, 0, 0)
  }

  const unitDirection = direction.normalize()
  return {
    p1: firstCircular.center
      .clone()
      .add(unitDirection.clone().multiplyScalar(firstCircular.radius)),
    p2: secondCircular.center
      .clone()
      .add(unitDirection.clone().multiplyScalar(-secondCircular.radius)),
  }
}

function getDirections(
  obj: DistanceConstraint,
  p1: Vector3,
  p2: Vector3,
  scale: number,
  labelPosition?: Vector3
) {
  const constraintType = obj.kind.constraint.type

  // Perpendicular direction for offset
  let perp: Vector3
  let axis: Vector3
  // Start and end points on the dimension line (after offset)
  let start: Vector3
  let end: Vector3

  if (constraintType === 'HorizontalDistance') {
    axis = new Vector3(1, 0, 0)
    // Place distance on the bottom if the points are under the X axis
    const isBottom = labelPosition
      ? labelPosition.y < (p1.y + p2.y) / 2
      : (p1.y + p2.y) / 2 < 0
    perp = new Vector3(0, isBottom ? -1 : 1, 0)
    const offsetY = labelPosition
      ? labelPosition.y
      : (isBottom ? Math.min(p1.y, p2.y) : Math.max(p1.y, p2.y)) +
        SEGMENT_OFFSET_PX * scale * (isBottom ? -1 : 1)
    start = new Vector3(p1.x, offsetY, 0)
    end = new Vector3(p2.x, offsetY, 0)
  } else if (constraintType === 'VerticalDistance') {
    axis = new Vector3(0, 1, 0)
    // Place distance on the left side if the points are more on the left side.
    const isLeft = labelPosition
      ? labelPosition.x < (p1.x + p2.x) / 2
      : (p1.x + p2.x) / 2 < 0
    perp = new Vector3(isLeft ? -1 : 1, 0, 0)
    const offsetX = labelPosition
      ? labelPosition.x
      : (isLeft ? Math.min(p1.x, p2.x) : Math.max(p1.x, p2.x)) +
        SEGMENT_OFFSET_PX * scale * (isLeft ? -1 : 1)
    start = new Vector3(offsetX, p1.y, 0)
    end = new Vector3(offsetX, p2.y, 0)
  } else if (constraintType === 'Distance') {
    if (obj.kind.constraint.distance.value === 0) {
      // zero length distance
      const isLeft = (p1.x + p2.x) / 2 < 0
      axis = new Vector3(0, 1, 0)
      perp = new Vector3(isLeft ? -1 : 1, 0, 0)
      const offsetX =
        (isLeft ? Math.min(p1.x, p2.x) : Math.max(p1.x, p2.x)) +
        SEGMENT_OFFSET_PX * scale * (isLeft ? -1 : 1)
      const centerY = (p1.y + p2.y) / 2
      start = new Vector3(offsetX, centerY, 0)
      end = start.clone()
    } else {
      // "Distance": line is parallel to the segment
      axis = p2.clone().sub(p1).normalize()
      if (axis.lengthSq() === 0) {
        axis.set(1, 0, 0)
      }
      perp = new Vector3(-axis.y, axis.x, 0)
      const offsetDistance = labelPosition
        ? labelPosition.clone().sub(p1).dot(perp)
        : SEGMENT_OFFSET_PX * scale
      const offset = perp.clone().multiplyScalar(offsetDistance)
      start = p1.clone().add(offset)
      end = p2.clone().add(offset)
    }
  } else {
    console.warn('Unhandled constraint type', constraintType)
    start = end = perp = new Vector3()
  }

  return { start, end, perp }
}
