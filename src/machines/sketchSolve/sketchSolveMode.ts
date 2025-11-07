import {
  assertEvent,
  assign,
  createMachine,
  sendParent,
  sendTo,
  setup,
} from 'xstate'
import type { ActorRefFrom } from 'xstate'
import type { SetSelections } from '@src/machines/modelingSharedTypes'
import { machine as centerRectTool } from '@src/machines/sketchSolve/tools/centerRectTool'
import { machine as dimensionTool } from '@src/machines/sketchSolve/tools/dimensionTool'
import { machine as pointTool } from '@src/machines/sketchSolve/tools/pointTool'
import { machine as lineTool } from '@src/machines/sketchSolve/tools/lineTool'
import type {
  ApiObject,
  ExistingSegmentCtor,
  Expr,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  codeManager,
  rustContext,
  sceneInfra,
  sceneEntitiesManager,
} from '@src/lib/singletons'
import {
  SEGMENT_TYPE_LINE,
  SEGMENT_TYPE_POINT,
  type SegmentUtils,
  segmentUtilsMap,
  updateLineSegmentHover,
} from '@src/machines/sketchSolve/segments'
import { Group, Mesh, OrthographicCamera, Vector2 } from 'three'
import { orthoScale } from '@src/clientSideScene/helpers'
import {
  getParentGroup,
  STRAIGHT_SEGMENT_BODY,
} from '@src/clientSideScene/sceneConstants'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
import type {
  DefaultPlane,
  ExtrudeFacePlane,
  OffsetPlane,
} from '@src/machines/modelingSharedTypes'
import {
  SKETCH_LAYER,
  SKETCH_SOLVE_GROUP,
} from '@src/clientSideScene/sceneUtils'
import type { Themes } from '@src/lib/theme'
import { disposeGroupChildren } from '@src/clientSideScene/sceneHelpers'
import { forceSuffix } from '@src/lang/util'

const equipTools = Object.freeze({
  centerRectTool,
  dimensionTool,
  pointTool,
  lineTool,
})

const CHILD_TOOL_ID = 'child tool'
const CHILD_TOOL_DONE_EVENT = `xstate.done.actor.${CHILD_TOOL_ID}`

/**
 * Helper function to build a segment ctor from a scene graph object.
 * Returns null if the object is not a segment or if required data is missing.
 */
