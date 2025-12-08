import type {
  ApiObject,
  Expr,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SegmentUtils } from '@src/machines/sketchSolve/segments'
import {
  segmentUtilsMap,
  updateLineSegmentHover,
} from '@src/machines/sketchSolve/segments'
import type { Themes } from '@src/lib/theme'
import { Group, OrthographicCamera, Mesh } from 'three'
import type {
  DefaultPlane,
  ExtrudeFacePlane,
  OffsetPlane,
  Selections,
  SetSelections,
} from '@src/machines/modelingSharedTypes'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'

import { machine as centerRectTool } from '@src/machines/sketchSolve/tools/centerRectTool'
import { machine as dimensionTool } from '@src/machines/sketchSolve/tools/dimensionTool'
import { machine as pointTool } from '@src/machines/sketchSolve/tools/pointTool'
import { machine as lineTool } from '@src/machines/sketchSolve/tools/lineToolDiagram'
import { orthoScale, perspScale } from '@src/clientSideScene/helpers'
import { deferExecution } from '@src/lib/utils'
import {
  SKETCH_LAYER,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import { disposeGroupChildren } from '@src/clientSideScene/sceneHelpers'
import {
  type ActionArgs,
  type AssignArgs,
  type ActorRefFrom,
  type ProvidedActor,
  assertEvent,
} from 'xstate'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer'
import { STRAIGHT_SEGMENT_BODY } from '@src/clientSideScene/sceneConstants'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'

export type EquipTool = keyof typeof equipTools

// Type for the spawn function used in XState setup actions
// This provides better type safety by constraining the actor parameter to valid tool names
// and ensuring the return type matches the specific tool actor
export type SpawnToolActor = <K extends EquipTool>(
  src: K,
  options?: {
    id?: string
    input?: {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
    }
  }
) => ActorRefFrom<(typeof equipTools)[K]>

export type SketchSolveMachineEvent =
  | { type: 'exit' }
  | { type: 'escape' }
  | { type: 'update selection'; data?: SetSelections }
  | { type: 'unequip tool' }
  | { type: 'equip tool'; data: { tool: EquipTool } }
  | {
      type:
        | 'coincident'
        | 'LinesEqualLength'
        | 'Vertical'
        | 'Horizontal'
        | 'Parallel'
        | 'Distance'
    }
  | {
      type: 'update selected ids'
      data: { selectedIds?: Array<number>; duringAreaSelectIds?: Array<number> }
    }
  | { type: typeof CHILD_TOOL_DONE_EVENT }
  | {
      type: 'update sketch outcome'
      data: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        debounceEditorUpdate?: boolean // If true, debounce editor updates to allow cancellation (e.g., for double-click handling)
        writeToDisk?: boolean // If false, skip persisting to disk (useful for high-frequency drag updates)
      }
    }
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

export type SketchSolveContext = {
  sketchSolveToolName: EquipTool | null
  pendingToolName?: EquipTool
  selectedIds: Array<number>
  duringAreaSelectIds: Array<number>
  sketchExecOutcome?: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }
  draftEntities?: {
    segmentIds: Array<number>
    constraintIds: Array<number>
  }
  initialPlane?: DefaultPlane | OffsetPlane | ExtrudeFacePlane
  sketchId: number
  // Dependencies passed from parent
  sceneInfra: SceneInfra
  sceneEntitiesManager: SceneEntities
  rustContext: RustContext
  kclManager: KclManager
}
export const equipTools = Object.freeze({
  centerRectTool,
  dimensionTool,
  pointTool,
  lineTool,
})

export type SolveActionArgs = ActionArgs<
  SketchSolveContext,
  SketchSolveMachineEvent,
  SketchSolveMachineEvent
>

type SolveAssignArgs<TActor extends ProvidedActor = any> = AssignArgs<
  SketchSolveContext,
  SketchSolveMachineEvent,
  SketchSolveMachineEvent,
  TActor
>

