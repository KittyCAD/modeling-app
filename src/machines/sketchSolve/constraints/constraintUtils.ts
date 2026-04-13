import type {
  ApiConstraint,
  FixedPoint,
  ApiObject,
  Coincident,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { roundOff } from '@src/lib/utils'
import { getSignedAngleBetweenVec, length2d, subVec } from '@src/lib/utils2d'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { SnapshotFrom, StateFrom } from 'xstate'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import type { Object3D, SpriteMaterial, Texture } from 'three'
import { Sprite, Vector3 } from 'three'
import { DISTANCE_CONSTRAINT_LABEL } from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { Coords2d } from '@src/lang/util'
import { getObjectSelectionIds } from '@src/machines/sketchSolve/sketchSolveSelection'
import type { ConstraintSegment } from '@src/machines/sketchSolve/types'

export const CONSTRAINT_TYPE = 'CONSTRAINT'

export function isPointSegment(
  obj: ApiObject | undefined | null
): obj is PointSegment {
  return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Point'
}

export type PointSegment = ApiObject & {
  kind: { type: 'Segment'; segment: { type: 'Point' } }
}

export function pointToVec3(obj: PointSegment) {
  const position = obj.kind.segment.position
  return new Vector3(position.x.value, position.y.value, 0)
}

export function isLineSegment(
  obj: ApiObject | undefined | null
): obj is LineSegment {
  return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Line'
}

export type LineSegment = ApiObject & {
  kind: { type: 'Segment'; segment: { type: 'Line' } }
}

export function isArcSegment(
  obj: ApiObject | undefined | null
): obj is ArcSegment {
  return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Arc'
}

export type ArcSegment = ApiObject & {
  kind: { type: 'Segment'; segment: { type: 'Arc' } }
}

export function isCircleSegment(
  obj: ApiObject | undefined | null
): obj is CircleSegment {
  return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Circle'
}

export type CircleSegment = ApiObject & {
  kind: { type: 'Segment'; segment: { type: 'Circle' } }
}

export function isArcLikeSegment(
  obj: ApiObject | undefined | null
): obj is ArcSegment | CircleSegment {
  return isArcSegment(obj) || isCircleSegment(obj)
}

export function isConstruction(obj: ApiObject | undefined | null): boolean {
  return (
    (isLineSegment(obj) || isArcSegment(obj) || isCircleSegment(obj)) &&
    obj.kind.segment.construction === true
  )
}

export function getLinePointSegments(
  lineObj: ApiObject | undefined | null,
  objects: ApiObject[]
): [PointSegment, PointSegment] | null {
  if (!isLineSegment(lineObj)) {
    return null
  }

  const startObj = objects[lineObj.kind.segment.start]
  const endObj = objects[lineObj.kind.segment.end]
  if (!isPointSegment(startObj) || !isPointSegment(endObj)) {
    return null
  }

  return [startObj, endObj]
}

export function getLinePoints(
  lineObj: ApiObject | undefined | null,
  objects: ApiObject[]
) {
  const pointSegments = getLinePointSegments(lineObj, objects)
  if (!pointSegments) {
    return null
  }
  return [
    pointToCoords2d(pointSegments[0]),
    pointToCoords2d(pointSegments[1]),
  ] as const
}

export function getArcPoints(
  arcObj: ApiObject | undefined | null,
  objects: ApiObject[]
) {
  if (isCircleSegment(arcObj)) {
    const centerObj = objects[arcObj.kind.segment.center]
    const startObj = objects[arcObj.kind.segment.start]
    if (!isPointSegment(centerObj) || !isPointSegment(startObj)) {
      return null
    }

    const start = pointToCoords2d(startObj)

    return {
      center: pointToCoords2d(centerObj),
      start,
      end: start,
      isCircle: true,
    }
  }

  if (!isArcSegment(arcObj)) {
    return null
  }

  const centerObj = objects[arcObj.kind.segment.center]
  const startObj = objects[arcObj.kind.segment.start]
  const endObj = objects[arcObj.kind.segment.end]
  if (
    !isPointSegment(centerObj) ||
    !isPointSegment(startObj) ||
    !isPointSegment(endObj)
  ) {
    return null
  }

  return {
    center: pointToCoords2d(centerObj),
    start: pointToCoords2d(startObj),
    end: pointToCoords2d(endObj),
    isCircle: false,
  }
}

// Returns the current signed angle between 2 lines in degrees, normalized to [0, 360]
function calculateCurrentAngleBetweenLines(
  line1: ApiObject,
  line2: ApiObject,
  objects: ApiObject[]
): number | null {
  const line1Points = getLinePoints(line1, objects)
  const line2Points = getLinePoints(line2, objects)
  if (!line1Points || !line2Points) {
    return null
  }

  const v1 = subVec(line1Points[1], line1Points[0])
  const v2 = subVec(line2Points[1], line2Points[0])
  const v1Length = length2d(v1)
  const v2Length = length2d(v2)
  if (v1Length === 0 || v2Length === 0) {
    return null
  }

  const angleRad = getSignedAngleBetweenVec(v1, v2)
  const angleDeg = (angleRad * 180) / Math.PI
  const normalizedDegrees = ((angleDeg % 360) + 360) % 360
  return roundOff(normalizedDegrees)
}

export function buildAngleConstraintInput(
  line1: ApiObject,
  line2: ApiObject,
  objects: ApiObject[]
) {
  if (!isLineSegment(line1) || !isLineSegment(line2)) {
    return null
  }

  const angle = calculateCurrentAngleBetweenLines(line1, line2, objects)
  if (angle === null) {
    return null
  }

  const shouldFlipLineOrder = angle > 180
  const constraintLines = shouldFlipLineOrder
    ? [line2.id, line1.id]
    : [line1.id, line2.id]
  const constraintAngle = shouldFlipLineOrder ? roundOff(360 - angle) : angle

  return {
    type: 'Angle' as const,
    lines: constraintLines,
    angle: { value: constraintAngle, units: 'Deg' as const },
    source: {
      expr: `${constraintAngle}deg`,
      is_literal: true as const,
    },
  }
}

export function buildTangentConstraintInput(
  selectedIds: number[],
  objects: ApiObject[]
) {
  if (selectedIds.length !== 2) {
    return null
  }

  const selectedObjects = selectedIds.map((id) => objects[id])
  const lineObj = selectedObjects.find(isLineSegment)
  const arcObjects = selectedObjects.filter(isArcLikeSegment)

  if (lineObj && arcObjects.length === 1) {
    // tangent(line, arc)
    const arcObj = arcObjects[0]
    return {
      type: 'Tangent' as const,
      input: [lineObj.id, arcObj.id] as [number, number],
    }
  }

  if (arcObjects.length === 2) {
    // tangent(arc, arc)
    return {
      type: 'Tangent' as const,
      input: [arcObjects[0].id, arcObjects[1].id] as [number, number],
    }
  }

  return null
}

type EqualLengthConstraintInput =
  | Extract<ApiConstraint, { type: 'LinesEqualLength' }>
  | Extract<ApiConstraint, { type: 'EqualRadius' }>

export function buildEqualLengthConstraintInput(
  selectedIds: number[],
  objects: ApiObject[]
): EqualLengthConstraintInput | null {
  if (selectedIds.length < 2) {
    return null
  }

  const selectedObjects = selectedIds.map((id) => objects[id])

  if (selectedObjects.every(isLineSegment)) {
    return {
      type: 'LinesEqualLength',
      lines: selectedIds,
    }
  }

  if (selectedObjects.every(isArcLikeSegment)) {
    return {
      type: 'EqualRadius',
      input: selectedIds,
    }
  }

  return null
}

export function buildFixedConstraintInput(
  selectedIds: number[],
  objects: ApiObject[]
): FixedPoint[] | null {
  if (selectedIds.length === 0) {
    return null
  }

  const fixedPoints: FixedPoint[] = []
  for (const id of selectedIds) {
    const point = objects[id]
    if (!isPointSegment(point)) {
      return null
    }

    fixedPoints.push({
      point: point.id,
      position: point.kind.segment.position,
    })
  }

  return fixedPoints
}

type DistanceConstraintTypes =
  | 'Distance'
  | 'HorizontalDistance'
  | 'VerticalDistance'

export type ConstraintObject = ApiObject & {
  kind: { type: 'Constraint' }
}

/**
 * Utility to filter a scene graph to a typed array of
 * Constraint ApiObjects.
 */
export function isConstraint<C extends ApiConstraint['type']>(
  obj: ApiObject | undefined,
  targetType?: C
): obj is ConstraintObject &
  (C extends undefined
    ? object
    : {
        kind: { constraint: { type: C } }
      }) {
  return (
    obj?.kind.type === 'Constraint' &&
    (targetType ? obj.kind.constraint.type === targetType : true)
  )
}

export type DistanceConstraint = ApiObject & {
  kind: { type: 'Constraint'; constraint: { type: DistanceConstraintTypes } }
}

export function isDistanceConstraint(
  obj: ApiObject
): obj is DistanceConstraint {
  return (
    obj.kind.type === 'Constraint' &&
    (obj.kind.constraint.type === 'Distance' ||
      obj.kind.constraint.type === 'HorizontalDistance' ||
      obj.kind.constraint.type === 'VerticalDistance')
  )
}

export type RadiusConstraint = ApiObject & {
  kind: { type: 'Constraint'; constraint: { type: 'Radius' } }
}

export type DiameterConstraint = ApiObject & {
  kind: { type: 'Constraint'; constraint: { type: 'Diameter' } }
}

export type AngleConstraint = ApiObject & {
  kind: { type: 'Constraint'; constraint: { type: 'Angle' } }
}

export type CoincidentConstraint = ApiObject & {
  kind: { type: 'Constraint'; constraint: { type: 'Coincident' } }
}

export function isCoincidentSegmentId(
  segment: ConstraintSegment
): segment is number {
  return typeof segment === 'number'
}

export function getCoincidentSegmentIds(
  coincident: Pick<Coincident, 'segments'>
): number[] {
  return coincident.segments.filter(isCoincidentSegmentId)
}

export function coincidentContainsSegment(
  coincident: Pick<Coincident, 'segments'>,
  segmentId: number
) {
  return getCoincidentSegmentIds(coincident).includes(segmentId)
}

export function isRadiusConstraint(obj: ApiObject): obj is RadiusConstraint {
  return isConstraint(obj) && obj.kind.constraint.type === 'Radius'
}

export function isDiameterConstraint(
  obj: ApiObject
): obj is DiameterConstraint {
  return isConstraint(obj) && obj.kind.constraint.type === 'Diameter'
}

export function isAngleConstraint(obj: ApiObject): obj is AngleConstraint {
  return isConstraint(obj) && obj.kind.constraint.type === 'Angle'
}

export function isConstraintWithSource(obj: ApiObject) {
  return (
    isDistanceConstraint(obj) ||
    isRadiusConstraint(obj) ||
    isDiameterConstraint(obj) ||
    isAngleConstraint(obj)
  )
}

export function calculateDimensionLabelScreenPosition(
  constraintId: number,
  modelingState: StateFrom<typeof modelingMachine>,
  sceneInfra: SceneInfra
): [number, number] | undefined {
  const constraintObject = getConstraintObject(constraintId, modelingState)
  if (!constraintObject) {
    console.warn(`Constraint object not found`)
    return
  }

  const sketchSolveGroup = sceneInfra.scene.getObjectByName('sketchSolveGroup')
  const constraintGroup = sketchSolveGroup?.getObjectByName(
    constraintId.toString()
  )
  if (!constraintGroup) {
    console.warn(`Constraint group ${constraintId} not found in scene`)
    return
  }
  const label = constraintGroup.children.find(isSpriteLabel)
  if (!label) {
    console.warn(`Label not found in constraint group ${constraintId}`)
    return
  }

  const worldPosition = new Vector3()
  label.getWorldPosition(worldPosition)
  const screenPosition = worldPosition
    .clone()
    .project(sceneInfra.camControls.camera)

  const x =
    (screenPosition.x * 0.5 + 0.5) * sceneInfra.renderer.domElement.clientWidth
  const y =
    (-screenPosition.y * 0.5 + 0.5) *
    sceneInfra.renderer.domElement.clientHeight

  return [x, y]
}

export function getConstraintObject(
  constraintId: number,
  modelingState: StateFrom<typeof modelingMachine>
): ApiObject | undefined {
  const snapshot = getSketchSolveSnapshot(modelingState)
  const objects =
    snapshot?.context?.sketchExecOutcome?.sceneGraphDelta.new_graph.objects ||
    []

  const constraintObject = objects[constraintId]
  return constraintObject
}

export function getSketchSolveSnapshot(
  modelingState: StateFrom<typeof modelingMachine>
): SnapshotFrom<typeof sketchSolveMachine> | undefined {
  return modelingState.children.sketchSolveMachine?.getSnapshot() as
    | SnapshotFrom<typeof sketchSolveMachine>
    | undefined
}

export function getSelectedTangentConstraintInput(
  modelingState: StateFrom<typeof modelingMachine>
) {
  const snapshot = getSketchSolveSnapshot(modelingState)
  const selectedIds = snapshot?.context.selectedIds || []
  const objects =
    snapshot?.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects || []

  return buildTangentConstraintInput(
    getObjectSelectionIds(selectedIds),
    objects
  )
}

export function getSelectedEqualLengthConstraintInput(
  modelingState: StateFrom<typeof modelingMachine>
) {
  const snapshot = getSketchSolveSnapshot(modelingState)
  const selectedIds = snapshot?.context.selectedIds || []
  const objects =
    snapshot?.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects || []

  return buildEqualLengthConstraintInput(getObjectSelectionIds(selectedIds), objects)
}

export function getSelectedFixedConstraintInput(
  modelingState: StateFrom<typeof modelingMachine>
) {
  const snapshot = getSketchSolveSnapshot(modelingState)
  const selectedIds = snapshot?.context.selectedIds || []
  const objects =
    snapshot?.context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects || []

  return buildFixedConstraintInput(getObjectSelectionIds(selectedIds), objects)
}

export type SpriteLabel = Sprite & {
  userData: {
    type: typeof DISTANCE_CONSTRAINT_LABEL
    dimensionLabel: string
    constraintColor: number
    showFnIcon: boolean
    textWidthPx?: number
  }
  material: SpriteMaterial & {
    map: Texture<HTMLCanvasElement>
  }
}

export function isSpriteLabel(child: Object3D): child is SpriteLabel {
  return (
    child instanceof Sprite && child.userData.type === DISTANCE_CONSTRAINT_LABEL
  )
}

export function pointToCoords2d(point: PointSegment): Coords2d {
  return [
    point.kind.segment.position.x.value,
    point.kind.segment.position.y.value,
  ]
}

/**
 * Returns all points that are in the same coincident constraint as the given point,
 * or points that are in a coincident constraint with those point transitively.
 * Eg. coincident constraints:
 * [1, 2], [2, 3], [3, 5]
 * for param: 1 it will return: 1, 2, 3, 5
 *
 * Result includes the given point as well.
 */
export function getCoincidentCluster(
  pointId: number,
  objects: ApiObject[]
): number[] {
  const connectedPointIds = new Set<number>([pointId])
  const pendingPointIds = [pointId]

  while (pendingPointIds.length > 0) {
    const currentPointId = pendingPointIds.pop()
    if (currentPointId === undefined) {
      continue
    }

    const coincidentPointIds = objects
      .filter(
        (obj): obj is CoincidentConstraint =>
          isConstraint(obj, 'Coincident') &&
          coincidentContainsSegment(obj.kind.constraint, currentPointId)
      )
      .flatMap((obj) => getCoincidentSegmentIds(obj.kind.constraint))

    coincidentPointIds.forEach((coincidentPointId) => {
      if (
        !connectedPointIds.has(coincidentPointId) &&
        isPointSegment(objects[coincidentPointId])
      ) {
        connectedPointIds.add(coincidentPointId)
        pendingPointIds.push(coincidentPointId)
      }
    })
  }

  return [...connectedPointIds]
}
