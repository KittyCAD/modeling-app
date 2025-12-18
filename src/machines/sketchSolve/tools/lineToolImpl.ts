import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type {
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclManager } from '@src/lang/KclManager'
import {
  type ActionArgs,
  type AssignArgs,
  type ProvidedActor,
  type DoneActorEvent,
} from 'xstate'
import { roundOff } from '@src/lib/utils'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'

export const TOOL_ID = 'Line tool'
export const CONFIRMING_DIMENSIONS = 'Confirming dimensions'
export const ADDING_POINT = `xstate.done.actor.0.${TOOL_ID}.Adding point`
export const CONFIRMING_DIMENSIONS_EVENT = `xstate.done.actor.0.${TOOL_ID}.${CONFIRMING_DIMENSIONS}`

export type ToolEvents =
  | BaseToolEvent

  // because the single click will still fire before the double click, we have to have a way of
  // doing the single click action (creating a new segment chained to the old one) but then catch this
  // and reverse it if a double click is detected
  | { type: 'set pending double click' }
  | {
      type: typeof ADDING_POINT | typeof CONFIRMING_DIMENSIONS_EVENT
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }

export type ToolContext = {
  draftPointId?: number
  lastLineEndPointId?: number
  isDoubleClick?: boolean
  pendingDoubleClick?: boolean
  pendingSketchOutcome?: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }
  deleteFromEscape?: boolean // Track if deletion was triggered by escape (vs unequip)
  sceneGraphDelta: SceneGraphDelta
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
}

export type ToolActionArgs = ActionArgs<ToolContext, ToolEvents, ToolEvents>

type ToolAssignArgs<TActor extends ProvidedActor = any> = AssignArgs<
  ToolContext,
  ToolEvents,
  ToolEvents,
  TActor
>

////////////// --Actions-- //////////////////

export function animateDraftSegmentListener({ self, context }: ToolActionArgs) {
  let isEditInProgress = false
  context.sceneInfra.setCallbacks({
    onMove: async (args) => {
      if (!args || !context.draftPointId) return
      const twoD = args.intersectionPoint?.twoD
      if (twoD && !isEditInProgress) {
        // Send the add point event with the clicked coordinates

        const units = baseUnitToNumericSuffix(
          context.kclManager.fileSettings.defaultLengthUnit
        )
        try {
          isEditInProgress = true
          const settings = await jsAppSettings(
            context.rustContext.settingsActor
          )
          // Note: twoD comes from intersectionPoint.unscaledTwoD which is in world coordinates, and always mm
          const result = await context.rustContext.editSegments(
            0,
            context.sketchId,
            [
              {
                id: context.draftPointId,
                ctor: {
                  type: 'Point',
                  position: {
                    x: {
                      type: 'Var',
                      value: roundOff(twoD.x),
                      units,
                    },
                    y: {
                      type: 'Var',
                      value: roundOff(twoD.y),
                      units,
                    },
                  },
                },
              },
            ],
            settings
          )
          self._parent?.send({
            type: 'update sketch outcome',
            data: { ...result, writeToDisk: false },
          })
          await new Promise((resolve) => requestAnimationFrame(resolve))
        } catch (err) {
          console.error('failed to edit segment', err)
        } finally {
          isEditInProgress = false
        }
      }
    },
    onClick: async (args) => {
      if (!args || !context.draftPointId) return
      const twoD = args.intersectionPoint?.twoD
      if (twoD) {
        const isDoubleClick = args.mouseEvent.detail === 2
        // Set pending double-click flag immediately if detected
        if (isDoubleClick) {
          self.send({
            type: 'set pending double click',
          })
        }
        self.send({
          type: 'add point',
          data: [twoD.x, twoD.y],
          id: context.draftPointId,
          isDoubleClick,
        })
      }
    },
  })
}

export function addPointListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args) return
      if (args.mouseEvent.which !== 1) return // Only left click

      const twoD = args.intersectionPoint?.twoD
      if (twoD) {
        const isDoubleClick = args.mouseEvent.detail === 2
        // If it's a double-click, set the flag immediately BEFORE sending the event
        // This ensures any pending operations from the first click will be cancelled
        if (isDoubleClick) {
          // Send the flag-setting event first, synchronously
          self.send({ type: 'set pending double click' })
        }
        // Send the add point event with the clicked coordinates
        self.send({
          type: 'add point',
          data: [twoD.x, twoD.y],
          isDoubleClick,
        })
      }
    },
    onMove: () => {},
  })
}