function buildSegmentCtorFromObject(
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
          units: 'Mm',
        },
        y: {
          type: 'Number',
          value: obj.kind.segment.position.y.value,
          units: 'Mm',
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
function updateSegmentGroup({
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
  onUpdateSketchOutcome,
}: {
  input: Parameters<SegmentUtils['init']>[0]['input']
  theme: Themes
  scale: number
  id: number
  onUpdateSketchOutcome: (data: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }) => void
}): Promise<Group> {
  if (input.type === 'Point') {
    return segmentUtilsMap.PointSegment.init({
      input,
      theme,
      scale,
      id,
      onUpdateSketchOutcome,
    })
  } else if (input.type === 'Line') {
    return segmentUtilsMap.LineSegment.init({
      input,
      theme,
      scale,
      id,
      onUpdateSketchOutcome,
    })
  }
  return Promise.reject(new Error(`Unknown input type: ${(input as any).type}`))
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
    x: { type: 'Var', value: point.kind.segment.position.x.value, units: 'Mm' },
    y: { type: 'Var', value: point.kind.segment.position.y.value, units: 'Mm' },
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
function buildSegmentCtorWithDrag({
  objUnderCursor: obj,
  selectedObjects: objects,
  isEntityUnderCursor,
  currentCursorPosition,
  dragVec,
}: {
  objUnderCursor: ApiObject
  selectedObjects: Array<ApiObject>
  isEntityUnderCursor: boolean
  currentCursorPosition: Vector2
  dragVec: Vector2
}): SegmentCtor | null {
  const baseCtor = buildSegmentCtorFromObject(obj, objects)
  if (!baseCtor) {
    return null
  }

  if (baseCtor.type === 'Point') {
    if (isEntityUnderCursor) {
      // Use twoD directly for entity under cursor
      return {
        type: 'Point',
        position: {
          x: {
            type: 'Var',
            value: roundOff(currentCursorPosition.x),
            units: 'Mm',
          },
          y: {
            type: 'Var',
            value: roundOff(currentCursorPosition.y),
            units: 'Mm',
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
    console.log('baseCtor.start', baseCtor.start, dragVec, newStart)
    const newEnd = applyVectorToPoint2D(baseCtor.end, dragVec)
    return {
      type: 'Line',
      start: newStart,
      end: newEnd,
    }
  }

  return baseCtor
}

export type EquipTool = keyof typeof equipTools

// Type for the spawn function used in XState setup actions
// This provides better type safety by constraining the actor parameter to valid tool names
// and ensuring the return type matches the specific tool actor
type SpawnToolActor = <K extends EquipTool>(
  src: K,
  options?: { id?: string }
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
    }
  | { type: 'update selected ids'; data: { selectedIds?: Array<number> } }
  | { type: typeof CHILD_TOOL_DONE_EVENT }
  | {
      type: 'update sketch outcome'
      data: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }

type SketchSolveContext = {
  sketchSolveToolName: EquipTool | null
  pendingToolName?: EquipTool
  selectedIds: Array<number>
  sketchExecOutcome?: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }
  // Plane/face data from the 'animate-to-sketch-solve' actor
  initialPlane?: DefaultPlane | OffsetPlane | ExtrudeFacePlane
}

export const sketchSolveMachine = setup({
  types: {
    context: {} as SketchSolveContext,
    events: {} as SketchSolveMachineEvent,
    input: {} as {
      initialSketchSolvePlane?:
        | DefaultPlane
        | OffsetPlane
        | ExtrudeFacePlane
        | null
    },
  },
  actions: {
    'initialize intersection plane': ({ context }) => {
      if (context.initialPlane) {
        sceneEntitiesManager.initSketchSolveEntityOrientation(
          context.initialPlane
        )
      }
    },
    setUpOnDragAndSelectionClickCallbacks: ({ self }) => {
      // Closure-scoped mutex to prevent concurrent async editSegment operations.
      // Not in XState context since it's purely an implementation detail for race condition prevention.
      let isSolveInProgress = false
      let lastHoveredMesh: Mesh | null = null
      let lastSuccessfulDragFromPoint = new Vector2()
      sceneInfra.setCallbacks({
        onDragStart: ({ intersectionPoint }) => {
          // reset on drag start
          lastSuccessfulDragFromPoint = intersectionPoint.twoD.clone()
        },
        onDrag: async ({ selected, intersectionPoint }) => {
          if (isSolveInProgress) {
            return
          }

          const snapshot = self.getSnapshot()
          const selectedIds = snapshot.context.selectedIds
          const sceneGraphDelta =
            snapshot.context.sketchExecOutcome?.sceneGraphDelta

          if (!sceneGraphDelta) {
            return
          }

          // Get the entity under cursor (could be Point or Line)
          const groupUnderCursor = getParentGroup(selected, [
            SEGMENT_TYPE_POINT,
            SEGMENT_TYPE_LINE,
          ])
          const entityUnderCursorId = groupUnderCursor
            ? Number(groupUnderCursor.name)
            : null

          // If no entity under cursor and no selectedIds, nothing to do
          if (!entityUnderCursorId && selectedIds.length === 0) {
            return
          }

          isSolveInProgress = true
          const twoD = intersectionPoint.twoD
          const dragVec = twoD.clone().sub(lastSuccessfulDragFromPoint)

          const objects = sceneGraphDelta.new_graph.objects
          const segmentsToEdit: ExistingSegmentCtor[] = []

          // Collect all IDs to edit (entity under cursor + selectedIds)
          const idsToEdit = new Set<number>()
          if (
            entityUnderCursorId !== null &&
            !Number.isNaN(entityUnderCursorId)
          ) {
            idsToEdit.add(entityUnderCursorId)
          }
          selectedIds.forEach((id) => {
            if (!Number.isNaN(id)) {
              idsToEdit.add(id)
            }
          })

          // Build ctors for each segment
          for (const id of idsToEdit) {
            const obj = objects[id]
            if (!obj) {
              continue
            }

            // Skip if not a segment
            if (obj.kind.type !== 'Segment') {
              continue
            }

            const isEntityUnderCursor = id === entityUnderCursorId
            const ctor = buildSegmentCtorWithDrag({
              objUnderCursor: obj,
              selectedObjects: objects,
              isEntityUnderCursor,
              currentCursorPosition: twoD,
              dragVec: dragVec,
            })

            if (ctor) {
              segmentsToEdit.push({ id, ctor })
            }
          }

          if (segmentsToEdit.length === 0) {
            isSolveInProgress = false
            return
          }

          const result = await rustContext
            .editSegments(0, 0, segmentsToEdit, await jsAppSettings())
            .catch((err) => {
              console.error('failed to edit segment', err)
              return null
            })

          isSolveInProgress = false
          // after successful drag, update the lastSuccessfulDragFromPoint
          lastSuccessfulDragFromPoint = twoD.clone()

          // send event
          if (result) {
            self.send({
              type: 'update sketch outcome',
              data: result,
            })
          }
        },
        onClick: async ({ selected, mouseEvent }) => {
          const group = getParentGroup(selected, [
            SEGMENT_TYPE_POINT,
            SEGMENT_TYPE_LINE,
          ])

          if (group) {
            const newSelectedIds = [Number(group?.name)]
            self.send({
              type: 'update selected ids',
              data: { selectedIds: newSelectedIds },
            })
            return
          }

          // No three.js selection under cursor. Check CSS2DObject under mouse.
          const el = document.elementFromPoint(
            mouseEvent.clientX,
            mouseEvent.clientY
          )
          let cur = el
          let pointId: number | null = null
          while (cur) {
            if (cur instanceof HTMLElement) {
              const idAttr = cur.dataset?.segment_id
              if (idAttr && !Number.isNaN(Number(idAttr))) {
                pointId = Number(idAttr)
                break
              }
              cur = cur.parentElement
            }
          }

          if (pointId != null) {
            const newSelectedIds = [pointId]
            self.send({
              type: 'update selected ids',
              data: { selectedIds: newSelectedIds },
            })
          } else {
            // Truly dead space: clear selection
            self.send({
              type: 'update selected ids',
              data: {},
            })
          }
        },
        onMouseEnter: ({ selected }) => {
          if (!selected) return
          // Check if it's a line segment mesh
          const mesh = selected
          if (
            mesh.userData?.type === STRAIGHT_SEGMENT_BODY &&
            mesh instanceof Mesh
          ) {
            const snapshot = self.getSnapshot()
            const selectedIds = snapshot.context.selectedIds
            updateLineSegmentHover(mesh, true, selectedIds)
            lastHoveredMesh = mesh
          }
        },
        onMouseLeave: ({ selected }) => {
          // Clear hover state for the previously hovered mesh
          if (lastHoveredMesh) {
            const snapshot = self.getSnapshot()
            const selectedIds = snapshot.context.selectedIds
            updateLineSegmentHover(lastHoveredMesh, false, selectedIds)
            lastHoveredMesh = null
          }
          // Also handle if selected is provided (for safety)
          if (selected) {
            const mesh = selected
            if (
              mesh.userData?.type === STRAIGHT_SEGMENT_BODY &&
              mesh instanceof Mesh
            ) {
              const snapshot = self.getSnapshot()
              const selectedIds = snapshot.context.selectedIds
              updateLineSegmentHover(mesh, false, selectedIds)
            }
          }
        },
      })
    },
    'clear hover callbacks': ({ self }) => {
      // Clear hover callbacks to prevent interference with tool operations
      sceneInfra.setCallbacks({
        onMouseEnter: () => {},
        onMouseLeave: () => {},
      })

      // Clear any currently hovered line segment meshes
      const snapshot = self.getSnapshot()
      const selectedIds = snapshot.context.selectedIds
      const sketchSegments =
        sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
      if (sketchSegments) {
        sketchSegments.traverse((child) => {
          if (
            child instanceof Mesh &&
            child.userData?.type === STRAIGHT_SEGMENT_BODY &&
            child.userData.isHovered === true
          ) {
            updateLineSegmentHover(child, false, selectedIds)
          }
        })
      }
    },
    'cleanup sketch solve group': () => {
      console.log('Cleaning up sketch solve group...')
      const sketchSegments =
        sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
      if (!sketchSegments || !(sketchSegments instanceof Group)) {
        console.log('yo no sketch segments to clean up')
        return
      }
      disposeGroupChildren(sketchSegments)
    },
    'send unequip to tool': sendTo(CHILD_TOOL_ID, { type: 'unequip' }),
    'send update selection to equipped tool': sendTo(CHILD_TOOL_ID, {
      type: 'update selection',
    }),
    'send updated selection to move tool': sendTo('moveTool', {
      type: 'update selection',
    }),
    'store pending tool': assign(({ event }) => {
      assertEvent(event, 'equip tool')
      return { pendingToolName: event.data.tool }
    }),
    'send tool equipped to parent': sendParent(({ context }) => ({
      type: 'sketch solve tool changed',
      data: { tool: context.sketchSolveToolName },
    })),
    'send tool unequipped to parent': sendParent({
      type: 'sketch solve tool changed',
      data: { tool: null },
    }),
    'update selected ids': assign(({ event, context }) => {
      assertEvent(event, 'update selected ids')
      const first = event.data?.selectedIds?.[0]
      if (
        event.data?.selectedIds?.length === 1 &&
        first &&
        context.selectedIds.includes(first)
      ) {
        // If only one ID is selected and it's already in the selection, remove only it from the selection
        return {
          selectedIds: context.selectedIds.filter((id) => id !== first),
        }
      }
      const result = event.data.selectedIds
        ? Array.from(
            new Set([...context.selectedIds, ...event.data.selectedIds])
          )
        : []
      return {
        selectedIds: result,
      }
    }),
    'refresh selection styling': ({ context }) => {
      // Update selection styling for all existing sketch-solve segments
      if (!context.sketchExecOutcome?.sceneGraphDelta) {
        return
      }
      const sceneGraphDelta = context.sketchExecOutcome.sceneGraphDelta
      const objects = sceneGraphDelta.new_graph.objects
      const orthoFactor = orthoScale(sceneInfra.camControls.camera)
      const factor =
        sceneInfra.camControls.camera instanceof OrthographicCamera
          ? orthoFactor
          : orthoFactor

      sceneGraphDelta.new_graph.objects.forEach((obj) => {
        if (obj.kind.type === 'Sketch' || obj.kind.type === 'Constraint') {
          return
        }
        const group = sceneInfra.scene.getObjectByName(String(obj.id))
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
          selectedIds: context.selectedIds,
          scale: factor,
          theme: sceneInfra.theme,
        })
      })
    },
    'update sketch outcome': assign(({ event, self, context }) => {
      assertEvent(event, 'update sketch outcome')
      codeManager.updateCodeEditor(event.data.kclSource.text)
      const sceneGraphDelta = event.data.sceneGraphDelta
      const objects = sceneGraphDelta.new_graph.objects
      const orthoFactor = orthoScale(sceneInfra.camControls.camera)
      const factor =
        sceneInfra.camControls.camera instanceof OrthographicCamera
          ? orthoFactor
          : orthoFactor
      sceneInfra.baseUnitMultiplier
      const sketchSegments = sceneInfra.scene.children.find(
        ({ userData }) => userData?.type === SKETCH_SOLVE_GROUP
      )

      // This invalidation logic is kinda based on some heuristics and is not exchaustive.
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
          sceneInfra.scene.remove(child)
        })
      }
      sceneGraphDelta.new_graph.objects.forEach((obj) => {
        if (obj.kind.type === 'Sketch' || obj.kind.type === 'Constraint') {
          return
        }
        const group = sceneInfra.scene.getObjectByName(String(obj.id))
        const ctor = buildSegmentCtorFromObject(obj, objects)
        if (!(group instanceof Group)) {
          if (!ctor) {
            return
          }
          initSegmentGroup({
            input: ctor,
            theme: sceneInfra.theme,
            scale: factor,
            id: obj.id,
            onUpdateSketchOutcome: (data) =>
              self.send({
                type: 'update sketch outcome',
                data,
              }),
          })
            .then((group) => {
              const sketchSceneGroup =
                sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
              if (sketchSceneGroup) {
                group.traverse((child) => {
                  child.layers.set(SKETCH_LAYER)
                })
                group.layers.set(SKETCH_LAYER)
                sketchSceneGroup.add(group)
              }
            })
            .catch((e) => {
              console.error('Failed to init PointSegment for object', obj.id, e)
            })
          return
        }
        if (!ctor) {
          return
        }
        updateSegmentGroup({
          group,
          input: ctor,
          selectedIds: context.selectedIds,
          scale: factor,
          theme: sceneInfra.theme,
        })
      })

      return {
        sketchExecOutcome: {
          kclSource: event.data.kclSource,
          sceneGraphDelta: event.data.sceneGraphDelta,
        },
      }
    }),
    'spawn tool': assign(({ event, spawn, context }) => {
      // Determine which tool to spawn based on event type
      let nameOfToolToSpawn: EquipTool

      if (event.type === 'equip tool') {
        nameOfToolToSpawn = event.data.tool
      } else if (
        event.type === CHILD_TOOL_DONE_EVENT &&
        context.pendingToolName
      ) {
        nameOfToolToSpawn = context.pendingToolName
      } else {
        console.error('Cannot determine tool to spawn')
        return {}
      }
      // this type-annotation informs spawn tool of the association between the EquipTools type and the machines in equipTools
      // It's not an type assertion. TS still checks that _spawn is assignable to SpawnToolActor.
      const typedSpawn: SpawnToolActor = spawn
      typedSpawn(nameOfToolToSpawn, { id: CHILD_TOOL_ID })

      return {
        sketchSolveToolName: nameOfToolToSpawn,
        pendingToolName: undefined, // Clear the pending tool after spawning
      }
    }),
  },
  actors: {
    moveToolActor: createMachine({
      /* ... */
    }),
    ...equipTools,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiMADwEsMBtABgF1FQAHQrFbNCAO14hGiAIwB2ABwBWAHTyAbAGZFAFiXyOAJg0BOADQgAnolkrpHQwe1rFz59I0BfD+bSZcBEnIqGnoAVz4IAEMMClgwYjAsDBFRTh4kEAEhZLEJKQRZNXllRX1jDQM1A3lpA1lzKwQAWgNjA2U1aTVC+07jRQ0NNS8fdGx8IjIKalo6cKiYvFgx-0JQ7EIAWzA0iSzhXIz82sV241qNeW1L+X7nBsQWk2VDaXV1cp1tGxGQX3GAlNgrNQqIwABHULMPh4DCEEi7DL7HLiI6IbSKFRXAyKWRODTaDiFbQPZpGaTKIZvGzyGqlWTSbS-f7+SZBGb0LCEZiiLDMWiidjcPaCA6o0CNJpKSnGYyyGwExW6eqSRBGDjGVSaHR6QwmZkrCaBaYhOgAGR5cAAopDIsQzWBRFAMDhEfxRSiJJLpSY5QrrgH5Cr8urNeotLpSnrjAa-EagRy6AA1MAAJ2SWDtbsyHpSXsePtl8oGAYJQfMIY0Gq1Ed1Rhj3j+hsB7NNAAlCKnmAAvMQYLPCpG5w4SgsqX3FpVl4Nqqth7WR-T12MAtkmkERaKxeKJGIQPD82DZ5F5jLe8dF-1K8uqhChms6qPLxss+Ot2jKTaEIKRUT7uIJEkdAQGIYDKDypCEOgn7fmAAAq8LEMew7iretTnJSQx1IoHDaHIZiWNYaglPIlRqBi+jyFWTIvs2a7AmBX4-n+Sw7kBaapp2yh8MQ0QAGadpsMHkAhCKDu62SnqAxytO09ikZ0QZ4toOKkrU2iqJUNRqLK0guBwtQrqyxoMcJFC-v+bEYAwkLQrCiHIZJI5oXYLyyP0xhUdUcqYvIpIGO4qilMYHBDKROKVEZb7rmBoRCE69kkHMYK2TCcJiekElinkMi4cUGhdHi6iyKFQwkoRCARiUiiysYKl4Woai4VFLYxcocU8lAiXEDZUJpQ54k5k5qH5HKFKtKF2i6CYshkaS3zFDYuIaAooUltILX0RyyiwAA7qwuCdd1dCMLA-YxMoIFgsokRJFxjnZWiCByu0tzGEUuE1RwOlqKS5HFHps0VAM3SkRttFxq1pmghCfV8Ed6U9ad51gVdYG3XCqbKA9npPXY3zKAYrSXJc0hqRhoOhZUjikXKXiNqIITwBkr5QxyIrDTlCBVG5HlebcS1+RVUoXnKQYGTpQZVJtJnbUx5ksQBu4c490mICtsiE20s16U1ROqRVdjtAoE1E1WOGyDLCYhO18VdYjKu42rlX9ITpEFeo1Q6IopJVsUpyFIMmIYooVvvmBe0HTgCOIY7Um3q0Gk1WR5yDCYbx-XUyhTUGSoGES0sQ6uss20wwhOnHznHLoxHfN01yyk4Okqo0sqaR93yYnVNNh21MOpfDCUO0OnN40YmvSO9XRKO9EuksHygMjYem4p5OLg14QA */
  context: ({ input }): SketchSolveContext => ({
    sketchSolveToolName: null,
    selectedIds: [],
    initialPlane: input?.initialSketchSolvePlane ?? undefined,
  }),
  id: 'Sketch Solve Mode',
  initial: 'move and select',
  on: {
    exit: {
      target: '#Sketch Solve Mode.exiting',
      actions: [
        'send unequip to tool',
        'send tool unequipped to parent',
        'cleanup sketch solve group',
      ],
      description:
        'the outside world can request that sketch mode exit, but it needs to handle its own teardown first.',
    },
    'update selection': {
      actions: [
        'send update selection to equipped tool',
        'send updated selection to move tool',
      ],
      description:
        'sketch mode consumes the current selection from its source of truth (currently modelingMachine). Whenever it receives',
    },
    'update sketch outcome': {
      actions: 'update sketch outcome',
      description:
        'Updates the sketch execution outcome in the context when tools complete operations',
    },
    'unequip tool': {
      actions: 'send unequip to tool',
    },
    coincident: {
      actions: async ({ self, context }) => {
        // TODO this is not how coincident should operate long term, as it should be an equipable tool
        const result = await rustContext.addConstraint(
          0,
          0,
          {
            type: 'Coincident',
            points: context.selectedIds,
          },
          await jsAppSettings()
        )
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    Parallel: {
      actions: async ({ self, context }) => {
        // TODO this is not how coincident should operate long term, as it should be an equipable tool
        const result = await rustContext.addConstraint(
          0,
          0,
          {
            type: 'Parallel',
            lines: context.selectedIds,
          },
          await jsAppSettings()
        )
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    LinesEqualLength: {
      actions: async ({ self, context }) => {
        // TODO this is not how LinesEqualLength should operate long term, as it should be an equipable tool
        const result = await rustContext.addConstraint(
          0,
          0,
          {
            type: 'LinesEqualLength',
            lines: context.selectedIds,
          },
          await jsAppSettings()
        )
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    Vertical: {
      actions: async ({ self, context }) => {
        let result
        for (const id of context.selectedIds) {
          // TODO this is not how Vertical should operate long term, as it should be an equipable tool
          result = await rustContext.addConstraint(
            0,
            0,
            {
              type: 'Vertical',
              line: id,
            },
            await jsAppSettings()
          )
        }
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    Horizontal: {
      actions: async ({ self, context }) => {
        let result
        for (const id of context.selectedIds) {
          // TODO this is not how Horizontal should operate long term, as it should be an equipable tool
          result = await rustContext.addConstraint(
            0,
            0,
            {
              type: 'Horizontal',
              line: id,
            },
            await jsAppSettings()
          )
        }
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: result,
          })
        }
      },
    },
    'update selected ids': {
      actions: ['update selected ids', 'refresh selection styling'],
    },
  },
  states: {
    'move and select': {
      entry: ['setUpOnDragAndSelectionClickCallbacks'],
      on: {
        'equip tool': {
          target: 'using tool',
          actions: 'store pending tool',
        },
      },
      invoke: {
        id: 'moveTool',
        input: {},
        onDone: {
          target: 'exiting',
        },
        onError: {
          target: 'exiting',
        },
        src: 'moveToolActor',
      },
      description:
        'The base state of sketch mode is to all the user to move around the scene and select geometry.',
    },

    'using tool': {
      on: {
        'unequip tool': {
          target: 'unequipping tool',
          actions: ['send unequip to tool'],
          reenter: true,
        },

        'equip tool': {
          target: 'switching tool',
          actions: ['send unequip to tool', 'store pending tool'],
        },
      },

      description:
        'Tools are workflows that create or modify geometry in the sketch scene after conditions are met. Some, like the Dimension, Center Rectangle, and Tangent tools, are finite, which they signal by reaching a final state. Some, like the Spline tool, appear to be infinite. In these cases, it is up to the tool Actor to receive whatever signal (such as the Esc key for Spline) necessary to reach a final state and unequip itself.\n\nTools can request to be unequipped from the outside by a "unequip tool" event sent to the sketch machine. This will sendTo the toolInvoker actor.',

      entry: [
        'spawn tool',
        'send tool equipped to parent',
        'clear hover callbacks',
      ],
    },

    'switching tool': {
      on: {
        [CHILD_TOOL_DONE_EVENT]: {
          target: 'using tool',
          actions: [
            () => console.log('switched tools with xstate.done.actor.tool'),
          ],
        },
      },

      description:
        'Intermediate state while the current tool is cleaning up before spawning a new tool.',

      exit: [() => console.log('exiting switching tool')],
    },

    exiting: {
      type: 'final',
      description: 'Place any teardown code here.',
    },

    'unequipping tool': {
      on: {
        [CHILD_TOOL_DONE_EVENT]: {
          target: 'move and select',
          actions: ['send tool unequipped to parent'],
        },
      },

      description: `Intermediate state, same as the "switching tool" state, but for unequip`,
    },
  },

  entry: [
    'initialize intersection plane',
    'setUpOnDragAndSelectionClickCallbacks',
  ],
})
