import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type {
  SceneGraphDelta,
  SourceDelta,
  SegmentCtor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclManager } from '@src/lang/KclManager'
import type { Coords2d } from '@src/lang/util'
import { type ActionArgs, type AssignArgs, type ProvidedActor } from 'xstate'
import { roundOff } from '@src/lib/utils'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import {
  isCircleSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import {
  getCoincidentSegmentsForSnapTarget,
  type SnapTarget,
} from '@src/machines/sketchSolve/snapping'
import {
  clearToolSnappingState,
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'

export const TOOL_ID = 'Circle tool'
export const SHOWING_RADIUS_PREVIEW = 'Showing radius preview'
export const CREATING_CIRCLE = `xstate.done.actor.0.${TOOL_ID}.Creating circle`

export type ToolEvents =
  | BaseToolEvent
  | {
      type: 'add point'
      data: [x: number, y: number]
      clickNumber?: 1 | 2
      snapTarget?: SnapTarget
    }
  | {
      type: typeof CREATING_CIRCLE
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      }
    }

export type ToolContext = {
  centerPointId?: number
  centerPoint?: [number, number]
  centerSnapTarget?: SnapTarget
  circleId?: number
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

export function showRadiusPreviewListener({ self, context }: ToolActionArgs) {
  if (!context.centerPoint) return

  context.sceneInfra.setCallbacks({
    onMove: (args) => {
      if (!args || !context.centerPoint) return

      const twoD = args.intersectionPoint?.twoD
      if (!twoD) {
        clearToolSnappingState({
          self,
          sceneInfra: context.sceneInfra,
        })
        return
      }

      const dx = twoD.x - context.centerPoint[0]
      const dy = twoD.y - context.centerPoint[1]
      const radius = Math.sqrt(dx * dx + dy * dy)
      segmentUtilsMap.ArcSegment.updatePreviewCircle({
        sceneInfra: context.sceneInfra,
        center: context.centerPoint,
        radius,
      })

      const snappingCandidate = getBestSnappingCandidate({
        self,
        sceneInfra: context.sceneInfra,
        sketchId: context.sketchId,
        mousePosition: [twoD.x, twoD.y],
        mouseEvent: args.mouseEvent,
      })
      sendHoveredSnappingCandidate(self, snappingCandidate)
      updateToolSnappingPreview({
        sceneInfra: context.sceneInfra,
        target: snappingCandidate,
      })
    },
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) return

      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return

      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getBestSnappingCandidate({
        self,
        sceneInfra: context.sceneInfra,
        sketchId: context.sketchId,
        mousePosition,
        mouseEvent: args.mouseEvent,
      })
      const [x, y] = snappingCandidate?.position ?? mousePosition

      segmentUtilsMap.ArcSegment.removePreviewCircle(context.sceneInfra)
      self.send({
        type: 'add point',
        data: [x, y],
        clickNumber: 2,
        snapTarget: snappingCandidate?.target,
      })
    },
  })
}

export function addPointListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args) return
      if (args.mouseEvent.which !== 1) return

      const twoD = args.intersectionPoint?.twoD
      if (twoD) {
        const mousePosition = [twoD.x, twoD.y] as Coords2d
        const snappingCandidate = getBestSnappingCandidate({
          self,
          sceneInfra: context.sceneInfra,
          sketchId: context.sketchId,
          mousePosition,
          mouseEvent: args.mouseEvent,
        })
        const [x, y] = snappingCandidate?.position ?? mousePosition
        self.send({
          type: 'add point',
          data: [x, y],
          clickNumber: 1,
          snapTarget: snappingCandidate?.target,
        })
      }
    },
    onMove: (args) => {
      const twoD = args?.intersectionPoint?.twoD
      if (!twoD) {
        clearToolSnappingState({
          self,
          sceneInfra: context.sceneInfra,
        })
        return
      }

      const snappingCandidate = getBestSnappingCandidate({
        self,
        sceneInfra: context.sceneInfra,
        sketchId: context.sketchId,
        mousePosition: [twoD.x, twoD.y],
        mouseEvent: args.mouseEvent,
      })
      sendHoveredSnappingCandidate(self, snappingCandidate)
      updateToolSnappingPreview({
        sceneInfra: context.sceneInfra,
        target: snappingCandidate,
      })
    },
  })
}

