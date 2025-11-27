import type {
  ApiObject,
  Expr,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { roundOff } from '@src/lib/utils'
import type { SegmentUtils } from '@src/machines/sketchSolve/segments'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import type { Themes } from '@src/lib/theme'
import { Group, OrthographicCamera } from 'three'
import type { Vector2 } from 'three'
import type {
  DefaultPlane,
  ExtrudeFacePlane,
  OffsetPlane,
  SetSelections,
} from '@src/machines/modelingSharedTypes'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'

import { machine as centerRectTool } from '@src/machines/sketchSolve/tools/centerRectTool'
import { machine as dimensionTool } from '@src/machines/sketchSolve/tools/dimensionTool'
import { machine as pointTool } from '@src/machines/sketchSolve/tools/pointTool'
import { machine as lineTool } from '@src/machines/sketchSolve/tools/lineTool'
import { orthoScale, perspScale } from '@src/clientSideScene/helpers'
import {
  SKETCH_LAYER,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import { disposeGroupChildren } from '@src/clientSideScene/sceneHelpers'
import { forceSuffix } from '@src/lang/util'
import type { NumericSuffix } from '@src/lang/wasm'
import type { ActorRefFrom } from 'xstate'

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
      }
    }
  | { type: 'delete selected' }

export type SketchSolveContext = {
  sketchSolveToolName: EquipTool | null
  pendingToolName?: EquipTool
  selectedIds: Array<number>
  duringAreaSelectIds: Array<number>
  sketchExecOutcome?: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }
  initialPlane?: DefaultPlane | OffsetPlane | ExtrudeFacePlane
  initialSceneGraphDelta?: SceneGraphDelta
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

export const CHILD_TOOL_ID = 'child tool'
export const CHILD_TOOL_DONE_EVENT = `xstate.done.actor.${CHILD_TOOL_ID}`

/**
 * Helper function to build a segment ctor from a scene graph object.
 * Returns null if the object is not a segment or if required data is missing.
 */
export function buildSegmentCtorFromObject(
  obj: ApiObject,
  objects: Array<ApiObject>
): Parameters<SegmentUtils['update']>[0]['input'] | null {
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
}: {
  group: Group
  input: Parameters<SegmentUtils['update']>[0]['input']
  selectedIds: Array<number>
  scale: number
  theme: Themes
}): void {
  const idNum = Number(group.name)
  if (Number.isNaN(idNum)) {
    return
  }

  if (input.type === 'Point') {
    void segmentUtilsMap.PointSegment.update({
      input,
      theme,
      scale,
      id: idNum,
      group,
      selectedIds,
    })
  } else if (input.type === 'Line') {
    void segmentUtilsMap.LineSegment.update({
      input,
      theme,
      scale,
      id: idNum,
      group,
      selectedIds,
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
}: {
  input: Parameters<SegmentUtils['init']>[0]['input']
  theme: Themes
  scale: number
  id: number
}): Group | Error {
  let group
  if (input.type === 'Point') {
    group = segmentUtilsMap.PointSegment.init({
      input,
      theme,
      scale,
      id,
    })
  } else if (input.type === 'Line') {
    group = segmentUtilsMap.LineSegment.init({
      input,
      theme,
      scale,
      id,
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
    if (invalidateScene) {
      sketchSegments?.children.forEach((child) => {
        context.sceneInfra.scene.remove(child)
      })
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
    if (obj.kind.type === 'Sketch' || obj.kind.type === 'Constraint') {
      return
    }
    const group = context.sceneInfra.scene.getObjectByName(String(obj.id))
    const ctor = buildSegmentCtorFromObject(obj, objects)
    if (!(group instanceof Group)) {
      if (!ctor) {
        return
      }
      const newGroup = initSegmentGroup({
        input: ctor,
        theme: context.sceneInfra.theme,
        scale: factor,
        id: obj.id,
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

    updateSegmentGroup({
      group,
      input: ctor,
      selectedIds: allSelectedIds,
      scale: factor,
      theme: context.sceneInfra.theme,
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

/**
 * Helper function to extract numeric value from an Expr.
 * Returns the value and units, or null if the Expr doesn't contain a numeric value.
 */
function extractNumericValue(
  expr: Expr
): { value: number; units: string } | null {
  if (expr.type === 'Number' || expr.type === 'Var') {
    return {
      value: expr.value,
      units: expr.units,
    }
  }
  return null
}

/**
 * Helper function to apply a drag vector to a Point2D Expr.
 * Returns a new Expr with the vector applied.
 */
function applyVectorToPoint2D(
  point: { x: Expr; y: Expr },
  vector: Vector2
): { x: Expr; y: Expr } {
  const xValue = extractNumericValue(point.x)
  const yValue = extractNumericValue(point.y)

  if (!xValue || !yValue) {
    // If we can't extract values, return original
    return point
  }

  return {
    x: {
      type: 'Var',
      value: roundOff(xValue.value + vector.x),
      units: forceSuffix(xValue.units),
    },
    y: {
      type: 'Var',
      value: roundOff(yValue.value + vector.y),
      units: forceSuffix(yValue.units),
    },
  }
}

/**
 * Helper function to build a segment ctor with drag applied.
 * For the entity under cursor, uses twoD directly.
 * For other entities, applies twoDVec to their current positions.
 */
export function buildSegmentCtorWithDrag({
  objUnderCursor: obj,
  selectedObjects: objects,
  isEntityUnderCursor,
  currentCursorPosition,
  dragVec,
  units,
}: {
  objUnderCursor: ApiObject
  selectedObjects: Array<ApiObject>
  isEntityUnderCursor: boolean
  currentCursorPosition: Vector2
  dragVec: Vector2
  units: NumericSuffix
}): SegmentCtor | null {
  const baseCtor = buildSegmentCtorFromObject(obj, objects)
  if (!baseCtor) {
    return null
  }

  if (baseCtor.type === 'Point') {
    if (isEntityUnderCursor) {
      // Use twoD directly for entity under cursor
      // Note: currentCursorPosition comes from intersectionPoint.twoD which is in world coordinates and scaled to match current units
      return {
        type: 'Point',
        position: {
          x: {
            type: 'Var',
            value: roundOff(currentCursorPosition.x),
            units,
          },
          y: {
            type: 'Var',
            value: roundOff(currentCursorPosition.y),
            units,
          },
        },
      }
    } else {
      // Apply drag vector to current position
      const currentPos = {
        x: baseCtor.position.x,
        y: baseCtor.position.y,
      }
      const newPos = applyVectorToPoint2D(currentPos, dragVec)
      return {
        type: 'Point',
        position: newPos,
      }
    }
  } else if (baseCtor.type === 'Line') {
    // For lines, always apply the drag vector to both endpoints (translate the line)
    // This applies whether it's the entity under cursor or another selected entity
    const newStart = applyVectorToPoint2D(baseCtor.start, dragVec)
    const newEnd = applyVectorToPoint2D(baseCtor.end, dragVec)
    return {
      type: 'Line',
      start: newStart,
      end: newEnd,
    }
  }

  return baseCtor
}
