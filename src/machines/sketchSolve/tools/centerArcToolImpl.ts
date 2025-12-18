import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type {
  SceneGraphDelta,
  SourceDelta,
  SegmentCtor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclManager } from '@src/lang/KclManager'
import { type ActionArgs, type AssignArgs, type ProvidedActor } from 'xstate'
import { roundOff } from '@src/lib/utils'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import {
  shouldSwapStartEnd,
  calculateArcSwapState,
} from '@src/machines/sketchSolve/tools/centerArcSwapUtils'

export const TOOL_ID = 'Center arc tool'
export const SHOWING_RADIUS_PREVIEW = 'Showing radius preview'
export const ANIMATING_ARC = 'Animating arc'
export const ADDING_CENTER = `xstate.done.actor.0.${TOOL_ID}.Adding center`
export const CREATING_ARC = `xstate.done.actor.0.${TOOL_ID}.Creating arc`
export const FINALIZING_ARC = `xstate.done.actor.0.${TOOL_ID}.Finalizing arc`

export type ToolEvents =
  | BaseToolEvent
  | {
      type: 'add point'
      data: [x: number, y: number]
      clickNumber?: 1 | 2 | 3
    }
  | {
      type: 'update arc swapped'
      data: boolean
    }
  | {
      type: typeof ADDING_CENTER | typeof CREATING_ARC | typeof FINALIZING_ARC
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }

