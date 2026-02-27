import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { SnapshotFrom, StateFrom } from 'xstate'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import type { Sprite, SpriteMaterial, Texture } from 'three'
import { Vector3 } from 'three'
import { DISTANCE_CONSTRAINT_LABEL } from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { Coords2d } from '@src/lang/util'

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

export function getLineEndpoints(
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

type DistanceConstraintTypes =
  | 'Distance'
  | 'HorizontalDistance'
  | 'VerticalDistance'

export type ConstraintObject = ApiObject & {
  kind: { type: 'Constraint' }
}

export function isConstraint(obj: ApiObject): obj is ConstraintObject {
  return obj.kind.type === 'Constraint'
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
  const label = constraintGroup.children.find(
    (child) => child.userData.type === DISTANCE_CONSTRAINT_LABEL
  ) as SpriteLabel | undefined
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
  const snapshot = modelingState.children.sketchSolveMachine?.getSnapshot() as
    | SnapshotFrom<typeof sketchSolveMachine>
    | undefined
  const objects =
    snapshot?.context?.sketchExecOutcome?.sceneGraphDelta.new_graph.objects ||
    []

  const constraintObject = objects[constraintId]
  return constraintObject
}

export type SpriteLabel = Sprite & {
  userData: {
    type: typeof DISTANCE_CONSTRAINT_LABEL
    dimensionLabel: string
    constraintColor: number
    showFnIcon: boolean
  }
  material: SpriteMaterial & {
    map: Texture<HTMLCanvasElement>
  }
}

export function pointToCoords2d(point: PointSegment): Coords2d {
  return [
    point.kind.segment.position.x.value,
    point.kind.segment.position.y.value,
  ]
}
