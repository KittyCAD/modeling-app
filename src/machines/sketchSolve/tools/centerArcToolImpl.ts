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
      type: 'update arc ccw'
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
  arcCcw?: boolean
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
 * Determines if the ccw flag should be flipped when dragging an arc endpoint.
 * Flips when the endpoint crosses past the other endpoint (causing the arc to
 * shrink to zero and then grow in the opposite direction).
 *
 * Only flips when crossing the 0/360° boundary (e.g., 1° to 359°), not when
 * going from 179° to 181° (which is still in the same direction, just a longer arc).
 */
export function shouldFlipCcw({
  currentCcw,
  center,
  start,
  end,
}: {
  currentCcw: boolean
  center: [number, number]
  start: [number, number]
  end: [number, number]
}): boolean {
  return shouldFlipCcwWithPrevious({
    currentCcw,
    center,
    start,
    end,
    previousEnd: undefined,
  })
}

/**
 * Version that uses previous end position to detect crossing the start point.
 * This is more accurate for detecting when we cross the 0/360° boundary.
 */
/*
 * Determine if ccw should flip based on crossing the 0/360° boundary.
 * Logic:
 * 1. Compute normalized angles from center→start, center→previousEnd, center→currentEnd.
 * 2. Convert these to CCW differences from start (values in [0, 2π)).
 * 3. If the difference between prevDiff and newDiff exceeds π, we crossed the 0° boundary.
 * 4. Determine movement direction (delta > 0 ⇒ moving CCW, delta < 0 ⇒ moving CW).
 * 5. If we crossed AND movement direction disagrees with current flag, flip.
 */
/*
 * Decide whether the ccw flag must flip given the *incremental* endpoint move.
 *
 * Parameters:
 *   center       : [x,y]
 *   start        : arc start point (fixed)
 *   previousEnd  : end-point before this mouse-move (required!)
 *   end          : candidate new end-point after mouse-move
 *   currentCcw   : current direction flag
 *
 * Algorithm (all angles in [0,2π)):
 *   θS  = angle(center→start)
 *   θP  = angle(center→previousEnd)
 *   θN  = angle(center→end)
 *   ΔP  = (θP − θS) mod τ        // CCW arc-length from start to prevEnd
 *   ΔN  = (θN − θS) mod τ        // CCW arc-length from start to newEnd
 *   crossed = |ΔN − ΔP| > π      // jumped across seam?
 *   movedCCW = ((ΔN − ΔP + τ) % τ) < π   // shortest step direction
 *   flip ⇔ crossed && (movedCCW ≠ currentCcw)
 */