export type ToolContext = {
  centerPointId?: number
  centerPoint?: [number, number]
  arcId?: number
  arcEndPointId?: number
  arcStartPoint?: [number, number]
  arcIsSwapped?: boolean
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

/**
 * Given a center, start and arbitrary end point, project the end point onto
 * the circle defined by center->start, preserving radius but using the
 * direction from center to end.
 */
export function projectPointOntoArcRadius({
  center,
  start,
  end,
}: {
  center: [number, number]
  start: [number, number]
  end: [number, number]
}): [number, number] {
  const [cx, cy] = center
  const [sx, sy] = start
  const [ex, ey] = end

  const dxStart = sx - cx
  const dyStart = sy - cy
  const radius = Math.sqrt(dxStart * dxStart + dyStart * dyStart)
  if (!Number.isFinite(radius) || radius < 1e-6) {
    // Degenerate radius, just return the raw end
    return [ex, ey]
  }

  const dx = ex - cx
  const dy = ey - cy
  const len = Math.sqrt(dx * dx + dy * dy)
  if (!Number.isFinite(len) || len < 1e-6) {
    // Mouse at center: keep angle from start
    const angle = Math.atan2(dyStart, dxStart)
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
  }

  const scale = radius / len
  return [cx + dx * scale, cy + dy * scale]
}

/**
 * Listener for showing radius preview circle after first click.
 * Creates a draft circle that updates its radius as the mouse moves.
 */
export function showRadiusPreviewListener({ self, context }: ToolActionArgs) {
  if (!context.centerPoint) return

  context.sceneInfra.setCallbacks({
    onMove: (args) => {
      if (!args || !context.centerPoint) return
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return

      const dx = twoD.x - context.centerPoint[0]
      const dy = twoD.y - context.centerPoint[1]
      const radius = Math.sqrt(dx * dx + dy * dy)
      segmentUtilsMap.ArcSegment.updatePreviewCircle({
        sceneInfra: context.sceneInfra,
        center: context.centerPoint,
        radius,
      })
    },
    onClick: (args) => {
      if (!args) return
      if (args.mouseEvent.which !== 1) return // Only left click

      const twoD = args.intersectionPoint?.twoD
      if (twoD) {
        segmentUtilsMap.ArcSegment.removePreviewCircle(context.sceneInfra)
        self.send({
          type: 'add point',
          data: [twoD.x, twoD.y],
          clickNumber: 2,
        })
      }
    },
  })
}

/**
 * Listener for animating the arc endpoint after second click.
 * Updates the arc's end point as the user moves the mouse.
 */
export function animateArcEndPointListener({ self, context }: ToolActionArgs) {
  if (!context.arcId || !context.centerPoint || !context.arcStartPoint) return

  let isEditInProgress = false
  // Track whether start/end are swapped (instead of ccw flag)
  // If swapped, we're going CW; if not swapped, we're going CCW
  let isSwapped = context.arcIsSwapped ?? false
  // Track previous end position to detect crossing
  let previousEnd: [number, number] | undefined
  // Cache settings to avoid fetching on every mouse move
  let cachedSettings: Awaited<ReturnType<typeof jsAppSettings>> | null = null

  context.sceneInfra.setCallbacks({
    onMove: async (args) => {
      if (
        !args ||
        !context.arcId ||
        !context.centerPoint ||
        !context.arcStartPoint
      )
        return
      const twoD = args.intersectionPoint?.twoD
      if (twoD && !isEditInProgress) {
        const units = baseUnitToNumericSuffix(
          context.kclManager.fileSettings.defaultLengthUnit
        )
        try {
          isEditInProgress = true
          // Cache settings to avoid fetching on every mouse move
          if (!cachedSettings) {
            cachedSettings = await jsAppSettings(
              context.rustContext.settingsActor
            )
          }
          const settings = cachedSettings

          // Get the current start point (may be swapped)
          const startPoint = context.arcStartPoint

          const [endX, endY] = projectPointOntoArcRadius({
            center: context.centerPoint,
            start: startPoint,
            end: [twoD.x, twoD.y],
          })

          // Calculate swap state and final start/end points
          const {
            isSwapped: newIsSwapped,
            finalStart,
            finalEnd,
          } = calculateArcSwapState({
            center: context.centerPoint,
            startPoint,
            newEndPoint: [endX, endY],
            previousEnd,
            currentIsSwapped: isSwapped,
          })

          isSwapped = newIsSwapped

          // Update previous end for next comparison (use the actual end point position)
          previousEnd = [endX, endY]

          // Update the arc's end point
          const result = await context.rustContext.editSegments(
            0,
            context.sketchId,
            [
              {
                id: context.arcId,
                ctor: {
                  type: 'Arc',
                  center: {
                    x: {
                      type: 'Var',
                      value: roundOff(context.centerPoint[0]),
                      units,
                    },
                    y: {
                      type: 'Var',
                      value: roundOff(context.centerPoint[1]),
                      units,
                    },
                  },
                  start: {
                    x: {
                      type: 'Var',
                      value: roundOff(finalStart[0]),
                      units,
                    },
                    y: {
                      type: 'Var',
                      value: roundOff(finalStart[1]),
                      units,
                    },
                  },
                  end: {
                    x: { type: 'Var', value: roundOff(finalEnd[0]), units },
                    y: { type: 'Var', value: roundOff(finalEnd[1]), units },
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

          // Update context with the swapped state
          self.send({
            type: 'update arc swapped',
            data: isSwapped,
          })
          await new Promise((resolve) => requestAnimationFrame(resolve))
        } catch (err) {
          console.error('failed to edit arc segment', err)
        } finally {
          isEditInProgress = false
        }
      }
    },
    onClick: (args) => {
      if (!args) return
      if (args.mouseEvent.which !== 1) return // Only left click

      const twoD = args.intersectionPoint?.twoD
      if (twoD) {
        self.send({
          type: 'add point',
          data: [twoD.x, twoD.y],
          clickNumber: 3,
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
        self.send({
          type: 'add point',
          data: [twoD.x, twoD.y],
          clickNumber: 1,
        })
      }
    },
    onMove: () => {},
  })
}

export function removePointListener({ context }: ToolActionArgs) {
  // Clean up any preview circle if it exists
  segmentUtilsMap.ArcSegment.removePreviewCircle(context.sceneInfra)

  // Reset callbacks to remove the onClick and onMove listeners
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

export function sendResultToParent({
  event,
  self,
  context,
}: ToolAssignArgs<any>) {
  if (!('output' in event) || !event.output) {
    return {}
  }

  const output = event.output as {
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
    error?: string
  }

  if (output.error) {
    return {}
  }

  // Extract IDs from the scene graph for context updates
  let centerPointId: number | undefined
  let arcId: number | undefined
  let arcEndPointId: number | undefined

  if (output.sceneGraphDelta) {
    // Find the center point (first point created)
    const pointIds = output.sceneGraphDelta.new_objects.filter(
      (objId: number) => {
        const obj = output.sceneGraphDelta!.new_graph.objects[objId]
        return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Point'
      }
    )

    if (pointIds.length > 0) {
      centerPointId = pointIds[0]
    }

    // Find the arc segment
    const arcObjId = output.sceneGraphDelta.new_objects.find(
      (objId: number) => {
        const obj = output.sceneGraphDelta!.new_graph.objects[objId]
        return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Arc'
      }
    )

    if (arcObjId !== undefined) {
      arcId = arcObjId
      const arcObj = output.sceneGraphDelta.new_graph.objects[arcObjId]
      if (
        arcObj?.kind.type === 'Segment' &&
        arcObj.kind.segment.type === 'Arc'
      ) {
        // The end point ID is stored in the Arc segment
        arcEndPointId = arcObj.kind.segment.end
      }
    }
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

  return {
    centerPointId,
    arcId,
    arcEndPointId,
    sceneGraphDelta: output.sceneGraphDelta || context.sceneGraphDelta,
  }
}

/**
 * After creating the arc, extract arc id, end-point id and start point for
 * use during animation and finalization. Also sets draft entities.
 */
export function storeCreatedArcResult({
  event,
  self,
}: ToolAssignArgs<any>): Partial<ToolContext> {
  if (!('output' in event) || !event.output) {
    return {}
  }

  const output = event.output as {
    kclSource?: SourceDelta
    sceneGraphDelta?: SceneGraphDelta
    error?: string
  }
  if (output.error || !output.sceneGraphDelta) {
    return {}
  }

  // Extract arc ID and end point ID
  const arcObjId = output.sceneGraphDelta.new_objects.find((objId: number) => {
    const obj = output.sceneGraphDelta!.new_graph.objects[objId]
    return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Arc'
  })

  let arcId: number | undefined
  let arcEndPointId: number | undefined
  if (arcObjId !== undefined) {
    arcId = arcObjId
    const arcObj = output.sceneGraphDelta.new_graph.objects[arcObjId]
    if (arcObj?.kind.type === 'Segment' && arcObj.kind.segment.type === 'Arc') {
      arcEndPointId = arcObj.kind.segment.end
    }
  }

  // Extract start point from the arc ctor, if available
  let arcStartPoint: [number, number] | undefined
  if (arcObjId !== undefined) {
    const arcObj = output.sceneGraphDelta.new_graph.objects[arcObjId]
    if (
      arcObj?.kind.type === 'Segment' &&
      arcObj.kind.segment.type === 'Arc' &&
      arcObj.kind.segment.ctor &&
      arcObj.kind.segment.ctor.type === 'Arc'
    ) {
      if (
        'value' in arcObj.kind.segment.ctor.start.x &&
        'value' in arcObj.kind.segment.ctor.start.y
      ) {
        arcStartPoint = [
          arcObj.kind.segment.ctor.start.x.value,
          arcObj.kind.segment.ctor.start.y.value,
        ]
      }
    }
  }

  // Set draft entities: track the arc segment and all its points (center, start, end)
  const entitiesToTrack: {
    segmentIds: Array<number>
    constraintIds: Array<number>
  } = {
    segmentIds: [],
    constraintIds: [],
  }

  if (arcObjId !== undefined && output.sceneGraphDelta) {
    // Add the arc segment ID
    entitiesToTrack.segmentIds.push(arcObjId)

    // Find all point IDs (center, start, end)
    const pointIds = output.sceneGraphDelta.new_objects.filter(
      (objId: number) => {
        const obj = output.sceneGraphDelta!.new_graph.objects[objId]
        return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Point'
      }
    )

    // Add all point IDs to tracking
    entitiesToTrack.segmentIds.push(...pointIds)
  }

  // Send draft entities to parent for tracking
  if (entitiesToTrack.segmentIds.length > 0) {
    self._parent?.send({
      type: 'set draft entities',
      data: entitiesToTrack,
    })
  }

  return {
    arcId,
    arcEndPointId,
    arcStartPoint,
    sceneGraphDelta: output.sceneGraphDelta,
  }
}

/**
 * Actor logic for creating the initial arc segment after the second click.
 * Mirrors the previous inline fromPromise implementation.
 */
export async function createArcActor({
  input,
}: {
  input:
    | {
        centerPoint: [number, number]
        startPoint: [number, number]
        rustContext: RustContext
        kclManager: KclManager
        sketchId: number
      }
    | {
        error: string
      }
}): Promise<
  | {
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    }
  | {
      error: string
    }
> {
  if ('error' in input) {
    return { error: input.error }
  }
  const { centerPoint, startPoint, rustContext, kclManager, sketchId } = input
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )

  try {
    // Create an arc with start and end at the same position initially
    // The actual direction will be determined when the user moves the mouse
    // (ezpz always goes CCW from start to end, so we'll swap if needed)

    const segmentCtor: SegmentCtor = {
      type: 'Arc',
      center: {
        x: { type: 'Var', value: roundOff(centerPoint[0]), units },
        y: { type: 'Var', value: roundOff(centerPoint[1]), units },
      },
      start: {
        x: { type: 'Var', value: roundOff(startPoint[0]), units },
        y: { type: 'Var', value: roundOff(startPoint[1]), units },
      },
      end: {
        x: { type: 'Var', value: roundOff(startPoint[0]), units },
        y: { type: 'Var', value: roundOff(startPoint[1]), units },
      },
    }

    const result = await rustContext.addSegment(
      0,
      sketchId,
      segmentCtor,
      'arc-segment',
      await jsAppSettings(rustContext.settingsActor)
    )

    return result
  } catch (error) {
    console.error('Failed to create arc:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Actor logic for finalizing the arc on the third click.
 * Performs the same radius-normalization as the animation step.
 */
export async function finalizeArcActor({
  input,
}: {
  input:
    | {
        arcId: number
        centerPoint: [number, number]
        endPoint: [number, number]
        sceneGraphDelta: SceneGraphDelta
        rustContext: RustContext
        kclManager: KclManager
        sketchId: number
        arcIsSwapped?: boolean
      }
    | {
        error: string
      }
}): Promise<
  | {
      kclSource: SourceDelta
      sceneGraphDelta: SceneGraphDelta
    }
  | {
      error: string
    }
> {
  if ('error' in input) {
    return { error: input.error }
  }
  const {
    arcId,
    centerPoint,
    endPoint,
    sceneGraphDelta,
    rustContext,
    kclManager,
    sketchId,
    arcIsSwapped: contextIsSwapped,
  } = input
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )

  try {
    // Get the current arc to preserve the (possibly adjusted) start point
    const arcObj = sceneGraphDelta.new_graph.objects[arcId]
    let startPoint: [number, number] = centerPoint

    if (
      arcObj?.kind.type === 'Segment' &&
      arcObj.kind.segment.type === 'Arc' &&
      arcObj.kind.segment.ctor &&
      arcObj.kind.segment.ctor.type === 'Arc' &&
      'value' in arcObj.kind.segment.ctor.start.x &&
      'value' in arcObj.kind.segment.ctor.start.y
    ) {
      startPoint = [
        arcObj.kind.segment.ctor.start.x.value,
        arcObj.kind.segment.ctor.start.y.value,
      ]
    }

    // Use swapped state from context (tracked during mouseMove) if available
    // This is critical: the context value was correctly tracked during mouseMove,
    // so we should use it directly and not recalculate
    let isSwapped = contextIsSwapped ?? false

    let previousEnd: [number, number] | undefined
    if (
      arcObj?.kind.type === 'Segment' &&
      arcObj.kind.segment.type === 'Arc' &&
      arcObj.kind.segment.ctor &&
      arcObj.kind.segment.ctor.type === 'Arc'
    ) {
      // Get previous end point from the arc's current end point (normalized position from scene graph)
      if (
        'value' in arcObj.kind.segment.ctor.end.x &&
        'value' in arcObj.kind.segment.ctor.end.y
      ) {
        previousEnd = [
          arcObj.kind.segment.ctor.end.x.value,
          arcObj.kind.segment.ctor.end.y.value,
        ]
      }

      // Only check for swap if we don't have contextIsSwapped (unusual case)
      // If we have contextIsSwapped, it was already correctly tracked during mouseMove, so use it directly
      if (contextIsSwapped === undefined && previousEnd) {
        // Use the actual mouse position (endPoint) for comparison, not the normalized position
        const shouldSwap = shouldSwapStartEnd({
          isSwapped,
          center: centerPoint,
          start: startPoint,
          end: endPoint, // Use actual mouse position, not normalized
          previousEnd, // This is already normalized from scene graph
        })
        if (shouldSwap) {
          isSwapped = !isSwapped
        }
      }
    }

    // Normalize the end point to the arc's radius
    const [endX, endY] = projectPointOntoArcRadius({
      center: centerPoint,
      start: startPoint,
      end: endPoint,
    })

    // Calculate final start/end points using the swap state from context
    // If contextIsSwapped is defined, we must pass previousEnd to prevent
    // calculateArcSwapState from recalculating (it ignores currentIsSwapped when previousEnd is undefined)
    // If previousEnd is not available but contextIsSwapped is defined, we should still use the context value
    let finalStart: [number, number]
    let finalEnd: [number, number]

    if (contextIsSwapped !== undefined) {
      // Use the context value directly - it was correctly tracked during mouseMove
      // Just swap the points if needed
      if (contextIsSwapped) {
        finalStart = [endX, endY]
        finalEnd = startPoint
      } else {
        finalStart = startPoint
        finalEnd = [endX, endY]
      }
    } else {
      // Fallback: use calculateArcSwapState if contextIsSwapped is not available
      const result = calculateArcSwapState({
        center: centerPoint,
        startPoint,
        newEndPoint: [endX, endY],
        previousEnd,
        currentIsSwapped: isSwapped,
      })
      finalStart = result.finalStart
      finalEnd = result.finalEnd
    }

    const segmentCtor: SegmentCtor = {
      type: 'Arc',
      center: {
        x: { type: 'Var', value: roundOff(centerPoint[0]), units },
        y: { type: 'Var', value: roundOff(centerPoint[1]), units },
      },
      start: {
        x: { type: 'Var', value: roundOff(finalStart[0]), units },
        y: { type: 'Var', value: roundOff(finalStart[1]), units },
      },
      end: {
        x: { type: 'Var', value: roundOff(finalEnd[0]), units },
        y: { type: 'Var', value: roundOff(finalEnd[1]), units },
      },
    }

    const result = await rustContext.editSegments(
      0,
      sketchId,
      [
        {
          id: arcId,
          ctor: segmentCtor,
        },
      ],
      await jsAppSettings(rustContext.settingsActor)
    )

    return result
  } catch (error) {
    console.error('Failed to finalize arc:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