export const CHILD_TOOL_ID = 'child tool'
export const CHILD_TOOL_DONE_EVENT = `xstate.done.actor.${CHILD_TOOL_ID}`

/**
 * Helper function to build a segment ctor from a scene graph object.
 * Returns null if the object is not a segment or if required data is missing.
 */
export function buildSegmentCtorFromObject(
  obj: ApiObject,
  objects: Array<ApiObject>
): SegmentCtor | null {
  if (obj.kind.type === 'Segment' && obj.kind.segment.type === 'Point') {
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
  selectedIds,
  scale,
  theme,
  draftEntityIds,
}: {
  group: Group
  input: SegmentCtor
  selectedIds: Array<number>
  scale: number
  theme: Themes
  draftEntityIds?: Array<number>
}): void {
  const idNum = Number(group.name)
  if (Number.isNaN(idNum)) {
    return
  }

  const isDraft = draftEntityIds?.includes(idNum) ?? false

  if (input.type === 'Point') {
    segmentUtilsMap.PointSegment.update({
      input,
      theme,
      scale,
      id: idNum,
      group,
      selectedIds,
      isDraft,
    })
  } else if (input.type === 'Line') {
    segmentUtilsMap.LineSegment.update({
      input,
      theme,
      scale,
      id: idNum,
      group,
      selectedIds,
      isDraft,
    })
  }
}

/**
 * Helper function to initialize a segment group with the given input.
 * Determines the correct segment init method based on the input type.
 */
function initSegmentGroup({
  input,
  theme,
  scale,
  id,
  isDraft,
}: {
  input: Parameters<SegmentUtils['init']>[0]['input']
  theme: Themes
  scale: number
  id: number
  isDraft?: boolean
}): Group | Error {
  let group
  if (input.type === 'Point') {
    group = segmentUtilsMap.PointSegment.init({
      input,
      theme,
      scale,
      id,
      isDraft,
    })
  } else if (input.type === 'Line') {
    group = segmentUtilsMap.LineSegment.init({
      input,
      theme,
      scale,
      id,
      isDraft,
    })
  }
  if (group instanceof Group) return group
  return new Error(`Unknown input type: ${(input as any).type}`)
}

/**
 * Updates the Three.js scene graph based on a SceneGraphDelta.
 * This handles creating, updating, and invalidating segment groups.
 */
