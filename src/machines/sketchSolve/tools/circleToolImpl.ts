import type {
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type { Coords2d } from '@src/lang/util'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import {
  isCircleSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import type { SketchSolveMachineEvent } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  type SnapTarget,
  applyConstraintsForSnapTarget,
} from '@src/machines/sketchSolve/snapping'
import { toastSketchSolveError } from '@src/machines/sketchSolve/sketchSolveErrors'
import { MIN_DRAFT_GEOMETRY_DELTA_MM } from '@src/machines/sketchSolve/tools/draftGeometryPolicy'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import {
  clearToolSnappingState,
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'
import { resolveSketchPoint } from '@src/machines/sketchSolve/tools/sketchCoordinates'
import { type ActionArgs, type AssignArgs, type ProvidedActor } from 'xstate'

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

export interface CirclePreview {
  active: boolean
  pending: Promise<void>
  circleId: number
  segmentIds: number[]
}

export type ToolContext = {
  preview?: CirclePreview
  unequipRequested?: boolean
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
  const centerPoint = context.centerPoint
  if (!centerPoint) return

  const preview = context.preview
  if (!preview) return
  preview.active = true
  let nextPoint: Coords2d | undefined
  let updating = false
  const updatePreview = async () => {
    updating = true
    try {
      while (nextPoint && preview.active) {
        const point = nextPoint
        nextPoint = undefined
        const result = await updateDraftCircle({
          centerPoint,
          startPoint: point,
          rustContext: context.rustContext,
          kclManager: context.kclManager,
          sketchId: context.sketchId,
          circleId: preview.circleId,
        })
        if (preview.active)
          self._parent?.send({
            type: 'update sketch outcome',
            data: {
              sourceDelta: result.kclSource,
              sceneGraphDelta: result.sceneGraphDelta,
              writeToDisk: false,
            },
          })
      }
    } catch (error) {
      toastSketchSolveError(error)
    } finally {
      updating = false
    }
  }
  context.sceneInfra.setCallbacks({
    onMove: (args) => {
      if (!args || !context.centerPoint || !preview.active) return

      const twoD = args.intersectionPoint?.twoD
      if (!twoD) {
        clearToolSnappingState({
          self,
          sceneInfra: context.sceneInfra,
        })
        return
      }

      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getBestSnappingCandidate({
        self,
        sceneInfra: context.sceneInfra,
        sketchId: context.sketchId,
        mousePosition,
        mouseEvent: args.mouseEvent,
        excludedPointIds: new Set(preview.segmentIds),
      })
      const [x, y] = resolveSketchPoint(mousePosition, snappingCandidate)
      const dx = x - context.centerPoint[0]
      const dy = y - context.centerPoint[1]
      const radius = Math.sqrt(dx * dx + dy * dy)
      if (radius > 0) {
        nextPoint = [x, y]
        if (!updating) preview.pending = updatePreview()
      }
      segmentUtilsMap.ArcSegment.updatePreviewCircle({
        sceneInfra: context.sceneInfra,
        center: context.centerPoint,
        radius,
      })

      sendHoveredSnappingCandidate(self, snappingCandidate)
      updateToolSnappingPreview({
        sceneInfra: context.sceneInfra,
        target: snappingCandidate,
      })
    },
    onClick: async (args) => {
      if (!args || args.mouseEvent.which !== 1 || !preview.active) return

      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return

      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getBestSnappingCandidate({
        self,
        sceneInfra: context.sceneInfra,
        sketchId: context.sketchId,
        mousePosition,
        mouseEvent: args.mouseEvent,
        excludedPointIds: new Set(preview.segmentIds),
      })
      const [x, y] = resolveSketchPoint(mousePosition, snappingCandidate)

      // Finish the in-flight preview before committing the exact clicked radius.
      preview.active = false
      await preview.pending
      if (self.getSnapshot().status !== 'active') return
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
        const [x, y] = resolveSketchPoint(mousePosition, snappingCandidate)
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
  if (context.preview) context.preview.active = false
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

type CircleGeometryInput = {
  centerPoint: Coords2d
  startPoint: Coords2d
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
}

type CircleResult = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  checkpointId?: number | null
}

type DraftCircleInput = Omit<CircleGeometryInput, 'startPoint'> & {
  centerSnapTarget?: SnapTarget
}

type CircleUpdateInput = CircleGeometryInput & { circleId: number }

function circleSegment(input: CircleGeometryInput): SegmentCtor {
  const units = baseUnitToNumericSuffix(
    input.kclManager.fileSettings.defaultLengthUnit
  )
  return {
    type: 'Circle',
    center: {
      x: { type: 'Var', value: input.centerPoint[0], units },
      y: { type: 'Var', value: input.centerPoint[1], units },
    },
    start: {
      x: { type: 'Var', value: input.startPoint[0], units },
      y: { type: 'Var', value: input.startPoint[1], units },
    },
  }
}

export async function createDraftCircle({
  input,
}: {
  input: DraftCircleInput | { error: string }
}) {
  if ('error' in input) return input
  const result = await createOrUpdateCircle({
    ...input,
    startPoint: [
      input.centerPoint[0] + MIN_DRAFT_GEOMETRY_DELTA_MM,
      input.centerPoint[1],
    ],
    createCheckpoint: false,
  })
  if ('error' in result) return result
  const circleId = result.sceneGraphDelta.new_objects.find((id) =>
    isCircleSegment(result.sceneGraphDelta.new_graph.objects[id])
  )
  if (circleId === undefined)
    return { error: 'The draft circle was not created.' }
  return {
    ...result,
    draft: {
      circleId,
      segmentIds: result.sceneGraphDelta.new_objects.filter(
        (id) =>
          result.sceneGraphDelta.new_graph.objects[id]?.kind.type === 'Segment'
      ),
      constraintIds: result.sceneGraphDelta.new_objects.filter(
        (id) =>
          result.sceneGraphDelta.new_graph.objects[id]?.kind.type ===
          'Constraint'
      ),
    },
  }
}

export function updateDraftCircle(
  input: CircleUpdateInput
): Promise<CircleResult> {
  return input.rustContext.editSegments(
    0,
    input.sketchId,
    [{ id: input.circleId, ctor: circleSegment(input) }],
    jsAppSettings(input.rustContext.settingsActor),
    false
  )
}

export function commitCircle({
  input,
}: {
  input:
    | (CircleUpdateInput & { startSnapTarget?: SnapTarget })
    | { error: string }
}) {
  return createOrUpdateCircle(input)
}

async function createOrUpdateCircle(
  input:
    | (CircleGeometryInput & {
        circleId?: number
        createCheckpoint?: boolean
        centerSnapTarget?: SnapTarget
        startSnapTarget?: SnapTarget
      })
    | { error: string }
): Promise<CircleResult | { error: string }> {
  if ('error' in input) {
    return { error: input.error }
  }

  const {
    circleId,
    createCheckpoint = true,
    centerSnapTarget,
    startSnapTarget,
    rustContext,
    sketchId,
  } = input
  try {
    const segmentCtor = circleSegment(input)

    const settings = jsAppSettings(rustContext.settingsActor)
    if (circleId === undefined) await rustContext.prepareForSketchInsertion()
    const result =
      circleId === undefined
        ? await rustContext.addSegment(
            0,
            sketchId,
            segmentCtor,
            'circle',
            settings,
            createCheckpoint
          )
        : await rustContext.editSegments(
            0,
            sketchId,
            [{ id: circleId, ctor: segmentCtor }],
            settings,
            createCheckpoint
          )

    const circleObjId =
      circleId ??
      result.sceneGraphDelta.new_objects.find((objId) => {
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
      const snapResult = await applyConstraintsForSnapTarget({
        segmentId,
        target: snapTarget,
        rustContext,
        sketchId,
        settings,
        createCheckpoint,
      })
      if (snapResult.result === null) {
        continue
      }

      latestKclSource = snapResult.result.kclSource
      latestSceneGraphDelta = snapResult.result.sceneGraphDelta
      latestCheckpointId = snapResult.result.checkpointId ?? latestCheckpointId
      snapConstraintNewObjects.push(...snapResult.newObjectIds)
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