export function removePointListener({ context }: ToolActionArgs) {
  // Reset callbacks to remove the onClick and onMove listeners
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

export function sendResultToParent({ event, self }: ToolAssignArgs<any>) {
  if (
    event.type !== ADDING_POINT &&
    event.type !== CONFIRMING_DIMENSIONS_EVENT
  ) {
    // Handle delete result or other events
    if ('output' in event && event.output) {
      const output = event.output as {
        kclSource?: SourceDelta
        sceneGraphDelta?: SceneGraphDelta
        error?: string
      }

      if (output.error) {
        return {}
      }

      // Send result to parent if we have valid data
      if (output.kclSource && output.sceneGraphDelta) {
        self._parent?.send({
          type: 'update sketch outcome',
          data: {
            kclSource: output.kclSource,
            sceneGraphDelta: output.sceneGraphDelta,
          },
        })
      }
    }
    return {}
  }

  // Check if the output has a newLineEndPointId (from modAndSolve when chaining)
  const output = event.output as {
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
    newLineEndPointId?: number
    newlyAddedEntities?: {
      segmentIds: Array<number>
      constraintIds: Array<number>
    }
    error?: string
  }

  // If there's an error, don't update context
  if (output.error) {
    return {}
  }

  // Don't send result to parent here - we'll send it after checking double-click flag
  // This prevents editor flicker by only updating once we know if we're keeping or deleting

  // If we have a newLineEndPointId from chaining, use that as the draftPointId
  if (output.newLineEndPointId !== undefined) {
    // Find the line segment to get its end point ID for tracking
    const lineId = [...output.sceneGraphDelta!.new_objects]
      .reverse()
      .find((objId) => {
        const obj = output.sceneGraphDelta!.new_graph.objects[objId]
        if (!obj) return false
        return obj.kind.type === 'Segment' && obj.kind.segment.type === 'Line'
      })

    let lastLineEndPointId: number | undefined
    if (lineId !== undefined) {
      const lineObj = output.sceneGraphDelta!.new_graph.objects[lineId]
      if (
        lineObj?.kind.type === 'Segment' &&
        lineObj.kind.segment.type === 'Line'
      ) {
        // The end point ID is stored in the Line segment
        lastLineEndPointId = lineObj.kind.segment.end
      }
    }

    // Send draft entities to parent if they exist (from chaining)
    if (output.newlyAddedEntities) {
      self._parent?.send({
        type: 'set draft entities',
        data: output.newlyAddedEntities,
      })
    }

    return {
      draftPointId: output.newLineEndPointId,
      lastLineEndPointId,
      sceneGraphDelta: output.sceneGraphDelta,
    }
  }

  // For the first point creation, find the point ID normally
  const pointIds =
    output.sceneGraphDelta?.new_objects.filter((objId) => {
      const obj = output.sceneGraphDelta!.new_graph.objects[objId]
      if (!obj) return false
      return obj.kind.type === 'Segment' && obj.kind.segment.type === 'Point'
    }) || []

  // The last point ID is the end point of the newly created line
  const pointId = pointIds[pointIds.length - 1]

  // Find the line segment to get its end point ID
  const lineId = [...(output.sceneGraphDelta?.new_objects || [])]
    .reverse()
    .find((objId) => {
      const obj = output.sceneGraphDelta!.new_graph.objects[objId]
      if (!obj) return false
      return obj.kind.type === 'Segment' && obj.kind.segment.type === 'Line'
    })

  let lastLineEndPointId: number | undefined
  if (lineId !== undefined && output.sceneGraphDelta) {
    const lineObj = output.sceneGraphDelta.new_graph.objects[lineId]
    if (
      lineObj?.kind.type === 'Segment' &&
      lineObj.kind.segment.type === 'Line'
    ) {
      // The end point ID is stored in the Line segment
      lastLineEndPointId = lineObj.kind.segment.end
    }
  }

  // Track entities created in first point creation for potential deletion on unequip
  const entitiesToTrack: {
    segmentIds: Array<number>
    constraintIds: Array<number>
  } = {
    segmentIds: [],
    constraintIds: [],
  }

  // Add point IDs and line ID to tracking
  if (pointIds.length > 0 && output.sceneGraphDelta) {
    entitiesToTrack.segmentIds.push(...pointIds)
  }
  if (lineId !== undefined) {
    entitiesToTrack.segmentIds.push(lineId)
  }

  // Send draft entities to parent for tracking
  if (entitiesToTrack.segmentIds.length > 0) {
    self._parent?.send({
      type: 'set draft entities',
      data: entitiesToTrack,
    })
  }

  if (pointId !== undefined && output.sceneGraphDelta) {
    return {
      draftPointId: pointId,
      lastLineEndPointId,
      sceneGraphDelta: output.sceneGraphDelta,
    }
  }
  return {}
}

export function storePendingSketchOutcome({
  event,
  self,
}: {
  event: DoneActorEvent<{
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
    newLineEndPointId?: number
    newlyAddedEntities?: {
      segmentIds: Array<number>
      constraintIds: Array<number>
    }
    error?: string
  }>
  self: ToolActionArgs['self']
}) {
  const output = event.output as {
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
    newLineEndPointId?: number
    newlyAddedEntities?: {
      segmentIds: Array<number>
      constraintIds: Array<number>
    }
    error?: string
  }

  const result: Partial<ToolContext> = {}

  // Send draft entities to parent for tracking
  if (output.newlyAddedEntities) {
    self._parent?.send({
      type: 'set draft entities',
      data: output.newlyAddedEntities,
    })
  }

  // Store the result, but DON'T send it yet - we'll check the flag in 'check double click' state
  // The key insight: if pendingDoubleClick is already true (set by the second click),
  // we should delete this result instead of sending it
  if (output.kclSource && output.sceneGraphDelta && !output.error) {
    result.pendingSketchOutcome = {
      kclSource: output.kclSource,
      sceneGraphDelta: output.sceneGraphDelta,
    }
  }

  return result
}

export function sendStoredResultToParent({ context, self }: ToolActionArgs) {
  // Send the stored result to parent (with new entities)
  // Note: We only reach this action if pendingDoubleClick is false (the guard above routes
  // double-clicks to the delete path). The debounceEditorUpdate flag allows the parent to
  // cancel this update if a subsequent double-click is detected within the debounce window.
  if (context.pendingSketchOutcome) {
    self._parent?.send({
      type: 'update sketch outcome',
      data: {
        ...context.pendingSketchOutcome,
        debounceEditorUpdate: true, // Debounce to allow cancellation if double-click is detected
      },
    })
    // Clear draft entities after successfully sending (they're now committed)
    self._parent?.send({ type: 'clear draft entities' })
  }
  return {}
}

export function sendDeleteResultToParentWithDebounce({
  event,
  self,
}: {
  event: DoneActorEvent<{
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
  }>
  self: ToolActionArgs['self']
}) {
  // Send the delete result to parent (this removes the entities)
  if (event.output) {
    const output = event.output as {
      kclSource?: SourceDelta
      sceneGraphDelta?: SceneGraphDelta
    }
    if (output.kclSource && output.sceneGraphDelta) {
      self._parent?.send({
        type: 'update sketch outcome',
        data: {
          kclSource: output.kclSource,
          sceneGraphDelta: output.sceneGraphDelta,
          debounceEditorUpdate: true, // Debounce to allow cancellation if needed
        },
      })
    }
  }
  return {}
}

export function sendDeleteResultToParent({
  event,
  self,
}: {
  event: DoneActorEvent<{
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
  }>
  self: ToolActionArgs['self']
}) {
  // Send the delete result to parent
  if (event.output) {
    const output = event.output as {
      kclSource?: SourceDelta
      sceneGraphDelta?: SceneGraphDelta
    }
    if (output.kclSource && output.sceneGraphDelta) {
      self._parent?.send({
        type: 'update sketch outcome',
        data: {
          kclSource: output.kclSource,
          sceneGraphDelta: output.sceneGraphDelta,
        },
      })
    }
  }
  return {}
}
