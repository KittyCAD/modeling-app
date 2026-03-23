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
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import { showRadiusPreviewListener as centerArcShowRadiusPreviewListener } from '@src/machines/sketchSolve/tools/centerArcToolImpl'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import {
  isCircleSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'

export const TOOL_ID = 'Circle tool'
export const SHOWING_RADIUS_PREVIEW = 'Showing radius preview'
export const CREATING_CIRCLE = `xstate.done.actor.0.${TOOL_ID}.Creating circle`

export type ToolEvents =
  | BaseToolEvent
  | {
      type: 'add point'
      data: [x: number, y: number]
      clickNumber?: 1 | 2
    }
  | {
      type: typeof CREATING_CIRCLE
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }

export type ToolContext = {
  centerPointId?: number
  centerPoint?: [number, number]
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

export function showRadiusPreviewListener(args: ToolActionArgs) {
  centerArcShowRadiusPreviewListener(args as any)
}

export function addPointListener({ self, context }: ToolActionArgs) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args) return
      if (args.mouseEvent.which !== 1) return

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
  segmentUtilsMap.ArcSegment.removePreviewCircle(context.sceneInfra)
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

    return await rustContext.addSegment(
      0,
      sketchId,
      segmentCtor,
      'circle',
      jsAppSettings(rustContext.settingsActor)
    )
  } catch (error) {
    console.error('Failed to create circle:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