export function shouldFlipCcwWithPrevious({
  currentCcw,
  center,
  start,
  end,
  previousEnd,
}: {
  currentCcw: boolean
  center: [number, number]
  start: [number, number]
  end: [number, number]
  previousEnd?: [number, number]
}): boolean {
  if (!previousEnd) return false
  const τ = 2 * Math.PI
  const norm = (a: number) => ((a % τ) + τ) % τ
  const θS = norm(Math.atan2(start[1] - center[1], start[0] - center[0]))
  const θP = norm(
    Math.atan2(previousEnd[1] - center[1], previousEnd[0] - center[0])
  )
  const θN = norm(Math.atan2(end[1] - center[1], end[0] - center[0]))

  // Calculate CCW arc-lengths from start to each endpoint
  const ΔP = (θP - θS + τ) % τ
  const ΔN = (θN - θS + τ) % τ

  // Calculate the raw change in arc-length
  let rawDiff = ΔN - ΔP

  // Check if we crossed the 0/360° seam: if |rawDiff| > π, we crossed
  const crossed = Math.abs(rawDiff) > Math.PI
  if (!crossed) return false

  // Normalize the difference to [-π, π] to get the shortest path direction
  while (rawDiff > Math.PI) rawDiff -= τ
  while (rawDiff < -Math.PI) rawDiff += τ

  // If rawDiff > 0, we moved CCW; if < 0, we moved CW
  const movedCCW = rawDiff > 0

  return movedCCW !== currentCcw
}

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
  // Track current ccw in closure so it persists across mouse moves
  let currentCcw = context.arcCcw ?? true
  // Track previous end position to detect crossing
  let previousEnd: [number, number] | undefined

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
          const settings = await jsAppSettings()

          // Get the current arc to preserve start point
          const startPoint = context.arcStartPoint

          const [endX, endY] = projectPointOntoArcRadius({
            center: context.centerPoint,
            start: startPoint,
            end: [twoD.x, twoD.y],
          })

          // On the first mouse move (no previousEnd), determine initial direction based on angle
          if (previousEnd === undefined) {
            const startAngle = Math.atan2(
              startPoint[1] - context.centerPoint[1],
              startPoint[0] - context.centerPoint[0]
            )
            const endAngle = Math.atan2(
              endY - context.centerPoint[1],
              endX - context.centerPoint[0]
            )

            // Normalize angles to [0, 2π]
            let normalizedStartAngle = startAngle
            let normalizedEndAngle = endAngle
            while (normalizedStartAngle < 0) {
              normalizedStartAngle += 2 * Math.PI
            }
            while (normalizedEndAngle < 0) {
              normalizedEndAngle += 2 * Math.PI
            }

            // Calculate arc angle difference
            let arcAngle = normalizedEndAngle - normalizedStartAngle
            // If the angle is > π, go the other way (shorter path)
            if (arcAngle > Math.PI) {
              arcAngle = arcAngle - 2 * Math.PI
            } else if (arcAngle < -Math.PI) {
              arcAngle = arcAngle + 2 * Math.PI
            }
            // CCW is positive angle
            currentCcw = arcAngle > 0
          } else {
            // Check if we should flip ccw when dragging past the opposite endpoint
            const shouldFlip = shouldFlipCcwWithPrevious({
              currentCcw,
              center: context.centerPoint,
              start: startPoint,
              end: [endX, endY],
              previousEnd: previousEnd,
            })
            if (shouldFlip) {
              currentCcw = !currentCcw
            }
          }

          // Update previous end for next comparison
          previousEnd = [endX, endY]

          const ccw = currentCcw

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
                      value: roundOff(startPoint[0]),
                      units,
                    },
                    y: {
                      type: 'Var',
                      value: roundOff(startPoint[1]),
                      units,
                    },
                  },
                  end: {
                    x: { type: 'Var', value: roundOff(endX), units },
                    y: { type: 'Var', value: roundOff(endY), units },
                  },
                  ccw,
                },
              },
            ],
            settings
          )
          self._parent?.send({
            type: 'update sketch outcome',
            data: { ...result, writeToDisk: false },
          })

          // Update closure variable with the new ccw value from the result
          if (result.sceneGraphDelta) {
            const arcObj =
              result.sceneGraphDelta.new_graph.objects[context.arcId]
            if (
              arcObj?.kind.type === 'Segment' &&
              arcObj.kind.segment.type === 'Arc' &&
              arcObj.kind.segment.ctor &&
              arcObj.kind.segment.ctor.type === 'Arc' &&
              'ccw' in arcObj.kind.segment.ctor
            ) {
              currentCcw = arcObj.kind.segment.ctor.ccw
              // Update context so finalizeArcActor can use the latest ccw value
              self.send({
                type: 'update arc ccw',
                data: currentCcw,
              })
            }
          }
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
    const pointIds = output.sceneGraphDelta.new_objects.filter((objId) => {
      const obj = output.sceneGraphDelta!.new_graph.objects[objId]
      return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Point'
    })

    if (pointIds.length > 0) {
      centerPointId = pointIds[0]
    }

    // Find the arc segment
    const arcObjId = output.sceneGraphDelta.new_objects.find((objId) => {
      const obj = output.sceneGraphDelta!.new_graph.objects[objId]
      return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Arc'
    })

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
  const arcObjId = output.sceneGraphDelta.new_objects.find((objId) => {
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

  // Extract start point and ccw from the arc ctor, if available
  let arcStartPoint: [number, number] | undefined
  let arcCcw: boolean | undefined
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
      if ('ccw' in arcObj.kind.segment.ctor) {
        arcCcw = arcObj.kind.segment.ctor.ccw
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
    const pointIds = output.sceneGraphDelta.new_objects.filter((objId) => {
      const obj = output.sceneGraphDelta!.new_graph.objects[objId]
      return obj?.kind.type === 'Segment' && obj.kind.segment.type === 'Point'
    })

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
    arcCcw,
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
    // Since start and end are the same, default to CCW (true)
    // The actual direction will be determined when the user moves the mouse
    const ccw = true

    // // calculate endPoint that is 1degree CCW from the start point
    // const newAngle = Math.atan2(
    //   startPoint[1] - centerPoint[1],
    //   startPoint[0] - centerPoint[0]
    // ) + (Math.PI / 180) // 1 degree in radians
    // const endPoint = [
    //   centerPoint[0] +
    //     Math.cos(newAngle) *
    //       Math.hypot(
    //         startPoint[0] - centerPoint[0],
    //         startPoint[1] - centerPoint[1]
    //       ),
    //   centerPoint[1] +
    //     Math.sin(newAngle) *
    //       Math.hypot(
    //         startPoint[0] - centerPoint[0],
    //         startPoint[1] - centerPoint[1]
    //       ),
    // ]

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
      ccw,
    }

    const result = await rustContext.addSegment(
      0,
      sketchId,
      segmentCtor,
      'arc-segment',
      await jsAppSettings()
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
        arcCcw?: boolean
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
    arcCcw: contextCcw,
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

    // Use ccw from context (tracked during mouseMove) if available
    // If we have contextCcw, we trust it completely since it was correctly tracked during mouseMove
    // Only check for flips if we don't have contextCcw (shouldn't happen in normal flow)
    let ccw = contextCcw ?? true // default to true, but prefer context value

    let previousEnd: [number, number] | undefined
    if (
      arcObj?.kind.type === 'Segment' &&
      arcObj.kind.segment.type === 'Arc' &&
      arcObj.kind.segment.ctor &&
      arcObj.kind.segment.ctor.type === 'Arc'
    ) {
      // If we don't have contextCcw, fall back to reading from scene graph
      if (contextCcw === undefined && 'ccw' in arcObj.kind.segment.ctor) {
        ccw = arcObj.kind.segment.ctor.ccw
      }

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

      // Only check for flip if we don't have contextCcw (unusual case)
      // If we have contextCcw, it was already correctly tracked during mouseMove, so use it directly
      if (contextCcw === undefined && previousEnd) {
        // Use the actual mouse position (endPoint) for comparison, not the normalized position
        const shouldFlip = shouldFlipCcwWithPrevious({
          currentCcw: ccw,
          center: centerPoint,
          start: startPoint,
          end: endPoint, // Use actual mouse position, not normalized
          previousEnd, // This is already normalized from scene graph
        })
        if (shouldFlip) {
          ccw = !ccw
        }
      }
    }

    // Normalize the end point to the arc's radius (after determining ccw)
    const [endX, endY] = projectPointOntoArcRadius({
      center: centerPoint,
      start: startPoint,
      end: endPoint,
    })

    // If we didn't have a previous end point, calculate CCW from current points (shortest path logic)
    if (!previousEnd) {
      const startAngle = Math.atan2(
        startPoint[1] - centerPoint[1],
        startPoint[0] - centerPoint[0]
      )
      const endAngle = Math.atan2(endY - centerPoint[1], endX - centerPoint[0])

      // Normalize angles to [0, 2π]
      let normalizedStartAngle = startAngle
      let normalizedEndAngle = endAngle
      while (normalizedStartAngle < 0) {
        normalizedStartAngle += 2 * Math.PI
      }
      while (normalizedEndAngle < 0) {
        normalizedEndAngle += 2 * Math.PI
      }

      // Calculate arc angle difference
      let arcAngle = normalizedEndAngle - normalizedStartAngle
      // If the angle is > π, go the other way (shorter path)
      if (arcAngle > Math.PI) {
        arcAngle = arcAngle - 2 * Math.PI
      } else if (arcAngle < -Math.PI) {
        arcAngle = arcAngle + 2 * Math.PI
      }
      // CCW is positive angle
      ccw = arcAngle > 0
    }

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
        x: { type: 'Var', value: roundOff(endX), units },
        y: { type: 'Var', value: roundOff(endY), units },
      },
      ccw,
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
      await jsAppSettings()
    )

    return result
  } catch (error) {
    console.error('Failed to finalize arc:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