export function removePointListener({ context, self }: ToolActionArgs) {
  segmentUtilsMap.ArcSegment.removePreviewCircle(context.sceneInfra)
  clearToolSnappingState({
    self,
    sceneInfra: context.sceneInfra,
  })
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
    checkpointId?: number | null
    error?: string
  }

  if (output.error) {
    return {}
  }

  let centerPointId: number | undefined
  let circleId: number | undefined

  if (output.sceneGraphDelta) {
    const pointIds = output.sceneGraphDelta.new_objects.filter((objId) => {
      const obj = output.sceneGraphDelta!.new_graph.objects[objId]
      return isPointSegment(obj)
    })

    if (pointIds.length > 0) {
      centerPointId = pointIds[0]
    }

    const circleObjId = output.sceneGraphDelta.new_objects.find((objId) => {
      const obj = output.sceneGraphDelta!.new_graph.objects[objId]
      return isCircleSegment(obj)
    })

    if (circleObjId !== undefined) {
      circleId = circleObjId
    }
  }

  if (output.kclSource && output.sceneGraphDelta) {
    const sendData: SketchSolveMachineEvent = {
      type: 'update sketch outcome',
      data: {
        sourceDelta: output.kclSource,
        sceneGraphDelta: output.sceneGraphDelta,
        checkpointId: output.checkpointId ?? null,
      },
    }
    self._parent?.send(sendData)
  }

  return {
    centerPointId,
    circleId,
    sceneGraphDelta: output.sceneGraphDelta || context.sceneGraphDelta,
  }
}

export async function createCircleActor({
  input,
}: {
  input:
    | {
        centerPoint: [number, number]
        startPoint: [number, number]
        centerSnapTarget?: SnapTarget
        startSnapTarget?: SnapTarget
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
      checkpointId?: number | null
    }
  | {
      error: string
    }
> {
  if ('error' in input) {
    return { error: input.error }
  }

  const {
    centerPoint,
    startPoint,
    centerSnapTarget,
    startSnapTarget,
    rustContext,
    kclManager,
    sketchId,
  } = input
  const units = baseUnitToNumericSuffix(
    kclManager.fileSettings.defaultLengthUnit
  )

  try {
    const segmentCtor: SegmentCtor = {
      type: 'Circle',
      center: {
        x: { type: 'Var', value: roundOff(centerPoint[0]), units },
        y: { type: 'Var', value: roundOff(centerPoint[1]), units },
      },
      start: {
        x: { type: 'Var', value: roundOff(startPoint[0]), units },
        y: { type: 'Var', value: roundOff(startPoint[1]), units },
      },
    }

    const settings = jsAppSettings(rustContext.settingsActor)
    const result = await rustContext.addSegment(
      0,
      sketchId,
      segmentCtor,
      'circle',
      settings,
      true
    )

    const circleObjId = result.sceneGraphDelta.new_objects.find((objId) => {
      const obj = result.sceneGraphDelta.new_graph.objects[objId]
      return isCircleSegment(obj)
    })
    if (circleObjId === undefined) {
      return result
    }

    const circleObj = result.sceneGraphDelta.new_graph.objects[circleObjId]
    if (!isCircleSegment(circleObj)) {
      return result
    }

    const snapTargets = [
      {
        segmentId: circleObj.kind.segment.center,
        snapTarget: centerSnapTarget,
      },
      {
        segmentId: circleObj.kind.segment.start,
        snapTarget: startSnapTarget,
      },
    ]

    let latestKclSource = result.kclSource
    let latestSceneGraphDelta = result.sceneGraphDelta
    let latestCheckpointId = result.checkpointId ?? null
    const snapConstraintNewObjects: number[] = []

    for (const { segmentId, snapTarget } of snapTargets) {
      const coincidentSegments = getCoincidentSegmentsForSnapTarget(
        segmentId,
        snapTarget
      )
      if (coincidentSegments === null) {
        continue
      }

      const snapResult = await rustContext.addConstraint(
        0,
        sketchId,
        {
          type: 'Coincident',
          segments: coincidentSegments,
        },
        settings,
        true
      )
      latestKclSource = snapResult.kclSource
      latestSceneGraphDelta = snapResult.sceneGraphDelta
      latestCheckpointId = snapResult.checkpointId ?? latestCheckpointId
      snapConstraintNewObjects.push(...snapResult.sceneGraphDelta.new_objects)
    }

    if (snapConstraintNewObjects.length === 0) {
      return result
    }

    return {
      kclSource: latestKclSource,
      sceneGraphDelta: {
        ...latestSceneGraphDelta,
        new_objects: [
          ...result.sceneGraphDelta.new_objects,
          ...snapConstraintNewObjects,
        ],
      },
      checkpointId: latestCheckpointId,
    }
  } catch (error) {
    console.error('Failed to create circle:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
