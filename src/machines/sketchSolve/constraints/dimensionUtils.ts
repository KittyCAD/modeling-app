import type {
  ApiConstraint,
  ApiObject,
  ApiObjectKind,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { SnapshotFrom, StateFrom } from 'xstate'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import type { Sprite, SpriteMaterial, Texture } from 'three'
import { Vector3 } from 'three'
import { DISTANCE_CONSTRAINT_LABEL } from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

export const CONSTRAINT_TYPE = 'CONSTRAINT'

export function getDistanceEndPoints(obj: ApiObject, objects: ApiObject[]) {
  if (!isDistanceConstraint(obj.kind)) {
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

export function isPointSegment(
  obj: ApiObject | undefined
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

export function isDistanceConstraint(kind: ApiObjectKind): kind is {
  type: 'Constraint'
  constraint: Extract<
    ApiConstraint,
    { type: 'Distance' | 'HorizontalDistance' | 'VerticalDistance' }
  >
} {
  return (
    kind.type === 'Constraint' &&
    (kind.constraint.type === 'Distance' ||
      kind.constraint.type === 'HorizontalDistance' ||
      kind.constraint.type === 'VerticalDistance')
  )
}

export function isRadiusConstraint(kind: ApiObjectKind): kind is {
  type: 'Constraint'
  constraint: Extract<ApiConstraint, { type: 'Radius' }>
} {
  return kind.type === 'Constraint' && kind.constraint.type === 'Radius'
}

export function isDiameterConstraint(kind: ApiObjectKind): kind is {
  type: 'Constraint'
  constraint: Extract<ApiConstraint, { type: 'Diameter' }>
} {
  return kind.type === 'Constraint' && kind.constraint.type === 'Diameter'
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
