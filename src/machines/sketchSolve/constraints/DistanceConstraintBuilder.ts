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
  isPointSegment,
  pointToVec3,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  getDistanceConstraintLineStyle,
  shouldRenderDistanceConstraintDashed,
} from '@src/machines/sketchSolve/constraints/distanceConstraintRender'
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
      const { start, end, perp } = getDirections(obj, p1, p2, scale)
      const isCollapsedZeroAxisDistance =
        shouldRenderDistanceConstraintDashed(obj)
      group.visible = true
      this.resources.updateConstraintGroup(
        group,
        obj.id,
        selectedIds,
        hoveredId,
        getDistanceConstraintLineStyle(obj)
      )
      updateDimensionLine(start, end, group, obj, scale, sceneInfra, distance)
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
  const p1 = getDistanceConstraintPointPosition(p1Id, objects)
  const p2 = getDistanceConstraintPointPosition(p2Id, objects)

  if (p1 && p2) {
    return {
      p1,
      p2,
      distance: constraint.distance,
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

function getDirections(
  obj: DistanceConstraint,
  p1: Vector3,
  p2: Vector3,
  scale: number
) {
  const constraintType = obj.kind.constraint.type

  // Perpendicular direction for offset
  let perp: Vector3
  let axis: Vector3
  // Start and end points on the dimension line (after offset)
  let start: Vector3
  let end: Vector3

  if (constraintType === 'HorizontalDistance') {
    // Place distance on the bottom if the points are under the X axis
    const isBottom = (p1.y + p2.y) / 2 < 0
    axis = new Vector3(1, 0, 0)
    perp = new Vector3(0, isBottom ? -1 : 1, 0)
    const offsetY =
      (isBottom ? Math.min(p1.y, p2.y) : Math.max(p1.y, p2.y)) +
      SEGMENT_OFFSET_PX * scale * (isBottom ? -1 : 1)
    start = new Vector3(p1.x, offsetY, 0)
    end = new Vector3(p2.x, offsetY, 0)
  } else if (constraintType === 'VerticalDistance') {
    // Place distance on the left side if the points are more on the left side..
    const isLeft = (p1.x + p2.x) / 2 < 0
    axis = new Vector3(0, 1, 0)
    perp = new Vector3(isLeft ? -1 : 1, 0, 0)
    const offsetX =
      (isLeft ? Math.min(p1.x, p2.x) : Math.max(p1.x, p2.x)) +
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
      const offset = perp.clone().multiplyScalar(SEGMENT_OFFSET_PX * scale)
      start = p1.clone().add(offset)
      end = p2.clone().add(offset)
    }
  } else {
    console.warn('Unhandled constraint type', constraintType)
    start = end = perp = new Vector3()
  }

  return { start, end, perp }
}
