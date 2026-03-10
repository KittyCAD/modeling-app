import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { CONSTRAINT_ICON_PATHS } from '@src/components/iconPaths'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { SnapshotFrom, StateFrom } from 'xstate'
import type { sketchSolveMachine } from '@src/machines/sketchSolve/sketchSolveDiagram'
import type { Sprite, SpriteMaterial, Texture } from 'three'
import { Vector3 } from 'three'
import { DISTANCE_CONSTRAINT_LABEL } from '@src/clientSideScene/sceneConstants'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'

export const CONSTRAINT_TYPE = 'CONSTRAINT'

export const NON_VISUAL_CONSTRAINT_TYPES = [
  'Coincident',
  'Parallel',
  'Perpendicular',
  'LinesEqualLength',
  'Horizontal',
  'Vertical',
] as const

const NON_VISUAL_CONSTRAINT_TYPE_SET = new Set<string>(
  NON_VISUAL_CONSTRAINT_TYPES
)

const EDITABLE_CONSTRAINT_TYPES = new Set<string>([
  'Distance',
  'HorizontalDistance',
  'VerticalDistance',
  'Radius',
  'Diameter',
])

export type NonVisualConstraintType =
  (typeof NON_VISUAL_CONSTRAINT_TYPES)[number]

export type ConstraintPlacement = {
  anchor: Vector3
  offsetPx?: {
    x: number
    y: number
  }
}

const POINT_CONSTRAINT_OFFSET_PX = Object.freeze({
  x: 10,
  y: 10,
})

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
  kind: {
    type: 'Segment'
    segment: { type: 'Line'; start: number; end: number }
  }
}

export function isArcSegment(
  obj: ApiObject | undefined | null
): obj is ArcSegment {
  return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Arc'
}

export type ArcSegment = ApiObject & {
  kind: {
    type: 'Segment'
    segment: { type: 'Arc'; start: number; end: number; center: number }
  }
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

export function isRadiusConstraint(obj: ApiObject): obj is RadiusConstraint {
  return isConstraint(obj) && obj.kind.constraint.type === 'Radius'
}

export function isDiameterConstraint(
  obj: ApiObject
): obj is DiameterConstraint {
  return isConstraint(obj) && obj.kind.constraint.type === 'Diameter'
}

export type NonVisualConstraintObject = ApiObject & {
  kind: {
    type: 'Constraint'
    constraint: ApiConstraint & { type: NonVisualConstraintType }
  }
}

export function isNonVisualConstraint(
  obj: ApiObject
): obj is NonVisualConstraintObject {
  return (
    isConstraint(obj) &&
    NON_VISUAL_CONSTRAINT_TYPE_SET.has(obj.kind.constraint.type)
  )
}

export function isEditableConstraint(obj: ApiObject): boolean {
  return (
    isConstraint(obj) && EDITABLE_CONSTRAINT_TYPES.has(obj.kind.constraint.type)
  )
}

export function getConstraintIconPath(type: NonVisualConstraintType): string {
  switch (type) {
    case 'Coincident':
      return CONSTRAINT_ICON_PATHS.coincident
    case 'LinesEqualLength':
      return CONSTRAINT_ICON_PATHS.equal
    case 'Horizontal':
      return CONSTRAINT_ICON_PATHS.horizontal
    case 'Parallel':
      return CONSTRAINT_ICON_PATHS.parallel
    case 'Perpendicular':
      return CONSTRAINT_ICON_PATHS.perpendicular
    case 'Vertical':
      return CONSTRAINT_ICON_PATHS.vertical
  }
}

export function getNonVisualConstraintAnchor(
  obj: NonVisualConstraintObject,
  objects: ApiObject[]
): Vector3 | null {
  const constraint = obj.kind.constraint

  switch (constraint.type) {
    case 'Horizontal':
    case 'Vertical':
      return getEntityAnchor(constraint.line, objects)
    case 'Parallel':
    case 'Perpendicular':
    case 'LinesEqualLength':
      return getAverageAnchor(constraint.lines, objects)
    case 'Coincident':
      return getAverageAnchor(constraint.segments, objects)
  }
}

export function getNonVisualConstraintPlacement(
  obj: NonVisualConstraintObject,
  objects: ApiObject[]
): ConstraintPlacement | null {
  const anchor = getNonVisualConstraintAnchor(obj, objects)
  if (!anchor) {
    return null
  }

  if (obj.kind.constraint.type === 'Coincident') {
    const pointAnchor = getAveragePointAnchor(
      obj.kind.constraint.segments,
      objects
    )
    if (pointAnchor) {
      return {
        anchor: pointAnchor,
        offsetPx: POINT_CONSTRAINT_OFFSET_PX,
      }
    }
  }

  return { anchor }
}

function getAverageAnchor(ids: number[], objects: ApiObject[]): Vector3 | null {
  const anchors = ids
    .map((id) => getEntityAnchor(id, objects))
    .filter((anchor): anchor is Vector3 => anchor !== null)

  if (anchors.length !== ids.length || anchors.length === 0) {
    return null
  }

  const total = anchors.reduce(
    (acc, anchor) => acc.add(anchor),
    new Vector3(0, 0, 0)
  )

  return total.multiplyScalar(1 / anchors.length)
}

function getAveragePointAnchor(
  ids: number[],
  objects: ApiObject[]
): Vector3 | null {
  const pointAnchors = ids
    .map((id) => objects[id])
    .filter(isPointSegment)
    .map(pointToVec3)

  if (pointAnchors.length === 0) {
    return null
  }

  const total = pointAnchors.reduce(
    (acc, pointAnchor) => acc.add(pointAnchor),
    new Vector3(0, 0, 0)
  )

  return total.multiplyScalar(1 / pointAnchors.length)
}

function getEntityAnchor(id: number, objects: ApiObject[]): Vector3 | null {
  const obj = objects[id]

  if (isPointSegment(obj)) {
    return pointToVec3(obj)
  }

  if (isLineSegment(obj)) {
    const start = objects[obj.kind.segment.start]
    const end = objects[obj.kind.segment.end]
    if (!isPointSegment(start) || !isPointSegment(end)) {
      return null
    }

    return pointToVec3(start).lerp(pointToVec3(end), 0.5)
  }

  if (isArcSegment(obj)) {
    const center = objects[obj.kind.segment.center]
    const start = objects[obj.kind.segment.start]
    const end = objects[obj.kind.segment.end]
    if (
      !isPointSegment(center) ||
      !isPointSegment(start) ||
      !isPointSegment(end)
    ) {
      return null
    }

    const centerVec = pointToVec3(center)
    const startVec = pointToVec3(start)
    const endVec = pointToVec3(end)
    const radius = centerVec.distanceTo(startVec)
    const startAngle = Math.atan2(
      startVec.y - centerVec.y,
      startVec.x - centerVec.x
    )
    const endAngle = Math.atan2(endVec.y - centerVec.y, endVec.x - centerVec.x)
    let delta = endAngle - startAngle
    if (delta < 0) {
      delta += Math.PI * 2
    }
    const midAngle = startAngle + delta / 2

    return new Vector3(
      centerVec.x + Math.cos(midAngle) * radius,
      centerVec.y + Math.sin(midAngle) * radius,
      0
    )
  }

  return null
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
