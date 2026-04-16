import type {
  ApiObject,
  Expr,
  Freedom,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type RustContext from '@src/lib/rustContext'
import type { Themes } from '@src/lib/theme'
import type {
  DefaultPlane,
  ExtrudeFacePlane,
  OffsetPlane,
  Selections,
} from '@src/machines/modelingSharedTypes'
import {
  resetSketchSolvePointHandleCount,
  type SegmentRenderState,
  segmentUtilsMap,
} from '@src/machines/sketchSolve/segments'
import {
  getObjectSelectionIds,
  isObjectSelectionId,
  ORIGIN_TARGET,
  type SketchSolveSelectionId,
} from '@src/machines/sketchSolve/sketchSolveSelection'
import { Group } from 'three'

import { StateEffect, Transaction } from '@codemirror/state'
import { disposeGroupChildren } from '@src/clientSideScene/sceneHelpers'
import {
  SKETCH_LAYER,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import { compilationIssuesToDiagnostics } from '@src/lang/errors'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { deferredCallback } from '@src/lib/utils'
import type { InvisibleConstraintDisplayState } from '@src/machines/sketchSolve/constraints/InvisibleConstraintSpriteBuilder'
import {
  CONSTRAINT_TYPE,
  isCircleSegment,
  isConstraint,
  isConstruction as isConstructionSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  type ConstraintHoverPopup,
  findSegmentsForInvisibleConstraint,
  isInvisibleConstraintObject,
} from '@src/machines/sketchSolve/constraints/invisibleConstraintSpriteUtils'
import { updateOriginSprite } from '@src/machines/sketchSolve/originSprite'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import { deriveSegmentFreedom } from '@src/machines/sketchSolve/segmentsUtils'
import {
  getSketchSolveExecOutcomeIssues,
  toastSketchSolveError,
  toastSketchSolveExecOutcomeErrors,
} from '@src/machines/sketchSolve/sketchSolveErrors'
import { machine as centerArcTool } from '@src/machines/sketchSolve/tools/centerArcToolDiagram'
import { machine as circleTool } from '@src/machines/sketchSolve/tools/circleToolDiagram'
import { machine as coincidentConstraintTool } from '@src/machines/sketchSolve/tools/coincidentConstraintTool'
import { machine as dimensionTool } from '@src/machines/sketchSolve/tools/dimensionTool'
import { machine as equalLengthConstraintTool } from '@src/machines/sketchSolve/tools/equalLengthConstraintTool'
import { machine as fixedConstraintTool } from '@src/machines/sketchSolve/tools/fixedConstraintTool'
import { machine as horizontalConstraintTool } from '@src/machines/sketchSolve/tools/horizontalConstraintTool'
import { machine as lineTool } from '@src/machines/sketchSolve/tools/lineToolDiagram'
import { machine as parallelConstraintTool } from '@src/machines/sketchSolve/tools/parallelConstraintTool'
import { machine as perpendicularConstraintTool } from '@src/machines/sketchSolve/tools/perpendicularConstraintTool'
import { machine as pointTool } from '@src/machines/sketchSolve/tools/pointTool'
import { machine as rectTool } from '@src/machines/sketchSolve/tools/rectTool'
import { machine as tangentConstraintTool } from '@src/machines/sketchSolve/tools/tangentConstraintTool'
import { machine as tangentialArcTool } from '@src/machines/sketchSolve/tools/tangentialArcToolDiagram'
import { machine as threePointArcTool } from '@src/machines/sketchSolve/tools/threePointArcToolDiagram'
import { machine as trimTool } from '@src/machines/sketchSolve/tools/trimToolDiagram'
import { machine as verticalConstraintTool } from '@src/machines/sketchSolve/tools/verticalConstraintTool'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import {
  type ActionArgs,
  type ActorRefFrom,
  type AnyActorRef,
  type AssignArgs,
  type ProvidedActor,
  assertEvent,
  fromPromise,
} from 'xstate'

export {
  getObjectSelectionIds,
  isObjectSelectionId,
  ORIGIN_TARGET,
  type SketchSolveSelectionId,
  type SketchSpecialTarget,
} from '@src/machines/sketchSolve/sketchSolveSelection'

export type EquipTool = keyof typeof equipTools

// Type for the spawn function used in XState setup actions
// This provides better type safety by constraining the actor parameter to valid tool names
// and ensuring the return type matches the specific tool actor
export type SpawnToolActor = <K extends EquipTool>(
  src: K,
  options?: {
    id?: string
    input?: ToolInput
  }
) => ActorRefFrom<(typeof equipTools)[K]>

export type SketchSolveMachineEvent =
  | { type: 'exit' }
  | { type: 'escape' }
  | { type: 'unequip tool' }
  | { type: 'equip tool'; data: { tool: EquipTool } }
  | {
      type:
        | 'Dimension'
        | 'HorizontalDistance'
        | 'VerticalDistance'
        | 'construction'
    }
  | { type: 'toggle non-visual constraints' }
  | {
      type: 'update selected ids'
      data: {
        selectedIds?: Array<SketchSolveSelectionId>
        duringAreaSelectIds?: Array<number>
        replaceExistingSelection?: boolean
      }
    }
  | {
      type: 'update hovered id'
      data: {
        hoveredId: SketchSolveSelectionId | null
        constraintHoverPopups?: ConstraintHoverPopup[]
      }
    }
  | { type: typeof CHILD_TOOL_DONE_EVENT }
  | UpdateSketchOutcomeEvent
  | { type: 'delete selected' }
  | {
      type: 'set draft entities'
      data: {
        segmentIds: Array<number>
        constraintIds: Array<number>
      }
    }
  | { type: 'clear draft entities' }
  | { type: 'delete draft entities' }
  | {
      type: 'start editing constraint'
      data: { constraintId: number }
    }
  | { type: 'stop editing constraint' }

export type UpdateSketchOutcomeEvent = {
  type: 'update sketch outcome'
  data: {
    sourceDelta: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    /**
     * If true, transient preview states still update exec-outcome issues so the
     * sketch can render warning/error styling, but repeated toast errors are
     * suppressed until the interaction commits.
     */
    suppressExecOutcomeIssues?: boolean
    /**
     * If true, debounce editor updates to allow cancellation (e.g., for double-click handling)
     */
    debounceEditorUpdate?: boolean
    /**
     * Defaults to true. Set to false to skip persisting to disk, which is useful
     * for high-frequency preview/drag updates.
     */
    writeToDisk?: boolean
    /**
     * Defaults to the same value as `writeToDisk`.
     */
    addToHistory?: boolean
    checkpointId?: number | null
  }
}

type ToolActorRef =
  | ActorRefFrom<typeof dimensionTool>
  | ActorRefFrom<typeof rectTool>
  | ActorRefFrom<typeof pointTool>
  | ActorRefFrom<typeof lineTool>
  | ActorRefFrom<typeof trimTool>
  | ActorRefFrom<typeof centerArcTool>
  | ActorRefFrom<typeof circleTool>
  | ActorRefFrom<typeof tangentialArcTool>
  | ActorRefFrom<typeof threePointArcTool>
  | ActorRefFrom<typeof coincidentConstraintTool>

export const equipTools = Object.freeze({
  trimTool,
  // both use the same tool, opened with a different flag
  angledRectTool: rectTool,
  centerRectTool: rectTool,
  cornerRectTool: rectTool,
  dimensionTool,
  pointTool,
  lineTool,
  centerArcTool,
  circleTool,
  tangentialArcTool,
  threePointArcTool,
  coincidentConstraintTool,
  tangentConstraintTool,
  parallelConstraintTool,
  equalLengthConstraintTool,
  horizontalConstraintTool,
  verticalConstraintTool,
  perpendicularConstraintTool,
  fixedConstraintTool,
})

export type SketchSolveContext = {
  sketchSolveToolName: EquipTool | null
  childTool?: ToolActorRef
  pendingToolName?: EquipTool
  selectedIds: Array<SketchSolveSelectionId>
  duringAreaSelectIds: Array<number>
  hoveredId: SketchSolveSelectionId | null
  constraintHoverPopups: ConstraintHoverPopup[]
  sketchExecOutcome?: {
    sourceDelta: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }
  draftEntities?: {
    segmentIds: Array<number>
    constraintIds: Array<number>
  }
  editingConstraintId?: number
  showNonVisualConstraints: boolean
  initialPlane?: DefaultPlane | OffsetPlane | ExtrudeFacePlane
  sketchId: number
  // Dependencies passed from parent
  sceneInfra: SceneInfra
  sceneEntitiesManager: SceneEntities
  rustContext: RustContext
  kclManager: KclManager
}

export type SolveActionArgs = ActionArgs<
  SketchSolveContext,
  SketchSolveMachineEvent,
  SketchSolveMachineEvent
>

interface EventLike {
  type: string
  [key: PropertyKey]: unknown
}

type SolveAssignArgs<TActor extends ProvidedActor = any> = AssignArgs<
  SketchSolveContext,
  SketchSolveMachineEvent,
  SketchSolveMachineEvent,
  TActor
>

export const CHILD_TOOL_ID = 'child tool'
export const CHILD_TOOL_DONE_EVENT = `xstate.done.actor.${CHILD_TOOL_ID}`

export function sendToActorIfActive(
  actor: Pick<AnyActorRef, 'getSnapshot' | 'send'> | undefined,
  event: EventLike
): boolean {
  if (!actor || actor.getSnapshot().status !== 'active') {
    return false
  }

  actor.send(event)
  return true
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
    }
  } else if (isCircleSegment(obj)) {
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
  group,
  input,
  state,
  scale,
  theme,
  hasSolveErrors,
  objects,
}: {
  group: Group
  input: SegmentCtor
  state: SegmentRenderState
  scale: number
  theme: Themes
  hasSolveErrors: boolean
  objects: ApiObject[]
}): void {
  const idNum = Number(group.name)
  if (Number.isNaN(idNum)) {
    return
  }

  const segmentObj = objects[idNum]
  const freedomResult: Freedom | null = segmentObj
    ? deriveSegmentFreedom(segmentObj, objects)
    : null

  if (input.type === 'Point') {
    segmentUtilsMap.PointSegment.update({
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
  input,
  id,
  objects,
}: {
  input: SegmentCtor
  id: number
  objects: ApiObject[]
}): Group | Error {
  const segmentObj = objects[id]
  const isConstruction = isConstructionSegment(segmentObj)

  let group
  if (input.type === 'Point') {
    group = segmentUtilsMap.PointSegment.init({
      input,
      id,
      isConstruction,
    })
  } else if (input.type === 'Line') {
    group = segmentUtilsMap.LineSegment.init({
      input,
      id,
      isConstruction,
    })
  } else if (input.type === 'Arc') {
    group = segmentUtilsMap.ArcSegment.init({
      input,
      id,
      isConstruction,
    })
  } else if (input.type === 'Circle') {
    group = segmentUtilsMap.CircleSegment.init({
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
  context: SketchSolveContext
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
    getSketchSolveExecOutcomeIssues(sceneGraphDelta).length > 0
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
    // hackSetProgram in `src/editor/plugins/lsp/kcl/index.ts`.
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
        input: ctor,
        id: obj.id,
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
      group,
      input: ctor,
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

////////////// --Actions-- //////////////////

export function initializeIntersectionPlane({ context }: SolveActionArgs) {
  if (context.initialPlane) {
    context.sceneEntitiesManager.initSketchSolveEntityOrientation(
      context.initialPlane
    )
  }
}

export function clearHoverCallbacks({ self, context }: SolveActionArgs) {
  // Clear hover callbacks to prevent interference with tool operations
  context.sceneInfra.setCallbacks({
    onMouseEnter: () => {},
    onMouseLeave: () => {},
    onAreaSelectStart: () => {},
    onAreaSelect: () => {},
    onAreaSelectEnd: () => {},
    onMouseDownSelection: () => false,
  })

  const sketchSegments =
    context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)

  // Clean up selection box if it exists
  const selectionBoxGroup = sketchSegments?.getObjectByName('selectionBox')
  if (selectionBoxGroup) {
    selectionBoxGroup.traverse((child) => {
      if (
        child instanceof CSS2DObject &&
        child.element instanceof HTMLElement
      ) {
        child.element.remove()
      }
    })
    selectionBoxGroup.removeFromParent()
  }
}

export function cleanupSketchSolveGroup(sceneInfra: SceneInfra) {
  sceneInfra.setOnBeforeRender(null)
  const sketchSegments = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  if (!sketchSegments || !(sketchSegments instanceof Group)) {
    // no segments to clean
    return
  }
  resetSketchSolvePointHandleCount()
  disposeGroupChildren(sketchSegments)
}

export function updateSelectedIds({ event, context }: SolveAssignArgs) {
  assertEvent(event, 'update selected ids')

  const updates: Partial<SketchSolveContext> = {}

  // Handle duringAreaSelectIds update (for area select during drag)
  if (event.data.duringAreaSelectIds !== undefined) {
    updates.duringAreaSelectIds = event.data.duringAreaSelectIds
  }

  // Handle regular selectedIds update (for click selection, etc.)
  if (event.data.selectedIds !== undefined) {
    // If empty array is provided, clear the selection
    if (event.data.selectedIds.length === 0) {
      updates.selectedIds = []
    } else if (event.data.replaceExistingSelection) {
      updates.selectedIds = event.data.selectedIds
    } else {
      const first = event.data.selectedIds[0]
      if (
        event.data.selectedIds.length === 1 &&
        first !== undefined &&
        context.selectedIds.includes(first)
      ) {
        // If only one ID is selected and it's already in the selection, remove only it from the selection
        updates.selectedIds = context.selectedIds.filter((id) => id !== first)
      } else {
        // Merge new IDs with existing selection
        const result = Array.from(
          new Set([...context.selectedIds, ...event.data.selectedIds])
        )
        updates.selectedIds = result
      }
    }
  }

  return updates
}

export function refreshSelectionStyling({ context }: SolveActionArgs) {
  // Update selection styling for all existing sketch-solve segments
  if (!context.sketchExecOutcome?.sceneGraphDelta) {
    return
  }
  const sceneGraphDelta = context.sketchExecOutcome.sceneGraphDelta
  const objects = sceneGraphDelta.new_graph.objects
  const hasSolveErrors =
    getSketchSolveExecOutcomeIssues(sceneGraphDelta).length > 0
  const currentSketchObjects = getCurrentSketchObjectsById(
    objects,
    context.sketchId
  )
  const factor = getSketchSolveScaleFactor(context)
  const hoveredSegmentIds = getHoveredSegmentIds(context.hoveredId, objects)
  const hoveredObjectId = isObjectSelectionId(context.hoveredId)
    ? context.hoveredId
    : null

  // Combine selectedIds and duringAreaSelectIds for highlighting
  const allSelectedIds = Array.from(
    new Set([
      ...getObjectSelectionIds(context.selectedIds),
      ...context.duringAreaSelectIds,
    ])
  )

  // Get draft entity IDs from context
  const draftEntityIds = context.draftEntities?.segmentIds

  const sketchSolveGroup =
    context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  if (sketchSolveGroup instanceof Group) {
    updateOriginSprite(
      sketchSolveGroup,
      factor,
      context.sceneInfra.theme,
      getOriginSpriteState(context)
    )
  }

  currentSketchObjects.forEach((obj) => {
    if (obj.kind.type === 'Sketch') {
      return
    }
    if (obj.kind.type === 'Constraint') {
      const foundObject = context.sceneInfra.scene.getObjectByName(
        String(obj.id)
      )
      let constraintGroup: Group | null =
        foundObject instanceof Group ? foundObject : null
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
    } else {
      const group = context.sceneInfra.scene.getObjectByName(String(obj.id))
      if (!(group instanceof Group)) {
        return
      }
      const ctor = buildSegmentCtorFromObject(obj, objects)
      if (!ctor) {
        return
      }
      updateSegmentGroup({
        group,
        input: ctor,
        state: getSegmentRenderState(
          obj.id,
          context.selectedIds,
          context.duringAreaSelectIds,
          context.hoveredId,
          hoveredSegmentIds,
          draftEntityIds,
          objects
        ),
        scale: factor,
        theme: context.sceneInfra.theme,
        hasSolveErrors,
        objects,
      })
    }
  })
}

export function initializeInitialSceneGraph({
  context,
}: SolveAssignArgs): Partial<SketchSolveContext> {
  if (context?.sketchExecOutcome?.sceneGraphDelta) {
    // Update the scene graph directly without sending an event
    // This is for initial setup, just rendering existing state
    const sceneGraphDelta = context.sketchExecOutcome.sceneGraphDelta
    updateSceneGraphFromDelta({
      sceneGraphDelta,
      context,
      selectedIds: context.selectedIds,
      duringAreaSelectIds: context.duringAreaSelectIds,
    })

    // Set sketchExecOutcome in context so drag callbacks can access it
    // Use current code from editorManager since editSketch doesn't return kclSource
    const kclSource: SourceDelta = {
      text: context.kclManager.code,
    }

    return {
      sketchExecOutcome: {
        sourceDelta: kclSource,
        sceneGraphDelta,
      },
    }
  }
  return {}
}

export function refreshSketchSolveScale(context: SketchSolveContext): void {
  const sketchSolveGroup =
    context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  if (
    !(sketchSolveGroup instanceof Group) ||
    !context.sketchExecOutcome?.sceneGraphDelta
  ) {
    return
  }

  const objects = context.sketchExecOutcome.sceneGraphDelta.new_graph.objects
  const hasSolveErrors =
    getSketchSolveExecOutcomeIssues(context.sketchExecOutcome.sceneGraphDelta)
      .length > 0
  const currentSketchObjects = getCurrentSketchObjectsById(
    objects,
    context.sketchId
  )
  const scaleFactor = getSketchSolveScaleFactor(context)
  const hoveredSegmentIds = getHoveredSegmentIds(context.hoveredId, objects)
  const hoveredObjectId = isObjectSelectionId(context.hoveredId)
    ? context.hoveredId
    : null

  const allSelectedIds = Array.from(
    new Set([
      ...getObjectSelectionIds(context.selectedIds),
      ...context.duringAreaSelectIds,
    ])
  )
  const draftEntityIds = context.draftEntities?.segmentIds

  updateOriginSprite(
    sketchSolveGroup,
    scaleFactor,
    context.sceneInfra.theme,
    getOriginSpriteState(context)
  )

  currentSketchObjects.forEach((obj) => {
    if (!isPointSegment(obj)) {
      return
    }

    const group = sketchSolveGroup.getObjectByName(String(obj.id))
    if (!(group instanceof Group)) {
      return
    }

    const ctor = buildSegmentCtorFromObject(obj, objects)
    if (!ctor) {
      return
    }

    updateSegmentGroup({
      group,
      input: ctor,
      state: getSegmentRenderState(
        obj.id,
        context.selectedIds,
        context.duringAreaSelectIds,
        context.hoveredId,
        hoveredSegmentIds,
        draftEntityIds,
        objects
      ),
      scale: scaleFactor,
      theme: context.sceneInfra.theme,
      hasSolveErrors,
      objects,
    })
  })

  const constraintGroups = sketchSolveGroup.children.filter(
    (child) => child.userData.type === CONSTRAINT_TYPE && child instanceof Group
  )
  constraintGroups.forEach((group) => {
    const objId = group.userData.object_id
    const obj = objects[objId]
    if (obj) {
      segmentUtilsMap.Constraint.update(
        group as Group,
        obj,
        objects,
        scaleFactor,
        context.sceneInfra,
        allSelectedIds,
        hoveredObjectId,
        getInvisibleConstraintDisplayState(context)
      )
    }
  })
}

function getInvisibleConstraintDisplayState(
  context: SketchSolveContext
): InvisibleConstraintDisplayState {
  return {
    showNonVisualConstraints: context.showNonVisualConstraints,
    constraintHoverPopups: context.constraintHoverPopups,
  }
}

function getHoveredSegmentIds(
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

function getSegmentRenderState(
  segmentId: number,
  selectedIds: Array<SketchSolveSelectionId>,
  duringAreaSelectIds: Array<number>,
  hoveredId: SketchSolveSelectionId | null,
  hoveredSegmentIds: Array<number>,
  draftEntityIds: Array<number> | undefined,
  objects: ApiObject[]
): SegmentRenderState {
  return {
    selected:
      selectedIds.includes(segmentId) ||
      duringAreaSelectIds.includes(segmentId),
    hovered: hoveredId === segmentId || hoveredSegmentIds.includes(segmentId),
    draft: draftEntityIds?.includes(segmentId) ?? false,
    construction: isConstructionSegment(objects[segmentId]),
  }
}

function getOriginSpriteState(
  context: Pick<SketchSolveContext, 'hoveredId' | 'selectedIds'>
) {
  if (context.hoveredId === ORIGIN_TARGET) {
    return 'hovered' as const
  }
  if (context.selectedIds.includes(ORIGIN_TARGET)) {
    return 'selected' as const
  }
  return 'default' as const
}

function getSketchSolveScaleFactor(context: SketchSolveContext): number {
  return context.sceneInfra.getClientSceneScaleFactor(
    context.sceneEntitiesManager.sketchSolveGroup
  )
}

// Debounced editor update function - persists across calls
// This allows us to cancel editor updates if a double-click is detected
// The debounce delay is short (100ms) to minimize perceived lag while still allowing cancellation
// We store the latest kclManager reference so the debounced function can access it
const debouncedEditorUpdate = deferredCallback(
  ({
    text,
    kclManager,
    sceneGraphDelta,
    shouldWriteToDisk,
    shouldAddToHistory,
    spec,
  }: {
    text: string
    kclManager: KclManager
    sceneGraphDelta: SceneGraphDelta
    shouldWriteToDisk: boolean
    shouldAddToHistory: boolean
    spec: { effects: StateEffect<unknown>[] }
  }) => {
    kclManager.updateCodeEditor(
      text,
      {
        shouldWriteToDisk,
        shouldAddToHistory,
        shouldExecute: false,
      },
      spec
    )
    kclManager.syncSketchSolveOutcome(text, sceneGraphDelta)
  },
  200
)

export function updateSketchOutcome({ event, context }: SolveAssignArgs) {
  assertEvent(event, 'update sketch outcome')

  if (!event.data.sourceDelta) {
    console.error(
      'updateSketchOutcome: ERROR - No sourceDelta provided',
      event.data
    )
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error('updateSketchOutcome: event.data must contain sourceDelta')
  }

  const sceneGraphDelta = event.data.sceneGraphDelta

  const sketchSolveDiagnostics = compilationIssuesToDiagnostics(
    getSketchSolveExecOutcomeIssues(sceneGraphDelta),
    event.data.sourceDelta.text
  )
  context.kclManager.setSketchSolveDiagnostics(sketchSolveDiagnostics)
  if (!event.data.suppressExecOutcomeIssues) {
    toastSketchSolveExecOutcomeErrors(
      sceneGraphDelta,
      'Sketch solver failed to find a solution'
    )
  }

  // If the incoming KCL differs from the current editor doc, apply the scene
  // immediately for responsiveness, but keep that scene-only dispatch out of
  // history. Checkpoint-backed undo is the only restore mechanism for
  // committed sketch edits.
  const additionalSpec = {
    sketchCheckpointId: event.data.checkpointId,
    effects: [
      updateSketchSceneGraphEffect.of({
        sceneGraphDelta,
        context,
        selectedIds: context.selectedIds,
        duringAreaSelectIds: context.duringAreaSelectIds,
      }),
    ],
  }

  const shouldWriteToDisk = event.data.writeToDisk !== false
  const shouldAddToHistory = event.data.addToHistory ?? shouldWriteToDisk
  const shouldDispatchSceneImmediately =
    context.kclManager.code !== event.data.sourceDelta.text

  if (shouldDispatchSceneImmediately) {
    context.kclManager.dispatch({
      annotations: Transaction.addToHistory.of(false),
      effects: additionalSpec.effects,
    })
  }

  // Strip scene effects from the follow-up editor update when we already
  // dispatched them above. This avoids double-applying the same scene delta
  // and creating extra scene-only history entries.
  const editorAdditionalSpec = shouldDispatchSceneImmediately
    ? {
        ...additionalSpec,
        effects: [] as StateEffect<unknown>[],
      }
    : additionalSpec

  // Update editor - debounce only if explicitly requested (e.g., for single-click that might be double-click)
  // This allows frequent updates (dragging handles) to be immediate, while others can be debounce
  // a good example of this is When a user double clicks with the line tool, we want to end the chaining and so
  // - First click still adds the new segment and coincident constraint
  // - Followed closely by the second click making it a double click, in which case we want to delete the recently added segments, but don't want flicker in the editor
  if (event.data.debounceEditorUpdate) {
    // Debounce editor update - this can be cancelled if a double-click is detected
    // by calling the debounced function again with new text before the delay expires
    // If a new update comes in within 200ms, the previous one is cancelled
    debouncedEditorUpdate({
      text: event.data.sourceDelta.text,
      kclManager: context.kclManager,
      sceneGraphDelta,
      shouldWriteToDisk,
      shouldAddToHistory,
      spec: editorAdditionalSpec,
    })
  } else {
    // Update editor immediately - no debounce for frequent updates like onMove
    context.kclManager.updateCodeEditor(
      event.data.sourceDelta.text,
      {
        shouldExecute: false,
        shouldWriteToDisk,
        shouldAddToHistory,
      },
      editorAdditionalSpec
    )
    context.kclManager.syncSketchSolveOutcome(
      event.data.sourceDelta.text,
      sceneGraphDelta
    )
  }

  return {
    sketchExecOutcome: {
      sourceDelta: event.data.sourceDelta,
      sceneGraphDelta,
    },
  }
}

export function setDraftEntities({ event }: SolveAssignArgs) {
  assertEvent(event, 'set draft entities')
  return {
    draftEntities: {
      segmentIds: event.data.segmentIds,
      constraintIds: event.data.constraintIds,
    },
  }
}

export function clearDraftEntities(): Partial<SketchSolveContext> {
  return {
    draftEntities: undefined,
  }
}

export async function deleteDraftEntities({
  context,
  self,
}: SolveActionArgs): Promise<void> {
  if (!context.draftEntities) {
    // No draft entities to delete, the always guard will handle the transition
    return
  }

  const { segmentIds, constraintIds } = context.draftEntities

  try {
    const result = await context.rustContext.deleteObjects(
      SKETCH_FILE_VERSION,
      context.sketchId,
      constraintIds,
      segmentIds,
      jsAppSettings(context.rustContext.settingsActor)
    )

    if (result) {
      // Clear draft entities after successful deletion
      sendToActorIfActive(self, {
        type: 'update sketch outcome',
        data: {
          sourceDelta: result.kclSource,
          sceneGraphDelta: result.sceneGraphDelta,
          writeToDisk: false,
        },
      })
    }
    // Always clear draft entities, even if deletion failed or returned no result
    // This allows the exit flow to continue
    sendToActorIfActive(self, { type: 'clear draft entities' })
  } catch (error) {
    console.error('Failed to delete draft entities:', error)
    toastSketchSolveError(error)
    // Clear draft entities even on error to allow exit to continue
    sendToActorIfActive(self, { type: 'clear draft entities' })
  }
}

/**
 * Promise-based function for deleting draft entities during exit.
 * Returns the result of deletion (if any) so it can be handled in onDone.
 */
export async function deleteDraftEntitiesPromise({
  context,
}: {
  context: SketchSolveContext
}): Promise<{
  kclSource?: SourceDelta
  sceneGraphDelta?: SceneGraphDelta
} | null> {
  //
  if (!context.draftEntities) {
    // No draft entities to delete
    return null
  }

  const { segmentIds, constraintIds } = context.draftEntities
  //

  try {
    const result = await context.rustContext.deleteObjects(
      SKETCH_FILE_VERSION,
      context.sketchId,
      constraintIds,
      segmentIds,
      jsAppSettings(context.rustContext.settingsActor)
    )

    //
    return result || null
  } catch (error) {
    console.error('Failed to delete draft entities:', error)
    toastSketchSolveError(error)
    // Return null on error - we'll still clear draft entities in onDone
    return null
  }
}

export function isSketchBlockSelected(selectionRanges: Selections): boolean {
  const artifact = selectionRanges.graphSelections[0]?.artifact
  return (
    artifact?.type === 'sketchBlock' && typeof artifact.sketchId === 'number'
  )
}

export function spawnTool(
  { event, context }: SolveAssignArgs,
  spawn: SpawnToolActor
): Partial<SketchSolveContext> {
  // Determine which tool to spawn based on event type
  let nameOfToolToSpawn: EquipTool

  if (event.type === 'equip tool') {
    nameOfToolToSpawn = event.data.tool
  } else if (event.type === CHILD_TOOL_DONE_EVENT && context.pendingToolName) {
    nameOfToolToSpawn = context.pendingToolName
  } else {
    console.error('Cannot determine tool to spawn')
    return {}
  }
  // this type-annotation informs spawn tool of the association between the EquipTools type and the machines in equipTools
  // It's not an type assertion. TS still checks that _spawn is assignable to SpawnToolActor.
  const childTool = spawn(nameOfToolToSpawn, {
    id: CHILD_TOOL_ID,
    // id: 'child tool',
    input: {
      sceneInfra: context.sceneInfra,
      rustContext: context.rustContext,
      kclManager: context.kclManager,
      sketchId: context.sketchId,
      toolVariant: toolVariants[nameOfToolToSpawn],
    },
  })

  return {
    sketchSolveToolName: nameOfToolToSpawn,
    childTool: childTool,
    pendingToolName: undefined, // Clear the pending tool after spawning
  }
}

export const tearDownSketchSolve = fromPromise(
  async ({
    input,
  }: {
    input: { context: SketchSolveContext }
  }) => {
    // Let the rust side know this sketch is being exited
    await input.context.rustContext.exitSketch(
      SKETCH_FILE_VERSION,
      input.context.sketchId
    )

    // Only delete if draft entities exist
    const deleteDraftEntities = !input.context.draftEntities
      ? Promise.resolve(null)
      : deleteDraftEntitiesPromise(input)

    return await deleteDraftEntities
  }
)

export type ToolInput = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  toolVariant?: string // eg. 'corner' | 'center' | 'angled' for rectTool
}

const toolVariants: Record<string, string> = {
  angledRectTool: 'angled',
  centerRectTool: 'center',
  cornerRectTool: 'corner',
}
