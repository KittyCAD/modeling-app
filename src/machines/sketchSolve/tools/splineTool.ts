import { assertEvent, assign, fromPromise, setup } from 'xstate'

import type {
  ApiObject,
  SceneGraphDelta,
  SegmentCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import type { KclManager } from '@src/lang/KclManager'
import type { Coords2d } from '@src/lang/util'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
import {
  getConstraintForSnapTarget,
  type SnapTarget,
} from '@src/machines/sketchSolve/snapping'
import {
  getControlPointSplinePoints,
  isControlPointSplineSegment,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { getCurrentSketchObjectsById } from '@src/machines/sketchSolve/sceneGraphUtils'
import {
  isSketchSolveErrorOutput,
  toastSketchSolveError,
} from '@src/machines/sketchSolve/sketchSolveErrors'
import type {
  SketchSolveMachineEvent,
  ToolInput,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import {
  clearToolSnappingState,
  getBestSnappingCandidate,
  sendHoveredSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'
import { Group } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

const TOOL_ID = 'Spline tool'
const MIN_CONTROL_POINTS = 3

type ToolDoneOutput = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  checkpointId?: number | null
  splineId?: number
  draftPointId?: number
  newlyAddedEntities?: {
    segmentIds: number[]
    constraintIds: number[]
  }
}

type ErrorOutput = {
  error: string
}

type ToolEvents =
  | BaseToolEvent
  | {
      type: 'add point'
      data: Coords2d
      clickNumber: 1 | 2 | 3
      snapTarget?: SnapTarget
    }
  | { type: 'start initial spline'; data: Coords2d }
  | { type: 'start next draft point'; data: Coords2d }
  | {
      type:
        | `xstate.done.actor.0.${typeof TOOL_ID}.Creating initial spline`
        | `xstate.done.actor.0.${typeof TOOL_ID}.Finalizing draft point`
        | `xstate.done.actor.0.${typeof TOOL_ID}.Appending draft point`
        | `xstate.done.actor.0.${typeof TOOL_ID}.Cancelling draft point`
      output: ToolDoneOutput | ErrorOutput
    }

type ToolContext = {
  firstPoint?: Coords2d
  firstSnapTarget?: SnapTarget
  secondPoint?: Coords2d
  secondSnapTarget?: SnapTarget
  splineId?: number
  draftPointId?: number
  committedControlCount: number
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  cancelTarget: 'ready' | 'unequip'
}

const SPLINE_TOOL_PREVIEW = 'spline-tool-preview'

function getSketchSolveGroup(sceneInfra: SceneInfra): Group | null {
  const group = sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
  return group instanceof Group ? group : null
}

function removePreviewLine(line: Line2 | null, sceneInfra: SceneInfra) {
  const previewLine = line ?? getPreviewLine(sceneInfra)
  if (!previewLine) return
  const group = getSketchSolveGroup(sceneInfra)
  if (group && group.children.includes(previewLine)) {
    group.remove(previewLine)
  } else if (previewLine.parent) {
    previewLine.parent.remove(previewLine)
  }
  previewLine.geometry.dispose()
  previewLine.material.dispose()
}

function getPreviewLine(sceneInfra: SceneInfra): Line2 | null {
  const group = getSketchSolveGroup(sceneInfra)
  const previewObject = group?.getObjectByName(SPLINE_TOOL_PREVIEW)
  return previewObject instanceof Line2 ? previewObject : null
}

function upsertPreviewLine({
  sceneInfra,
  from,
  to,
  existingLine,
}: {
  sceneInfra: SceneInfra
  from: Coords2d
  to: Coords2d
  existingLine: Line2 | null
}): Line2 {
  const positions = [from[0], from[1], 0, to[0], to[1], 0]
  if (existingLine) {
    const nextGeometry = new LineGeometry()
    nextGeometry.setPositions(positions)
    const oldGeometry = existingLine.geometry
    existingLine.geometry = nextGeometry
    oldGeometry.dispose()
    return existingLine
  }

  const geometry = new LineGeometry()
  geometry.setPositions(positions)
  const line = new Line2(
    geometry,
    new LineMaterial({
      color: 0xa0a0a0,
      linewidth: 2 * (window.devicePixelRatio || 1),
    })
  )
  line.name = SPLINE_TOOL_PREVIEW

  const group = getSketchSolveGroup(sceneInfra)
  if (group) {
    group.add(line)
  } else {
    sceneInfra.scene.add(line)
  }

  return line
}

function toPointExpr(point: Coords2d, units: string) {
  return {
    x: {
      type: 'Var' as const,
      value: roundOff(point[0]),
      units,
    },
    y: {
      type: 'Var' as const,
      value: roundOff(point[1]),
      units,
    },
  }
}

function filterSegmentIds(sceneGraphDelta: SceneGraphDelta): number[] {
  return sceneGraphDelta.new_objects.filter((objId) => {
    const obj = sceneGraphDelta.new_graph.objects[objId]
    return obj?.kind.type === 'Segment'
  })
}

function filterConstraintIds(sceneGraphDelta: SceneGraphDelta): number[] {
  return sceneGraphDelta.new_objects.filter((objId) => {
    const obj = sceneGraphDelta.new_graph.objects[objId]
    return obj?.kind.type === 'Constraint'
  })
}

function mergeMutationResults(
  base: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    checkpointId?: number | null
  },
  next: {
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    checkpointId?: number | null
  }
) {
  return {
    kclSource: next.kclSource,
    sceneGraphDelta: {
      ...next.sceneGraphDelta,
      new_objects: [
        ...base.sceneGraphDelta.new_objects,
        ...next.sceneGraphDelta.new_objects,
      ],
    },
    checkpointId: next.checkpointId ?? base.checkpointId ?? null,
  }
}

function getCurrentSketchObjects(
  self: {
    _parent?: {
      getSnapshot?: () => {
        context?: {
          sketchExecOutcome?: {
            sceneGraphDelta?: {
              new_graph?: {
                objects?: ApiObject[]
              }
            }
          }
        }
      }
    }
  },
  sketchId: number
): ApiObject[] {
  const objects =
    self._parent?.getSnapshot?.()?.context?.sketchExecOutcome?.sceneGraphDelta
      ?.new_graph?.objects ?? []
  return getCurrentSketchObjectsById(objects, sketchId)
}

function getCurrentSplineState({
  self,
  sketchId,
  splineId,
}: {
  self: {
    _parent?: {
      getSnapshot?: () => {
        context?: {
          sketchExecOutcome?: {
            sceneGraphDelta?: {
              new_graph?: {
                objects?: ApiObject[]
              }
            }
          }
        }
      }
    }
  }
  sketchId: number
  splineId: number
}) {
  const objects = getCurrentSketchObjects(self, sketchId)
  const splineObj = objects[splineId]
  if (!isControlPointSplineSegment(splineObj)) {
    return null
  }
  const points = getControlPointSplinePoints(splineObj, objects)
  if (!points) {
    return null
  }
  return {
    objects,
    splineObj,
    points,
  }
}

function pointsRoughlyEqual(a: Coords2d, b: Coords2d, epsilon = 1e-6): boolean {
  return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon
}

function pointDistance(a: Coords2d, b: Coords2d): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function getControlPointSplineMatchScore(
  candidatePoints: Coords2d[],
  expectedPoints: Coords2d[]
): number {
  if (candidatePoints.length !== expectedPoints.length) {
    return Number.POSITIVE_INFINITY
  }

  let totalDistance = 0
  for (let index = 0; index < candidatePoints.length; index++) {
    totalDistance += pointDistance(
      candidatePoints[index],
      expectedPoints[index]
    )
  }
  return totalDistance
}

function findControlPointSplineByPoints({
  sceneGraphDelta,
  sketchId,
  expectedPoints,
  previousSplineId,
}: {
  sceneGraphDelta: SceneGraphDelta
  sketchId: number
  expectedPoints: Coords2d[]
  previousSplineId?: number
}) {
  const objects = getCurrentSketchObjectsById(
    sceneGraphDelta.new_graph.objects,
    sketchId
  )
  const preferredIds = new Set(sceneGraphDelta.new_objects.map(Number))
  if (previousSplineId !== undefined) {
    preferredIds.add(previousSplineId)
  }

  const candidates = objects
    .filter(isControlPointSplineSegment)
    .map((candidate) => {
      const candidatePoints = getControlPointSplinePoints(candidate, objects)
      if (!candidatePoints) {
        return null
      }
      return {
        candidate,
        candidatePoints,
        score: getControlPointSplineMatchScore(candidatePoints, expectedPoints),
        preferred:
          preferredIds.has(candidate.id) ||
          candidate.kind.segment.controls.some((id) => preferredIds.has(id)),
      }
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => {
      return candidate !== null && Number.isFinite(candidate.score)
    })

  candidates.sort((a, b) => {
    if (a.preferred !== b.preferred) {
      return a.preferred ? -1 : 1
    }
    return a.score - b.score
  })

  const bestCandidate = candidates[0]
  if (!bestCandidate) {
    return null
  }

  if (
    bestCandidate.candidatePoints.every((point, index) =>
      pointsRoughlyEqual(point, expectedPoints[index])
    )
  ) {
    return bestCandidate.candidate
  }

  return bestCandidate.candidate
}

function getSplineExcludedPointIds({
  self,
  sketchId,
  splineId,
}: {
  self: Parameters<typeof getBestSnappingCandidate>[0]['self']
  sketchId: number
  splineId?: number
}) {
  if (splineId === undefined) {
    return []
  }
  const state = getCurrentSplineState({ self, sketchId, splineId })
  return state?.splineObj.kind.segment.controls ?? []
}

function sendSketchOutcomeToParent({
  self,
  output,
  writeToDisk = true,
}: {
  self: {
    _parent?: {
      send?: (event: SketchSolveMachineEvent) => void
    }
  }
  output?: ToolDoneOutput | ErrorOutput
  writeToDisk?: boolean
}) {
  if (!output || 'error' in output) {
    return
  }
  self._parent?.send?.({
    type: 'update sketch outcome',
    data: {
      sourceDelta: output.kclSource,
      sceneGraphDelta: output.sceneGraphDelta,
      checkpointId: output.checkpointId ?? null,
      writeToDisk,
    },
  })
}

function sendDraftEntitiesToParent({
  self,
  output,
}: {
  self: {
    _parent?: {
      send?: (event: SketchSolveMachineEvent) => void
    }
  }
  output?: ToolDoneOutput | ErrorOutput
}) {
  if (!output || 'error' in output || !output.newlyAddedEntities) {
    return
  }
  self._parent?.send?.({
    type: 'set draft entities',
    data: output.newlyAddedEntities,
  })
}

function collectSplineDraftEntities({
  sceneGraphDelta,
  splineId,
}: {
  sceneGraphDelta: SceneGraphDelta
  splineId: number
}) {
  const segmentIds: number[] = []
  for (const obj of sceneGraphDelta.new_graph.objects) {
    if (!obj || obj.kind.type !== 'Segment') continue
    if (obj.id === splineId) {
      segmentIds.push(obj.id)
      continue
    }
    if (isPointSegment(obj) && obj.kind.segment.owner === splineId) {
      segmentIds.push(obj.id)
      continue
    }
    if (isLineSegment(obj) && obj.kind.segment.owner === splineId) {
      segmentIds.push(obj.id)
    }
  }
  return {
    segmentIds,
    constraintIds: [] as number[],
  }
}

function sendSplineDraftEntitiesToParent({
  self,
  sceneGraphDelta,
  splineId,
}: {
  self: {
    _parent?: {
      send?: (event: SketchSolveMachineEvent) => void
    }
  }
  sceneGraphDelta: SceneGraphDelta
  splineId?: number
}) {
  if (splineId === undefined) return
  self._parent?.send?.({
    type: 'set draft entities',
    data: collectSplineDraftEntities({ sceneGraphDelta, splineId }),
  })
}

function clearDraftEntitiesInParent(self: {
  _parent?: {
    send?: (event: SketchSolveMachineEvent) => void
  }
}) {
  self._parent?.send?.({
    type: 'clear draft entities',
  })
}

function getListenerSnappingCandidate({
  self,
  context,
  mousePosition,
  mouseEvent,
  excludedPointIds = [],
}: {
  self: Parameters<typeof getBestSnappingCandidate>[0]['self']
  context: ToolContext
  mousePosition: Coords2d
  mouseEvent: MouseEvent
  excludedPointIds?: Iterable<number>
}) {
  return getBestSnappingCandidate({
    self,
    sceneInfra: context.sceneInfra,
    sketchId: context.sketchId,
    mousePosition,
    mouseEvent,
    excludedPointIds,
  })
}

function addFirstPointListener({
  self,
  context,
}: { self: any; context: ToolContext }) {
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1) return
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return
      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getListenerSnappingCandidate({
        self,
        context,
        mousePosition,
        mouseEvent: args.mouseEvent,
      })
      self.send({
        type: 'add point',
        data: snappingCandidate?.position ?? mousePosition,
        clickNumber: 1,
        snapTarget: snappingCandidate?.target,
      })
    },
    onMove: (args) => {
      const twoD = args?.intersectionPoint?.twoD
      if (!twoD) {
        clearToolSnappingState({ self, sceneInfra: context.sceneInfra })
        return
      }
      const snappingCandidate = getListenerSnappingCandidate({
        self,
        context,
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

function addSecondPointListener({
  self,
  context,
}: { self: any; context: ToolContext }) {
  let previewLine = getPreviewLine(context.sceneInfra)
  context.sceneInfra.setCallbacks({
    onClick: (args) => {
      if (!args || args.mouseEvent.which !== 1 || !context.firstPoint) return
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return
      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getListenerSnappingCandidate({
        self,
        context,
        mousePosition,
        mouseEvent: args.mouseEvent,
      })
      self.send({
        type: 'add point',
        data: snappingCandidate?.position ?? mousePosition,
        clickNumber: 2,
        snapTarget: snappingCandidate?.target,
      })
    },
    onMove: (args) => {
      if (!context.firstPoint) return
      const twoD = args?.intersectionPoint?.twoD
      if (!twoD) {
        clearToolSnappingState({ self, sceneInfra: context.sceneInfra })
        return
      }
      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getListenerSnappingCandidate({
        self,
        context,
        mousePosition,
        mouseEvent: args.mouseEvent,
      })
      const previewPoint = snappingCandidate?.position ?? mousePosition
      sendHoveredSnappingCandidate(self, snappingCandidate)
      updateToolSnappingPreview({
        sceneInfra: context.sceneInfra,
        target: snappingCandidate,
      })
      const line = upsertPreviewLine({
        sceneInfra: context.sceneInfra,
        from: context.firstPoint,
        to: previewPoint,
        existingLine: previewLine,
      })
      previewLine = line
    },
  })
}

function addInitialSplineMoveListener({
  self,
  context,
}: {
  self: any
  context: ToolContext
}) {
  let hasStarted = false
  context.sceneInfra.setCallbacks({
    onMove: (args) => {
      if (hasStarted || !context.firstPoint || !context.secondPoint) return
      const twoD = args?.intersectionPoint?.twoD
      if (!twoD) return
      hasStarted = true
      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getListenerSnappingCandidate({
        self,
        context,
        mousePosition,
        mouseEvent: args.mouseEvent,
      })
      self.send({
        type: 'start initial spline',
        data: snappingCandidate?.position ?? mousePosition,
      })
    },
    onClick: () => {},
  })
}

function addAppendMoveListener({
  self,
  context,
}: { self: any; context: ToolContext }) {
  let hasStarted = false
  context.sceneInfra.setCallbacks({
    onMove: (args) => {
      if (hasStarted || context.splineId === undefined) return
      const twoD = args?.intersectionPoint?.twoD
      if (!twoD) return
      hasStarted = true
      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getListenerSnappingCandidate({
        self,
        context,
        mousePosition,
        mouseEvent: args.mouseEvent,
        excludedPointIds: getSplineExcludedPointIds({
          self,
          sketchId: context.sketchId,
          splineId: context.splineId,
        }),
      })
      self.send({
        type: 'start next draft point',
        data: snappingCandidate?.position ?? mousePosition,
      })
    },
    onClick: () => {},
  })
}

function animateDraftPointListener({
  self,
  context,
}: {
  self: any
  context: ToolContext
}) {
  let isEditInProgress = false
  context.sceneInfra.setCallbacks({
    onMove: async (args) => {
      if (!args || context.draftPointId === undefined || isEditInProgress) {
        return
      }
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) {
        clearToolSnappingState({ self, sceneInfra: context.sceneInfra })
        return
      }
      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getListenerSnappingCandidate({
        self,
        context,
        mousePosition,
        mouseEvent: args.mouseEvent,
        excludedPointIds: getSplineExcludedPointIds({
          self,
          sketchId: context.sketchId,
          splineId: context.splineId,
        }),
      })
      sendHoveredSnappingCandidate(self, snappingCandidate)
      updateToolSnappingPreview({
        sceneInfra: context.sceneInfra,
        target: snappingCandidate,
      })

      const [x, y] = snappingCandidate?.position ?? mousePosition
      const units = baseUnitToNumericSuffix(
        context.kclManager.fileSettings.defaultLengthUnit
      )

      try {
        isEditInProgress = true
        const settings = jsAppSettings(context.rustContext.settingsActor)
        const result = await context.rustContext.editSegments(
          0,
          context.sketchId,
          [
            {
              id: context.draftPointId,
              ctor: {
                type: 'Point',
                position: {
                  x: { type: 'Var', value: roundOff(x), units },
                  y: { type: 'Var', value: roundOff(y), units },
                },
              },
            },
          ],
          settings
        )
        sendSketchOutcomeToParent({
          self,
          output: result,
          writeToDisk: false,
        })
      } catch (error) {
        console.error('Failed to animate spline draft point:', error)
        toastSketchSolveError(error)
      } finally {
        isEditInProgress = false
      }
    },
    onClick: (args) => {
      if (
        !args ||
        args.mouseEvent.which !== 1 ||
        context.draftPointId === undefined
      ) {
        return
      }
      const twoD = args.intersectionPoint?.twoD
      if (!twoD) return
      const mousePosition = [twoD.x, twoD.y] as Coords2d
      const snappingCandidate = getListenerSnappingCandidate({
        self,
        context,
        mousePosition,
        mouseEvent: args.mouseEvent,
        excludedPointIds: getSplineExcludedPointIds({
          self,
          sketchId: context.sketchId,
          splineId: context.splineId,
        }),
      })
      self.send({
        type: 'add point',
        data: snappingCandidate?.position ?? mousePosition,
        clickNumber: 3,
        snapTarget: snappingCandidate?.target,
      })
    },
  })
}

function removeToolListeners({
  self,
  context,
}: {
  self: any
  context: ToolContext
}) {
  clearToolSnappingState({ self, sceneInfra: context.sceneInfra })
  context.sceneInfra.setCallbacks({
    onClick: () => {},
    onMove: () => {},
  })
}

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as ToolInput,
  },
  guards: {
    'invoke output has error': ({ event }) =>
      'output' in event && isSketchSolveErrorOutput(event.output),
    'has real spline': ({ context }) => context.splineId !== undefined,
    'has committed spline': ({ context }) =>
      context.committedControlCount >= MIN_CONTROL_POINTS,
    'has draft point': ({ context }) => context.draftPointId !== undefined,
  },
  actions: {
    'add first point listener': addFirstPointListener,
    'add second point listener': addSecondPointListener,
    'add initial spline move listener': addInitialSplineMoveListener,
    'add append move listener': addAppendMoveListener,
    'animate draft point listener': animateDraftPointListener,
    'remove tool listeners': removeToolListeners,
    'send result to parent': ({ event, self }) => {
      if (!('output' in event)) return
      sendSketchOutcomeToParent({ self, output: event.output })
    },
    'set draft entities': ({ event, self }) => {
      if (!('output' in event)) return
      if (
        event.output &&
        !('error' in event.output) &&
        event.output.sceneGraphDelta
      ) {
        sendSplineDraftEntitiesToParent({
          self,
          sceneGraphDelta: event.output.sceneGraphDelta,
          splineId: event.output.splineId,
        })
        return
      }
      sendDraftEntitiesToParent({ self, output: event.output })
    },
    'refresh spline draft entities': ({ event, self, context }) => {
      if (!('output' in event) || !event.output || 'error' in event.output)
        return
      sendSplineDraftEntitiesToParent({
        self,
        sceneGraphDelta: event.output.sceneGraphDelta,
        splineId: event.output.splineId ?? context.splineId,
      })
    },
    'clear draft entities': ({ self }) => {
      clearDraftEntitiesInParent(self)
    },
    'store first point': assign(({ event }) => {
      assertEvent(event, 'add point')
      return {
        firstPoint: event.data,
        firstSnapTarget: event.snapTarget,
      }
    }),
    'store second point': assign(({ event }) => {
      assertEvent(event, 'add point')
      return {
        secondPoint: event.data,
        secondSnapTarget: event.snapTarget,
      }
    }),
    'store created spline': assign(({ event, context }) => {
      if (!('output' in event) || !event.output || 'error' in event.output) {
        return {}
      }
      removePreviewLine(null, context.sceneInfra)
      return {
        splineId: event.output.splineId,
        draftPointId: event.output.draftPointId,
        committedControlCount: 2,
      }
    }),
    'store finalized draft point': assign(({ context }) => ({
      committedControlCount: context.committedControlCount + 1,
      draftPointId: undefined,
    })),
    'store appended draft point': assign(({ event }) => {
      if (!('output' in event) || !event.output || 'error' in event.output) {
        return {}
      }
      return {
        splineId: event.output.splineId,
        draftPointId: event.output.draftPointId,
      }
    }),
    'clear preview line': assign(({ context }) => {
      removePreviewLine(null, context.sceneInfra)
      return {}
    }),
    'clear draft point state': assign({
      draftPointId: undefined,
    }),
    'clear staged points': assign({
      firstPoint: undefined,
      firstSnapTarget: undefined,
      secondPoint: undefined,
      secondSnapTarget: undefined,
    }),
    'clear spline state': assign({
      splineId: undefined,
      draftPointId: undefined,
      committedControlCount: 0,
    }),
    'set cancel target ready': assign({
      cancelTarget: 'ready',
    }),
    'set cancel target unequip': assign({
      cancelTarget: 'unequip',
    }),
    'toast sketch solve error': ({ event }) => {
      toastSketchSolveError(event)
    },
  },
  actors: {
    createInitialSpline: fromPromise(
      async ({
        input,
      }: {
        input: {
          points: [Coords2d, Coords2d, Coords2d]
          snapTargets: [SnapTarget | undefined, SnapTarget | undefined]
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
        }
      }): Promise<ToolDoneOutput | ErrorOutput> => {
        const { points, snapTargets, rustContext, kclManager, sketchId } = input
        const settings = jsAppSettings(rustContext.settingsActor)
        const units = baseUnitToNumericSuffix(
          kclManager.fileSettings.defaultLengthUnit
        )

        try {
          let result = await rustContext.addSegment(
            0,
            sketchId,
            {
              type: 'ControlPointSpline',
              points: points.map((point) => toPointExpr(point, units)) as any,
              construction: false,
            },
            'control-point-spline',
            settings
          )

          const objects = result.sceneGraphDelta.new_graph.objects
          const splineId = result.sceneGraphDelta.new_objects.find((objId) =>
            isControlPointSplineSegment(objects[objId])
          )
          if (splineId === undefined) {
            return { error: 'Failed to create control point spline.' }
          }

          const splineObj = objects[splineId]
          if (!isControlPointSplineSegment(splineObj)) {
            return { error: 'Failed to locate created control point spline.' }
          }

          const constraintIds: number[] = []
          for (const [index, snapTarget] of snapTargets.entries()) {
            const pointId = splineObj.kind.segment.controls[index]
            if (snapTarget === undefined || pointId === undefined) continue
            const constraint = getConstraintForSnapTarget(
              pointId,
              snapTarget,
              units
            )
            if (constraint === null) continue
            const snapResult = await rustContext.addConstraint(
              0,
              sketchId,
              constraint,
              settings
            )
            constraintIds.push(
              ...filterConstraintIds(snapResult.sceneGraphDelta)
            )
            result = mergeMutationResults(result, snapResult)
          }

          const mergedObjects = result.sceneGraphDelta.new_graph.objects
          const mergedSpline = mergedObjects[splineId]
          if (!isControlPointSplineSegment(mergedSpline)) {
            return { error: 'Failed to find updated control point spline.' }
          }

          const draftPointId =
            mergedSpline.kind.segment.controls[
              mergedSpline.kind.segment.controls.length - 1
            ]
          if (draftPointId === undefined) {
            return { error: 'Failed to find draft spline control point.' }
          }

          const segmentIds = filterSegmentIds(result.sceneGraphDelta)
          return {
            kclSource: result.kclSource,
            sceneGraphDelta: result.sceneGraphDelta,
            checkpointId: result.checkpointId ?? null,
            splineId,
            draftPointId,
            newlyAddedEntities: {
              segmentIds,
              constraintIds,
            },
          }
        } catch (error) {
          console.error('Failed to create control point spline:', error)
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    ),
    finalizeDraftPoint: fromPromise(
      async ({
        input,
      }: {
        input: {
          pointData: Coords2d
          draftPointId: number
          snapTarget?: SnapTarget
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
        }
      }): Promise<ToolDoneOutput | ErrorOutput> => {
        const {
          pointData,
          draftPointId,
          snapTarget,
          rustContext,
          kclManager,
          sketchId,
        } = input
        const units = baseUnitToNumericSuffix(
          kclManager.fileSettings.defaultLengthUnit
        )
        const settings = jsAppSettings(rustContext.settingsActor)

        try {
          let result = await rustContext.editSegments(
            0,
            sketchId,
            [
              {
                id: draftPointId,
                ctor: {
                  type: 'Point',
                  position: toPointExpr(pointData, units) as any,
                },
              },
            ],
            settings
          )

          if (snapTarget) {
            const constraint = getConstraintForSnapTarget(
              draftPointId,
              snapTarget,
              units
            )
            if (constraint !== null) {
              const snapResult = await rustContext.addConstraint(
                0,
                sketchId,
                constraint,
                settings
              )
              result = mergeMutationResults(result, snapResult)
            }
          }

          return {
            kclSource: result.kclSource,
            sceneGraphDelta: result.sceneGraphDelta,
            checkpointId: result.checkpointId ?? null,
          }
        } catch (error) {
          console.error('Failed to finalize spline draft point:', error)
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    ),
    appendDraftPoint: fromPromise(
      async ({
        input,
      }: {
        input: {
          splineId: number
          points: Coords2d[]
          construction: boolean
          draftPoint: Coords2d
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
        }
      }): Promise<ToolDoneOutput | ErrorOutput> => {
        const {
          splineId,
          points,
          construction,
          draftPoint,
          rustContext,
          kclManager,
          sketchId,
        } = input
        const units = baseUnitToNumericSuffix(
          kclManager.fileSettings.defaultLengthUnit
        )
        const settings = jsAppSettings(rustContext.settingsActor)
        try {
          const result = await rustContext.editSegments(
            0,
            sketchId,
            [
              {
                id: splineId,
                ctor: {
                  type: 'ControlPointSpline',
                  points: [...points, draftPoint].map((point) =>
                    toPointExpr(point, units)
                  ) as any,
                  construction,
                },
              },
            ],
            settings
          )

          const updatedSpline =
            findControlPointSplineByPoints({
              sceneGraphDelta: result.sceneGraphDelta,
              sketchId,
              expectedPoints: [...points, draftPoint],
              previousSplineId: splineId,
            }) ?? result.sceneGraphDelta.new_graph.objects[splineId]
          if (!isControlPointSplineSegment(updatedSpline)) {
            console.warn('Failed to identify updated control point spline', {
              splineId,
              expectedPoints: [...points, draftPoint],
              newObjects: result.sceneGraphDelta.new_objects,
            })
            return { error: 'Failed to update control point spline.' }
          }

          const draftPointId =
            updatedSpline.kind.segment.controls[
              updatedSpline.kind.segment.controls.length - 1
            ]
          if (draftPointId === undefined) {
            return { error: 'Failed to find appended spline control point.' }
          }

          return {
            kclSource: result.kclSource,
            sceneGraphDelta: result.sceneGraphDelta,
            checkpointId: result.checkpointId ?? null,
            splineId: updatedSpline.id,
            draftPointId,
            newlyAddedEntities: {
              segmentIds: filterSegmentIds(result.sceneGraphDelta),
              constraintIds: [],
            },
          }
        } catch (error) {
          console.error('Failed to append spline draft point:', error)
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    ),
    cancelDraftPoint: fromPromise(
      async ({
        input,
      }: {
        input: {
          splineId: number
          points: Coords2d[]
          construction: boolean
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
        }
      }): Promise<ToolDoneOutput | ErrorOutput> => {
        const {
          splineId,
          points,
          construction,
          rustContext,
          kclManager,
          sketchId,
        } = input
        const settings = jsAppSettings(rustContext.settingsActor)
        const remainingPoints = points.slice(0, -1)
        try {
          if (remainingPoints.length < MIN_CONTROL_POINTS) {
            const result = await rustContext.deleteObjects(
              0,
              sketchId,
              [],
              [splineId],
              settings
            )
            return {
              kclSource: result.kclSource,
              sceneGraphDelta: result.sceneGraphDelta,
              checkpointId: result.checkpointId ?? null,
            }
          }

          const units = baseUnitToNumericSuffix(
            kclManager.fileSettings.defaultLengthUnit
          )
          const result = await rustContext.editSegments(
            0,
            sketchId,
            [
              {
                id: splineId,
                ctor: {
                  type: 'ControlPointSpline',
                  points: remainingPoints.map((point) =>
                    toPointExpr(point, units)
                  ) as any,
                  construction,
                },
              },
            ],
            settings
          )
          return {
            kclSource: result.kclSource,
            sceneGraphDelta: result.sceneGraphDelta,
            checkpointId: result.checkpointId ?? null,
          }
        } catch (error) {
          console.error('Failed to cancel spline draft point:', error)
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    ),
  },
}).createMachine({
  context: ({ input }): ToolContext => ({
    firstPoint: undefined,
    firstSnapTarget: undefined,
    secondPoint: undefined,
    secondSnapTarget: undefined,
    splineId: undefined,
    draftPointId: undefined,
    committedControlCount: 0,
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId,
    cancelTarget: 'ready',
  }),
  id: TOOL_ID,
  initial: 'ready for first point click',
  on: {
    unequip: {
      target: `#${TOOL_ID}.requesting cleanup`,
    },
  },
  states: {
    'ready for first point click': {
      entry: ['add first point listener', 'clear draft entities'],
      on: {
        'add point': {
          guard: ({ event }) =>
            event.type === 'add point' &&
            'clickNumber' in event &&
            event.clickNumber === 1,
          target: 'ready for second point click',
          actions: 'store first point',
        },
        escape: {
          target: 'unequipping',
        },
      },
    },
    'ready for second point click': {
      entry: 'add second point listener',
      exit: 'remove tool listeners',
      on: {
        'add point': {
          guard: ({ event }) =>
            event.type === 'add point' &&
            'clickNumber' in event &&
            event.clickNumber === 2,
          target: 'waiting for initial spline move',
          actions: 'store second point',
        },
        escape: {
          target: 'ready for first point click',
          actions: ['clear preview line', 'clear staged points'],
        },
      },
    },
    'waiting for initial spline move': {
      entry: 'add initial spline move listener',
      exit: ['remove tool listeners', 'clear preview line'],
      on: {
        'start initial spline': {
          target: 'Creating initial spline',
        },
        escape: {
          target: 'ready for first point click',
          actions: 'clear staged points',
        },
      },
    },
    'Creating initial spline': {
      invoke: {
        src: 'createInitialSpline',
        input: ({ event, context }) => {
          assertEvent(event, 'start initial spline')
          return {
            points: [context.firstPoint!, context.secondPoint!, event.data] as [
              Coords2d,
              Coords2d,
              Coords2d,
            ],
            snapTargets: [
              context.firstSnapTarget,
              context.secondSnapTarget,
            ] as const,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: [
          {
            guard: 'invoke output has error',
            target: 'ready for second point click',
            actions: 'toast sketch solve error',
          },
          {
            target: 'Animating draft point',
            actions: [
              'send result to parent',
              'set draft entities',
              'store created spline',
            ],
          },
        ],
        onError: {
          target: 'ready for second point click',
          actions: 'toast sketch solve error',
        },
      },
    },
    'Animating draft point': {
      entry: 'animate draft point listener',
      exit: 'remove tool listeners',
      on: {
        'add point': {
          guard: ({ event }) =>
            event.type === 'add point' &&
            'clickNumber' in event &&
            event.clickNumber === 3,
          target: 'Finalizing draft point',
        },
        escape: {
          target: 'Cancelling draft point',
          actions: 'set cancel target ready',
        },
      },
    },
    'Finalizing draft point': {
      invoke: {
        src: 'finalizeDraftPoint',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            pointData: event.data,
            draftPointId: context.draftPointId!,
            snapTarget: event.snapTarget,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: [
          {
            guard: 'invoke output has error',
            target: 'Animating draft point',
            actions: 'toast sketch solve error',
          },
          {
            target: 'waiting for append move',
            actions: [
              'send result to parent',
              'refresh spline draft entities',
              'store finalized draft point',
            ],
          },
        ],
        onError: {
          target: 'Animating draft point',
          actions: 'toast sketch solve error',
        },
      },
    },
    'waiting for append move': {
      entry: 'add append move listener',
      exit: 'remove tool listeners',
      on: {
        'start next draft point': {
          target: 'Appending draft point',
        },
        escape: {
          target: 'ready for first point click',
          actions: [
            'clear draft entities',
            'clear staged points',
            'clear spline state',
          ],
        },
      },
    },
    'Appending draft point': {
      invoke: {
        src: 'appendDraftPoint',
        input: ({ event, context, self }) => {
          assertEvent(event, 'start next draft point')
          const state = getCurrentSplineState({
            self,
            sketchId: context.sketchId,
            splineId: context.splineId!,
          })
          if (!state) {
            throw new Error('Expected current spline state while appending.')
          }
          return {
            splineId: context.splineId!,
            points: state.points,
            construction: state.splineObj.kind.segment.construction,
            draftPoint: event.data,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: [
          {
            guard: 'invoke output has error',
            target: 'waiting for append move',
            actions: 'toast sketch solve error',
          },
          {
            target: 'Animating draft point',
            actions: [
              'send result to parent',
              'set draft entities',
              'store appended draft point',
            ],
          },
        ],
        onError: {
          target: 'waiting for append move',
          actions: 'toast sketch solve error',
        },
      },
    },
    'requesting cleanup': {
      always: [
        {
          guard: ({ context }) => context.draftPointId !== undefined,
          target: 'Cancelling draft point',
          actions: 'set cancel target unequip',
        },
        {
          target: 'unequipping',
        },
      ],
    },
    'Cancelling draft point': {
      invoke: {
        src: 'cancelDraftPoint',
        input: ({ context, self }) => {
          const state = getCurrentSplineState({
            self,
            sketchId: context.sketchId,
            splineId: context.splineId!,
          })
          if (!state) {
            throw new Error('Expected current spline state while cancelling.')
          }
          return {
            splineId: context.splineId!,
            points: state.points,
            construction: state.splineObj.kind.segment.construction,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: [
          {
            guard: 'invoke output has error',
            target: 'unequipping',
            actions: 'toast sketch solve error',
          },
          {
            target: 'after cancelling draft point',
            actions: [
              'send result to parent',
              'clear draft entities',
              'clear spline state',
              'clear staged points',
            ],
          },
        ],
        onError: {
          target: 'unequipping',
          actions: 'toast sketch solve error',
        },
      },
    },
    'after cancelling draft point': {
      always: [
        {
          guard: ({ context }) => context.cancelTarget === 'unequip',
          target: 'unequipping',
        },
        {
          target: 'ready for first point click',
        },
      ],
    },
    unequipping: {
      type: 'final',
      entry: [
        'remove tool listeners',
        'clear preview line',
        'clear draft entities',
        'clear staged points',
        'set cancel target ready',
      ],
    },
  },
})
