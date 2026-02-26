import type { ConstraintResources } from '@src/machines/sketchSolve/constraints/ConstraintResources'
import {
  isDistanceConstraint,
  isPointSegment,
  pointToVec3,
  type DistanceConstraint,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  createDimensionLine,
  DIMENSION_HIDE_THRESHOLD_PX,
  HIT_AREA_WIDTH_PX,
  updateDimensionLine,
  updateLineHitArea,
} from '@src/machines/sketchSolve/constraints/DimensionLine'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry'
import { Line2 } from 'three/examples/jsm/lines/Line2'
import {
  DISTANCE_CONSTRAINT_HIT_AREA,
  DISTANCE_CONSTRAINT_LEADER_LINE,
} from '@src/clientSideScene/sceneConstants'
import { type Group, Mesh, Vector3 } from 'three'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

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
    obj: ApiObject,
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
      const dimensionLengthPx = start.distanceTo(end) / scale
      if (dimensionLengthPx < DIMENSION_HIDE_THRESHOLD_PX) {
        group.visible = false
        return
      }
      group.visible = true
      this.resources.updateConstraintGroup(
        group,
        obj.id,
        selectedIds,
        hoveredId
      )
      updateDimensionLine(start, end, group, obj, scale, sceneInfra, distance)
      this.updateLeaderLines(start, end, perp, p1, p2, group, scale)
    }
  }

  private createLeaderLines(group: Group) {
    const materials = this.resources.materials

    const leadGeom1 = new LineGeometry()
    leadGeom1.setPositions([0, 0, 0, 100, 100, 0])
    const leadLine1 = new Line2(leadGeom1, materials.default.line)
    leadLine1.userData.type = DISTANCE_CONSTRAINT_LEADER_LINE
    group.add(leadLine1)

    const leadGeom2 = new LineGeometry()
    leadGeom2.setPositions([0, 0, 0, 100, 100, 0])
    const leadLine2 = new Line2(leadGeom2, materials.default.line)
    leadLine2.userData.type = DISTANCE_CONSTRAINT_LEADER_LINE
    group.add(leadLine2)

    // Hit areas for click detection (invisible but raycasted)
    const leadLine1HitArea = new Mesh(
      this.resources.planeGeometry,
      materials.hitArea
    )
    leadLine1HitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
    leadLine1HitArea.userData.subtype = DISTANCE_CONSTRAINT_LEADER_LINE
    group.add(leadLine1HitArea)

    const leadLine2HitArea = new Mesh(
      this.resources.planeGeometry,
      materials.hitArea
    )
    leadLine2HitArea.userData.type = DISTANCE_CONSTRAINT_HIT_AREA
    leadLine2HitArea.userData.subtype = DISTANCE_CONSTRAINT_LEADER_LINE
    group.add(leadLine2HitArea)
  }

  private updateLeaderLines(
    start: Vector3,
    end: Vector3,
    perp: Vector3,
    p1: Vector3,
    p2: Vector3,
    group: Group,
    scale: number
  ) {
    // Leader lines
    const extension = perp
      .clone()
      .normalize()
      .multiplyScalar(LEADER_LINE_OVERHANG * scale)
    const leadEnd1 = start.clone().add(extension)
    const leadEnd2 = end.clone().add(extension)

    const leadLines = group.children.filter(
      (child) => child.userData.type === DISTANCE_CONSTRAINT_LEADER_LINE
    )
    const leadLine1 = leadLines[0] as Line2
    const leadLine2 = leadLines[1] as Line2

    leadLine1.geometry.setPositions([p1.x, p1.y, 0, leadEnd1.x, leadEnd1.y, 0])
    leadLine2.geometry.setPositions([p2.x, p2.y, 0, leadEnd2.x, leadEnd2.y, 0])

    // Update hit areas for leader lines
    const leaderHitAreas = group.children.filter(
      (child) =>
        child.userData.type === DISTANCE_CONSTRAINT_HIT_AREA &&
        child.userData.subtype === DISTANCE_CONSTRAINT_LEADER_LINE
    ) as Mesh[]
    if (leaderHitAreas[0]) {
      updateLineHitArea(
        leaderHitAreas[0],
        p1,
        leadEnd1,
        HIT_AREA_WIDTH_PX * scale
      )
    }
    if (leaderHitAreas[1]) {
      updateLineHitArea(
        leaderHitAreas[1],
        p2,
        leadEnd2,
        HIT_AREA_WIDTH_PX * scale
      )
    }
  }
}

export function getDistanceEndPoints(obj: ApiObject, objects: ApiObject[]) {
  if (!isDistanceConstraint(obj)) {
    return null
  }

  const constraint = obj.kind.constraint
  const [p1Id, p2Id] = constraint.points
  const p1Obj = objects[p1Id]
  const p2Obj = objects[p2Id]

  if (isPointSegment(p1Obj) && isPointSegment(p2Obj)) {
    return {
      p1: pointToVec3(p1Obj),
      p2: pointToVec3(p2Obj),
      distance: constraint.distance,
    }
  }
  return null
}

function getDirections(
  obj: ApiObject,
  p1: Vector3,
  p2: Vector3,
  scale: number
) {
  const constraintType =
    obj.kind.type === 'Constraint' ? obj.kind.constraint.type : 'Distance'

  // Perpendicular direction for offset
  let perp: Vector3
  // Start and end points on the dimension line (after offset)
  let start: Vector3
  let end: Vector3

  if (constraintType === 'HorizontalDistance') {
    // Place distance on the bottom if the points are under the X axis
    const isBottom = (p1.y + p2.y) / 2 < 0
    perp = new Vector3(0, isBottom ? -1 : 1, 0)
    const offsetY =
      (isBottom ? Math.min(p1.y, p2.y) : Math.max(p1.y, p2.y)) +
      SEGMENT_OFFSET_PX * scale * (isBottom ? -1 : 1)
    start = new Vector3(p1.x, offsetY, 0)
    end = new Vector3(p2.x, offsetY, 0)
  } else if (constraintType === 'VerticalDistance') {
    // Place distance on the left side if the points are more on the left side..
    const isLeft = (p1.x + p2.x) / 2 < 0
    perp = new Vector3(isLeft ? -1 : 1, 0, 0)
    const offsetX =
      (isLeft ? Math.min(p1.x, p2.x) : Math.max(p1.x, p2.x)) +
      SEGMENT_OFFSET_PX * scale * (isLeft ? -1 : 1)
    start = new Vector3(offsetX, p1.y, 0)
    end = new Vector3(offsetX, p2.y, 0)
  } else {
    // "Distance": line is parallel to the segment
    const dir = p2.clone().sub(p1).normalize()
    perp = new Vector3(-dir.y, dir.x, 0)
    const offset = perp.clone().multiplyScalar(SEGMENT_OFFSET_PX * scale)
    start = p1.clone().add(offset)
    end = p2.clone().add(offset)
  }

  return { start, end, perp }
}