export function updateSceneGraphFromDelta({
  sceneGraphDelta,
  context,
  selectedIds,
  duringAreaSelectIds,
}: {
  sceneGraphDelta: SceneGraphDelta
  context: SketchSolveContext
  selectedIds: Array<number>
  duringAreaSelectIds: Array<number>
}): void {
  const objects = sceneGraphDelta.new_graph.objects
  const orthoFactor = orthoScale(context.sceneInfra.camControls.camera)
  const factor =
    (context.sceneInfra.camControls.camera instanceof OrthographicCamera ||
    !context.sceneEntitiesManager.axisGroup
      ? orthoFactor
      : perspScale(
          context.sceneInfra.camControls.camera,
          context.sceneEntitiesManager.axisGroup
        )) / context.sceneInfra.baseUnitMultiplier
  const sketchSegments = context.sceneInfra.scene.children.find(
    ({ userData }) => userData?.type === SKETCH_SOLVE_GROUP
  )

  // If invalidates_ids is true, we need to delete everything and start fresh
  // because the old IDs can't be trusted
  if (sceneGraphDelta.invalidates_ids && sketchSegments instanceof Group) {
    disposeGroupChildren(sketchSegments)
  } else {
    // This invalidation logic is kinda based on some heuristics and is not exhaustive,
    // so there are bugs, it's here to let some direct editing of the code from
    // hackSetProgram in `src/editor/plugins/lsp/kcl/index.ts`.
    // The proper way to do this is to get an invalidation signal from the rust side.
    const invalidateScene = sketchSegments?.children.some((child) => {
      const childId = Number(child.name)
      // check if number
      if (Number.isNaN(childId)) {
        return
      }
      // check id is not greater than new_graph.objects length
      return childId >= sceneGraphDelta.new_graph.objects.length
    })
    if (invalidateScene && sketchSegments instanceof Group) {
      disposeGroupChildren(sketchSegments)
    }
  }

  // TODO ask Jon if there's a better way to determine what objects are part of the current sketch
  let skipBecauseBeforeCurrentSketch = true
  let skipBecauseAfterCurrentSketch = false
  sceneGraphDelta.new_graph.objects.forEach((obj) => {
    if (obj.kind.type === 'Sketch' && obj.id === context.sketchId) {
      skipBecauseBeforeCurrentSketch = false
    }
    if (obj.kind.type === 'Sketch' && obj.id > context.sketchId) {
      skipBecauseAfterCurrentSketch = true
    }
    if (skipBecauseBeforeCurrentSketch || skipBecauseAfterCurrentSketch) {
      return
    }
    // sketch is no a drawable object, and
    // TODO constraints have not been implemented yet
    if (obj.kind.type === 'Sketch' || obj.kind.type === 'Constraint') {
      return
    }
    const group = context.sceneInfra.scene.getObjectByName(String(obj.id))
    const ctor = buildSegmentCtorFromObject(obj, objects)
    if (!(group instanceof Group)) {
      if (!ctor) {
        return
      }
      // Check if this segment is a draft entity
      const isDraft =
        context.draftEntities?.segmentIds.includes(obj.id) ?? false

      const newGroup = initSegmentGroup({
        input: ctor,
        theme: context.sceneInfra.theme,
        scale: factor,
        id: obj.id,
        isDraft,
      })
      if (newGroup instanceof Error) {
        console.error('Failed to init segment group for object', obj.id)
        return
      }
      const sketchSceneGroup =
        context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
      if (sketchSceneGroup) {
        newGroup.traverse((child) => {
          child.layers.set(SKETCH_LAYER)
        })
        newGroup.layers.set(SKETCH_LAYER)
        sketchSceneGroup.add(newGroup)
      }
      return
    }
    if (!ctor) {
      return
    }

    // Combine selectedIds and duringAreaSelectIds for highlighting
    const allSelectedIds = Array.from(
      new Set([...selectedIds, ...duringAreaSelectIds])
    )

    // Get draft entity IDs from context
    const draftEntityIds = context.draftEntities
      ? [...context.draftEntities.segmentIds]
      : undefined

    updateSegmentGroup({
      group,
      input: ctor,
      selectedIds: allSelectedIds,
      scale: factor,
      theme: context.sceneInfra.theme,
      draftEntityIds,
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
  if (
    point?.kind?.type !== 'Segment' ||
    point?.kind?.segment?.type !== 'Point'
  ) {
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
  })

  // Clear any currently hovered line segment meshes
  const snapshot = self.getSnapshot()
  const selectedIds = snapshot.context.selectedIds
  const draftEntityIds = snapshot.context.draftEntities
    ? [...snapshot.context.draftEntities.segmentIds]
    : undefined
  const sketchSegments =
    context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  if (sketchSegments) {
    sketchSegments.traverse((child) => {
      if (
        child instanceof Mesh &&
        child.userData?.type === STRAIGHT_SEGMENT_BODY &&
        child.userData.isHovered === true
      ) {
        updateLineSegmentHover(child, false, selectedIds, draftEntityIds)
      }
    })
  }

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

export function cleanupSketchSolveGroup({ context }: SolveActionArgs) {
  const sketchSegments =
    context.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  if (!sketchSegments || !(sketchSegments instanceof Group)) {
    // no segments to clean
    return
  }
  // We have to manually remove the CSS2DObjects
  // as they don't get removed when the group is removed
  sketchSegments.traverse((object) => {
    if (object instanceof CSS2DObject) {
      object.element.remove()
      object.remove()
    }
  })
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
    } else {
      const first = event.data.selectedIds[0]
      if (
        event.data.selectedIds.length === 1 &&
        first &&
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
  const orthoFactor = orthoScale(context.sceneInfra.camControls.camera)
  const factor =
    (context.sceneInfra.camControls.camera instanceof OrthographicCamera ||
    !context.sceneEntitiesManager.axisGroup
      ? orthoFactor
      : perspScale(
          context.sceneInfra.camControls.camera,
          context.sceneEntitiesManager.axisGroup
        )) / context.sceneInfra.baseUnitMultiplier

  // Combine selectedIds and duringAreaSelectIds for highlighting
  const allSelectedIds = Array.from(
    new Set([...context.selectedIds, ...context.duringAreaSelectIds])
  )

  // Get draft entity IDs from context
  const draftEntityIds = context.draftEntities
    ? [...context.draftEntities.segmentIds]
    : undefined

  sceneGraphDelta.new_graph.objects.forEach((obj) => {
    if (obj.kind.type === 'Sketch' || obj.kind.type === 'Constraint') {
      return
    }
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
      selectedIds: allSelectedIds,
      scale: factor,
      theme: context.sceneInfra.theme,
      draftEntityIds,
    })
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
        kclSource,
        sceneGraphDelta,
      },
    }
  }
  return {}
}

// Debounced editor update function - persists across calls
// This allows us to cancel editor updates if a double-click is detected
// The debounce delay is short (100ms) to minimize perceived lag while still allowing cancellation
// We store the latest kclManager reference so the debounced function can access it
const debouncedEditorUpdate = deferExecution(
  ({ text, kclManager }: { text: string; kclManager: KclManager }) =>
    kclManager.updateCodeEditor(text),
  200
)

export function updateSketchOutcome({ event, context }: SolveAssignArgs) {
  assertEvent(event, 'update sketch outcome')

  // Update scene immediately - no delay, no flicker
  updateSceneGraphFromDelta({
    sceneGraphDelta: event.data.sceneGraphDelta,
    context,
    selectedIds: context.selectedIds,
    duringAreaSelectIds: context.duringAreaSelectIds,
  })

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
      text: event.data.kclSource.text,
      kclManager: context.kclManager,
    })
  } else {
    // Update editor immediately - no debounce for frequent updates like onMove
    context.kclManager.updateCodeEditor(event.data.kclSource.text)
  }

  // Persist changes to disk unless explicitly disabled
  if (event.data.writeToDisk !== false) {
    void context.kclManager.writeToFile().catch((err) => {
      console.error('Failed to write file', err)
    })
  }

  return {
    sketchExecOutcome: {
      kclSource: event.data.kclSource,
      sceneGraphDelta: event.data.sceneGraphDelta,
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
      0,
      context.sketchId,
      constraintIds,
      segmentIds,
      await jsAppSettings()
    )

    if (result) {
      // Clear draft entities after successful deletion
      self.send({
        type: 'update sketch outcome',
        data: {
          kclSource: result.kclSource,
          sceneGraphDelta: result.sceneGraphDelta,
        },
      })
    }
    // Always clear draft entities, even if deletion failed or returned no result
    // This allows the exit flow to continue
    self.send({ type: 'clear draft entities' })
  } catch (error) {
    console.error('Failed to delete draft entities:', error)
    // Clear draft entities even on error to allow exit to continue
    self.send({ type: 'clear draft entities' })
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
      0,
      context.sketchId,
      constraintIds,
      segmentIds,
      await jsAppSettings()
    )

    //
    return result || null
  } catch (error) {
    console.error('Failed to delete draft entities:', error)
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
  spawn(nameOfToolToSpawn, {
    id: CHILD_TOOL_ID,
    input: {
      sceneInfra: context.sceneInfra,
      rustContext: context.rustContext,
      kclManager: context.kclManager,
      sketchId: context.sketchId,
    },
  })

  return {
    sketchSolveToolName: nameOfToolToSpawn,
    pendingToolName: undefined, // Clear the pending tool after spawning
  }
}
