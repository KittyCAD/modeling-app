import type {
  ApiObject,
  SceneGraphDelta,
  SegmentCtor,
  Expr,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { StateEffect } from '@codemirror/state'
import { Group } from 'three'
import { disposeGroupChildren } from '@src/clientSideScene/sceneHelpers'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import {
  SKETCH_LAYER,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import {
  segmentUtilsMap,
  resetSketchSolvePointHandleCount,
  type SegmentRenderState,
} from '@src/machines/sketchSolve/segments'
import type { Themes } from '@src/lib/theme'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import { deriveSegmentFreedom } from '@src/machines/sketchSolve/segmentsUtils'
import { getSketchSolveBlockingIssues } from '@src/machines/sketchSolve/sketchSolveErrors'
import { updateOriginSprite } from '@src/machines/sketchSolve/originSprite'
import {
  isPointSegment,
  isCircleSegment,
  isControlPointSplineSegment,
  isConstruction as isConstructionSegment,
  isConstraint,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  ORIGIN_TARGET,
  getObjectSelectionIds,
  isObjectSelectionId,
  type SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import type { InvisibleConstraintDisplayState } from '@src/machines/sketchSolve/constraints/InvisibleConstraintSpriteBuilder'
import {
  isInvisibleConstraintObject,
  findSegmentsForInvisibleConstraint,
  isInvisibleConstraintSegmentSecondaryHovered,
  getInvisibleConstraintSegmentHoverColor,
  type ConstraintHoverPopup,
} from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'

/** Rendering a sketch delta needs presentation state, not a modeling actor or document manager. */
export interface SketchSceneContext {
  sketchId: number
  sceneInfra: SceneInfra
  sceneEntitiesManager: { sketchSolveGroup: Group }
  selectedIds: SketchSolveSelectionId[]
  hoveredId: SketchSolveSelectionId | null
  showNonVisualConstraints: boolean
  constraintHoverPopups: ConstraintHoverPopup[]
  draftEntities?: { segmentIds: number[]; constraintIds: number[] }
}
/**
 * Helper function to build a segment ctor from a scene graph object.
 * Returns null if the object is not a segment or if required data is missing.
 */
export function buildSegmentCtorFromObject(
  obj: ApiObject,
  objects: Array<ApiObject>
): SegmentCtor | null {
  if (isPointSegment(obj)) {
    return {
      type: 'Point',
      position: {
        x: {
          type: 'Number',
          value: obj.kind.segment.position.x.value,
          units: obj.kind.segment.position.x.units,
        },
        y: {
          type: 'Number',
          value: obj.kind.segment.position.y.value,
          units: obj.kind.segment.position.y.units,
        },
      },
    }
  } else if (
    obj?.kind?.type === 'Segment' &&
    obj.kind?.segment?.type === 'Line'
  ) {
    const startPoint = getLinkedPoint({
      objects,
      pointId: obj.kind.segment.start,
    })
    const endPoint = getLinkedPoint({
      objects,
      pointId: obj.kind.segment.end,
    })
    if (!startPoint || !endPoint) {
      console.error('Failed to find linked points for Line segment', obj)
      return null
    }
    return {
      type: 'Line',
      start: startPoint,
      end: endPoint,
    }
  } else if (
    obj?.kind?.type === 'Segment' &&
    obj.kind?.segment?.type === 'Arc'
  ) {
    const centerPoint = getLinkedPoint({
      objects,
      pointId: obj.kind.segment.center,
    })
    const startPoint = getLinkedPoint({
      objects,
      pointId: obj.kind.segment.start,
    })
    const endPoint = getLinkedPoint({
      objects,
      pointId: obj.kind.segment.end,
    })
    if (!centerPoint || !startPoint || !endPoint) {
      console.error('Failed to find linked points for Arc segment', obj)
      return null
    }
    return {
      type: 'Arc',
      center: centerPoint,
      start: startPoint,
      end: endPoint,
      direction: obj.kind.segment.direction,
    }
  } else if (isCircleSegment(obj)) {
    const ctor = obj.kind.segment.ctor
    if (ctor.type !== 'Circle') {
      console.error('Failed to find circle ctor for Circle segment', obj)
      return null
    }
    const centerPoint = getLinkedPoint({
      objects,
      pointId: obj.kind.segment.center,
    })
    const startPoint = getLinkedPoint({
      objects,
      pointId: obj.kind.segment.start,
    })
    if (!centerPoint || !startPoint) {
      console.error('Failed to find linked points for Circle segment', obj)
      return null
    }
    return {
      type: 'Circle',
      center: centerPoint,
      start: startPoint,
    }
  } else if (isControlPointSplineSegment(obj)) {
    const points = obj.kind.segment.controls
      .map((pointId) => getLinkedPoint({ objects, pointId }))
      .filter((point) => point !== null)
    if (points.length !== obj.kind.segment.controls.length) {
      console.error(
        'Failed to find linked points for ControlPointSpline segment',
        obj
      )
      return null
    }
    return {
      type: 'ControlPointSpline',
      points,
      construction: obj.kind.segment.construction,
    }
  }
  return null
}

/**
 * Helper function to update a segment group with the given input and selection state.
 * Determines the correct segment update method based on the input type.
 */
export function updateSegmentGroup({
  apiObject,
  group,
  state,
  scale,
  theme,
  hasSolveErrors,
  objects,
}: {
  apiObject: ApiObject
  group: Group
  state: SegmentRenderState
  scale: number
  theme: Themes
  hasSolveErrors: boolean
  objects: ApiObject[]
}): void {
  const input = buildSegmentCtorFromObject(apiObject, objects)
  if (!input) {
    return
  }

  const freedomResult = deriveSegmentFreedom(apiObject, objects)

  if (input.type === 'Point') {
    segmentUtilsMap.PointSegment.update({
      apiObject,
      input,
      theme,
      scale,
      group,
      state,
      hasSolveErrors,
      freedom: freedomResult,
    })
  } else if (input.type === 'Line') {
    segmentUtilsMap.LineSegment.update({
      apiObject,
      input,
      theme,
      scale,
      group,
      state,
      hasSolveErrors,
      freedom: freedomResult,
    })
  } else if (input.type === 'Arc') {
    segmentUtilsMap.ArcSegment.update({
      apiObject,
      input,
      theme,
      scale,
      group,
      state,
      hasSolveErrors,
      freedom: freedomResult,
    })
  } else if (input.type === 'Circle') {
    segmentUtilsMap.CircleSegment.update({
      apiObject,
      input,
      theme,
      scale,
      group,
      state,
      hasSolveErrors,
      freedom: freedomResult,
    })
  } else if (input.type === 'ControlPointSpline') {
    segmentUtilsMap.ControlPointSplineSegment.update({
      apiObject,
      input,
      theme,
      scale,
      group,
      state,
      hasSolveErrors,
      freedom: freedomResult,
    })
  }
}

/**
 * Helper function to initialize a segment group with the given input.
 * Determines the correct segment init method based on the input type.
 */
function initSegmentGroup({
  apiObject,
  objects,
}: {
  apiObject: ApiObject
  objects: ApiObject[]
}): Group | Error {
  const input = buildSegmentCtorFromObject(apiObject, objects)
  if (!input) {
    return new Error(`Unknown input type: ${(apiObject.kind as any).type}`)
  }

  const id = apiObject.id
  const isConstruction = isConstructionSegment(apiObject)

  let group
  if (input.type === 'Point') {
    group = segmentUtilsMap.PointSegment.init({
      apiObject,
      input,
      id,
      isConstruction,
    })
  } else if (input.type === 'Line') {
    group = segmentUtilsMap.LineSegment.init({
      apiObject,
      input,
      id,
      isConstruction,
    })
  } else if (input.type === 'Arc') {
    group = segmentUtilsMap.ArcSegment.init({
      apiObject,
      input,
      id,
      isConstruction,
    })
  } else if (input.type === 'Circle') {
    group = segmentUtilsMap.CircleSegment.init({
      apiObject,
      input,
      id,
      isConstruction,
    })
  } else if (input.type === 'ControlPointSpline') {
    group = segmentUtilsMap.ControlPointSplineSegment.init({
      apiObject,
      input,
      id,
      isConstruction,
    })
  }
  if (group instanceof Group) {
    return group
  }
  return new Error(`Unknown input type: ${(input as any).type}`)
}

export interface IUpdateSketchSceneGraph {
  sceneGraphDelta: SceneGraphDelta
  context: SketchSceneContext
  selectedIds: Array<SketchSolveSelectionId>
  duringAreaSelectIds: Array<number>
}
export const updateSketchSceneGraphEffect =
  StateEffect.define<IUpdateSketchSceneGraph>()

/**
 * Updates the Three.js scene graph based on a SceneGraphDelta.
 * This handles creating, updating, and invalidating segment groups.
 */
export function updateSceneGraphFromDelta({
  sceneGraphDelta,
  context,
  selectedIds,
  duringAreaSelectIds,
}: IUpdateSketchSceneGraph): void {
  const objects = sceneGraphDelta.new_graph.objects
  const hasSolveErrors =
    getSketchSolveBlockingIssues(sceneGraphDelta).length > 0
  const currentSketchObjects = getCurrentSketchObjectsById(
    objects,
    context.sketchId
  )
  const factor = getSketchSolveScaleFactor(context)

  const sketchSolveGroup =
    context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)

  const hoveredSegmentIds = getHoveredSegmentIds(context.hoveredId, objects)
  const hoveredObjectId = isObjectSelectionId(context.hoveredId)
    ? context.hoveredId
    : null
  const draftEntityIds = context.draftEntities?.segmentIds

  // If invalidates_ids is true, we need to delete everything and start fresh
  // because the old IDs can't be trusted
  if (sceneGraphDelta.invalidates_ids && sketchSolveGroup instanceof Group) {
    resetSketchSolvePointHandleCount()
    disposeGroupChildren(sketchSolveGroup)
  } else {
    // This invalidation logic is kinda based on some heuristics and is not exhaustive,
    // so there are bugs, it's here to let some direct editing of the code from
    // hackSetProgram in `src/lang/lsp/kcl/index.ts`.
    // The proper way to do this is to get an invalidation signal from the rust side.
    const invalidateScene = sketchSolveGroup?.children.some((child) => {
      const childId = Number(child.name)
      // check if number
      if (Number.isNaN(childId)) {
        return
      }
      // check id is not greater than new_graph.objects length
      return childId >= sceneGraphDelta.new_graph.objects.length
    })
    if (invalidateScene && sketchSolveGroup instanceof Group) {
      resetSketchSolvePointHandleCount()
      disposeGroupChildren(sketchSolveGroup)
    }
  }

  if (sketchSolveGroup instanceof Group) {
    updateOriginSprite(
      sketchSolveGroup,
      factor,
      context.sceneInfra.theme,
      getOriginSpriteState(context)
    )
  }

  currentSketchObjects.forEach((obj) => {
    // sketch is not a drawable object
    if (obj.kind.type === 'Sketch') {
      return
    }

    // Combine selectedIds and duringAreaSelectIds for highlighting
    const allSelectedIds = Array.from(
      new Set([...getObjectSelectionIds(selectedIds), ...duringAreaSelectIds])
    )

    // Render constraints
    if (isConstraint(obj)) {
      const foundObject = context.sceneInfra.scene.getObjectByName(
        String(obj.id)
      )
      let constraintGroup: Group | null =
        foundObject instanceof Group ? foundObject : null
      if (!constraintGroup) {
        constraintGroup = segmentUtilsMap.Constraint.init(obj)
        if (constraintGroup) {
          if (sketchSolveGroup) {
            constraintGroup.traverse((child) => child.layers.set(SKETCH_LAYER))
            constraintGroup.layers.set(SKETCH_LAYER)
            sketchSolveGroup.add(constraintGroup)
          }
        }
      }
      if (constraintGroup) {
        segmentUtilsMap.Constraint.update(
          constraintGroup,
          obj,
          objects,
          factor,
          context.sceneInfra,
          allSelectedIds,
          hoveredObjectId,
          getInvisibleConstraintDisplayState(context)
        )
      }
      return
    }
    let group = context.sceneInfra.scene.getObjectByName(String(obj.id))
    const ctor = buildSegmentCtorFromObject(obj, objects)
    const state = getSegmentRenderState(
      obj.id,
      selectedIds,
      duringAreaSelectIds,
      context.hoveredId,
      hoveredSegmentIds,
      draftEntityIds,
      objects
    )
    if (!(group instanceof Group)) {
      if (!ctor) {
        return
      }
      const newGroup = initSegmentGroup({
        apiObject: obj,
        objects,
      })
      if (newGroup instanceof Error) {
        console.error('Failed to init segment group for object', obj.id)
        return
      }
      if (sketchSolveGroup) {
        newGroup.traverse((child) => {
          child.layers.set(SKETCH_LAYER)
        })
        newGroup.layers.set(SKETCH_LAYER)
        sketchSolveGroup.add(newGroup)
      }
      group = newGroup
    }
    if (!(group instanceof Group) || !ctor) {
      return
    }

    updateSegmentGroup({
      apiObject: obj,
      group,
      state,
      scale: factor,
      theme: context.sceneInfra.theme,
      hasSolveErrors,
      objects,
    })
  })
}

function getLinkedPoint({
  pointId,
  objects,
}: {
  pointId: number
  objects: Array<ApiObject>
}): { x: Expr; y: Expr } | null {
  const point = objects[pointId]
  if (!isPointSegment(point)) {
    return null
  }
  return {
    x: {
      type: 'Var',
      value: point.kind.segment.position.x.value,
      units: point.kind.segment.position.x.units,
    },
    y: {
      type: 'Var',
      value: point.kind.segment.position.y.value,
      units: point.kind.segment.position.y.units,
    },
  }
}

export function getInvisibleConstraintDisplayState(
  context: SketchSceneContext
): InvisibleConstraintDisplayState {
  return {
    showNonVisualConstraints: context.showNonVisualConstraints,
    constraintHoverPopups: context.constraintHoverPopups,
  }
}

export function getHoveredSegmentIds(
  hoveredId: SketchSolveSelectionId | null,
  objects: ApiObject[]
): number[] {
  const hoveredObject = isObjectSelectionId(hoveredId)
    ? objects[hoveredId]
    : null
  return isInvisibleConstraintObject(hoveredObject)
    ? findSegmentsForInvisibleConstraint(hoveredObject, objects)
    : []
}

export function getSegmentRenderState(
  segmentId: number,
  selectedIds: Array<SketchSolveSelectionId>,
  duringAreaSelectIds: Array<number>,
  hoveredId: SketchSolveSelectionId | null,
  hoveredSegmentIds: Array<number>,
  draftEntityIds: Array<number> | undefined,
  objects: ApiObject[]
): SegmentRenderState {
  const hoveredObject = isObjectSelectionId(hoveredId)
    ? objects[hoveredId]
    : null
  const hoveredInvisibleConstraint = isInvisibleConstraintObject(hoveredObject)
    ? hoveredObject
    : null

  return {
    selected:
      selectedIds.includes(segmentId) ||
      duringAreaSelectIds.includes(segmentId),
    hovered: hoveredId === segmentId || hoveredSegmentIds.includes(segmentId),
    secondaryHovered: isInvisibleConstraintSegmentSecondaryHovered(
      segmentId,
      hoveredInvisibleConstraint
    ),
    hoverColor: getInvisibleConstraintSegmentHoverColor(
      segmentId,
      hoveredInvisibleConstraint
    ),
    draft: draftEntityIds?.includes(segmentId) ?? false,
    construction: isConstructionSegment(objects[segmentId]),
  }
}

export function getOriginSpriteState(
  context: Pick<SketchSceneContext, 'hoveredId' | 'selectedIds'>
) {
  if (context.hoveredId === ORIGIN_TARGET) {
    return 'hovered' as const
  }
  if (context.selectedIds.includes(ORIGIN_TARGET)) {
    return 'selected' as const
  }
  return 'default' as const
}

export function getSketchSolveScaleFactor(context: SketchSceneContext): number {
  return context.sceneInfra.getClientSceneScaleFactor(
    context.sceneEntitiesManager.sketchSolveGroup
  )
}
