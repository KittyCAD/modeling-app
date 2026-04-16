import type {
  SceneGraphDelta,
  SegmentCtor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { toggleSketchExtension } from '@src/editor/plugins/sketch'
import type { KclManager } from '@src/lang/KclManager'
import {
  baseUnitToNumericSuffix,
  distanceBetweenPoint2DExpr,
} from '@src/lang/wasm'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
import type {
  DefaultPlane,
  ExtrudeFacePlane,
  OffsetPlane,
} from '@src/machines/modelingSharedTypes'
import {
  buildAngleConstraintInput,
  buildEqualLengthConstraintInput,
  buildFixedConstraintInput,
  buildTangentConstraintInput,
  isArcSegment,
  isCircleSegment,
  isControlPointSplineSegment,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { toastSketchSolveError } from '@src/machines/sketchSolve/sketchSolveErrors'
import {
  CHILD_TOOL_DONE_EVENT,
  type SketchSolveContext,
  type SketchSolveMachineEvent,
  type SolveActionArgs,
  type SpawnToolActor,
  buildSegmentCtorFromObject,
  cleanupSketchSolveGroup,
  clearDraftEntities,
  clearHoverCallbacks,
  deleteDraftEntities,
  equipTools,
  getObjectSelectionIds,
  initializeInitialSceneGraph,
  initializeIntersectionPlane,
  ORIGIN_TARGET,
  refreshSelectionStyling,
  refreshSketchSolveScale,
  sendToActorIfActive,
  setDraftEntities,
  spawnTool,
  tearDownSketchSolve,
  updateSelectedIds,
  updateSketchOutcome,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import type { ConstraintSegment } from '@src/machines/sketchSolve/types'
import { setUpOnDragAndSelectionClickCallbacks } from '@src/machines/sketchSolve/tools/moveTool/moveTool'
import { assertEvent, assign, createMachine, sendParent, setup } from 'xstate'

const DEFAULT_DISTANCE_FALLBACK = 5

function sendToolbarConstraintOutcome(
  self: SolveActionArgs['self'],
  result:
    | Awaited<ReturnType<SketchSolveContext['rustContext']['addConstraint']>>
    | undefined
) {
  if (result) {
    sendToActorIfActive(self, {
      type: 'update selected ids',
      data: { selectedIds: [], duringAreaSelectIds: [] },
    })
    sendToActorIfActive(self, {
      type: 'update sketch outcome',
      data: {
        sourceDelta: result.kclSource,
        sceneGraphDelta: result.sceneGraphDelta,
        checkpointId: result.checkpointId ?? null,
      },
    })
  }
}

async function runSketchSolveToolbarAction(
  description: string,
  action: () => Promise<void>
) {
  try {
    await action()
  } catch (error) {
    console.error(`Failed to ${description}:`, error)
    toastSketchSolveError(error, `Failed to ${description}`)
  }
}

function isPointSelectionOrOrigin(selection: unknown): boolean {
  return (
    selection === ORIGIN_TARGET ||
    isPointSegment(selection as Parameters<typeof isPointSegment>[0])
  )
}

function getSelectionPointCoords(selection: unknown) {
  if (selection === ORIGIN_TARGET) {
    return { x: 0, y: 0 }
  }

  const pointSelection = selection as Parameters<typeof isPointSegment>[0]
  if (!isPointSegment(pointSelection)) {
    return null
  }

  return {
    x: pointSelection.kind.segment.position.x.value,
    y: pointSelection.kind.segment.position.y.value,
  }
}

async function addAxisDistanceConstraint(
  context: SketchSolveContext,
  self: SolveActionArgs['self'],
  axis: 'horizontal' | 'vertical',
  providedDistance?: number
) {
  let segmentsToConstrain = [...context.selectedIds]
  if (
    segmentsToConstrain.length === 1 &&
    typeof segmentsToConstrain[0] === 'number'
  ) {
    const first =
      context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
        segmentsToConstrain[0]
      ]
    if (isLineSegment(first)) {
      segmentsToConstrain = [first.kind.segment.start, first.kind.segment.end]
    }
  }
  const currentSelections = segmentsToConstrain
    .map((id) =>
      id === ORIGIN_TARGET
        ? ORIGIN_TARGET
        : context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[id]
    )
    .filter(Boolean)
  let distance =
    providedDistance !== undefined
      ? providedDistance
      : DEFAULT_DISTANCE_FALLBACK
  const units = baseUnitToNumericSuffix(
    context.kclManager.fileSettings.defaultLengthUnit
  )
  // Calculate distance between two points if both are point segments
  if (currentSelections.length === 2 && providedDistance === undefined) {
    const first = currentSelections[0]
    const second = currentSelections[1]
    const point1 = getSelectionPointCoords(first)
    const point2 = getSelectionPointCoords(second)
    if (point1 && point2) {
      const signedDistance =
        axis === 'horizontal'
          ? roundOff(point2.x - point1.x)
          : roundOff(point2.y - point1.y)

      if (signedDistance < 0) {
        segmentsToConstrain = [segmentsToConstrain[1], segmentsToConstrain[0]]
        distance = -signedDistance
      } else {
        distance = signedDistance
      }
    }
  }
  const result = await context.rustContext.addConstraint(
    0,
    context.sketchId,
    {
      type: axis === 'horizontal' ? 'HorizontalDistance' : 'VerticalDistance',
      distance: { value: distance, units },
      points: segmentsToConstrain.map(
        (id): ConstraintSegment => (id === ORIGIN_TARGET ? 'ORIGIN' : id)
      ) as unknown as number[],
      source: {
        expr: distance.toString(),
        is_literal: true,
      },
    },
    jsAppSettings(context.kclManager.systemDeps.settings),
    true
  )
  sendToolbarConstraintOutcome(self, result)
}

async function addLineOrientationConstraint(
  context: SketchSolveContext,
  self: SolveActionArgs['self'],
  type: 'Horizontal' | 'Vertical'
) {
  let result
  for (const id of getObjectSelectionIds(context.selectedIds)) {
    // TODO this is not how these constraints should operate long term, as they should be equipable tools
    result = await context.rustContext.addConstraint(
      0,
      context.sketchId,
      {
        type,
        line: id,
      },
      jsAppSettings(context.kclManager.systemDeps.settings),
      true
    )
  }
  sendToolbarConstraintOutcome(self, result)
}

async function addHorizontalConstraint(
  context: SketchSolveContext,
  self: SolveActionArgs['self']
) {
  await addLineOrientationConstraint(context, self, 'Horizontal')
}

async function addVerticalConstraint(
  context: SketchSolveContext,
  self: SolveActionArgs['self']
) {
  await addLineOrientationConstraint(context, self, 'Vertical')
}

async function addFixedConstraint(
  context: SketchSolveContext,
  self: SolveActionArgs['self']
) {
  const objects =
    context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects || []
  const fixedInput = buildFixedConstraintInput(
    getObjectSelectionIds(context.selectedIds),
    objects
  )
  if (!fixedInput) {
    return
  }

  const result = await context.rustContext.addConstraint(
    0,
    context.sketchId,
    {
      type: 'Fixed',
      points: fixedInput,
    },
    jsAppSettings(context.kclManager.systemDeps.settings),
    true
  )
  sendToolbarConstraintOutcome(self, result)
}

export const sketchSolveMachine = setup({
  types: {
    context: {} as SketchSolveContext,
    events: {} as SketchSolveMachineEvent,
    input: {} as {
      // dependencies
      kclManager: KclManager
      // end dependencies
      initialSketchSolvePlane?:
        | DefaultPlane
        | OffsetPlane
        | ExtrudeFacePlane
        | null
      sketchId: number
      initialSceneGraphDelta: SceneGraphDelta
    },
  },
  actions: {
    'initialize intersection plane': initializeIntersectionPlane,
    'initialize initial scene graph': assign(initializeInitialSceneGraph),
    'register sketch solve scale refresh': ({ self, context }) => {
      context.sceneInfra.setOnBeforeRender(() => {
        const snapshot = self.getSnapshot()
        refreshSketchSolveScale(snapshot.context)
      })
    },
    'clear sketch solve scale refresh': ({ context }) => {
      context.sceneInfra.setOnBeforeRender(null)
    },
    'toast sketch solve error': ({ event }) => {
      toastSketchSolveError(event)
    },
    setUpOnDragAndSelectionClickCallbacks,
    'clear hover callbacks': clearHoverCallbacks,
    'cleanup sketch solve group': ({ context }) => {
      cleanupSketchSolveGroup(context.sceneInfra)
    },
    'send unequip to tool': ({ context }) => {
      sendToActorIfActive(context.childTool, { type: 'unequip' })
    },
    'send escape to tool': ({ context }) => {
      sendToActorIfActive(context.childTool, { type: 'escape' })
    },
    'store pending tool': assign(({ event, system }) => {
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
    'toggle non-visual constraints': assign(({ context }) => ({
      showNonVisualConstraints: !context.showNonVisualConstraints,
    })),
    'send show non-visual constraints changed to parent': sendParent(
      ({ context }) => ({
        type: 'show non-visual constraints changed',
        data: { value: context.showNonVisualConstraints },
      })
    ),
    'clear child tool': assign({
      sketchSolveToolName: null,
      childTool: undefined,
    }),
    'update selected ids': assign(updateSelectedIds),
    'update hovered id': assign(({ event }) => {
      assertEvent(event, 'update hovered id')
      return {
        hoveredId: event.data.hoveredId,
        constraintHoverPopups: event.data.constraintHoverPopups ?? [],
      }
    }),
    'refresh selection styling': refreshSelectionStyling,
    'update sketch outcome': assign(updateSketchOutcome),
    'set draft entities': assign(setDraftEntities),
    'clear draft entities': assign(clearDraftEntities),
    'delete draft entities': (
      args: Parameters<typeof deleteDraftEntities>[0]
    ) => {
      // Async action - XState handles promises in actions
      void deleteDraftEntities(args)
    },
    'spawn tool': assign((args) => {
      const typedSpawn: SpawnToolActor = args.spawn
      return spawnTool(args, typedSpawn)
    }),
  },
  actors: {
    tearDownSketchSolve,
    moveToolActor: createMachine({
      /* ... */
    }),
    ...equipTools,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiMADwEsMBtABgF1FQAHQrFbNCAO14hGiAMwBOAKwBGAHQA2eQHYALKo7rZ0gBwAmADQgAnomPTpyjscfSOik8Y3T5xgL7fzaTFwCEnIqGnoAVz4IAEMMClh0bHxCCOxCAFswTh4kEAEhDBFxPKkEYxN5NRNVEwNPDi1zKwQAWgqq6S0NeVlFRQ5bQ3lVX38koKIyCmpaOlhMPAgAJxiAMww8MFEiorgciQLhMQky4y0tOwHpc+M+jgd5ZsR24eUujV0TDg1FVWMfmMQAFksFpmE5lhiGAYsslqsNlsdsJ9txDoJjiVQGVFLJVFplACNDYLo1pP8zJYXu4qrpFPIyZpVNptECQZMQjNwnRaND4vD1pttrtmKjcvwMUUTqUZLoqoZ-lofqoFLjDNJnm0Ou9ur1+oMjCM2RN8FNQrN6HAsDE+Nk0XkjlKsZIZMZFHZfgDSRcGdpNe1ie9iTctK5updjYFTZyIfQsIRmKIsMxaDsDg7JcVTogGf9CY1DP0NIZfiNNQNLspKhUuqpnJp5JHQWauXMACLMWAYGJJu3i-KZ6XYnMAlQuQw-Gxujh48tkqvGLzqnT1npNjngi10AAKsJixGhxHTEsKWZlCHk0kUGkJF3xhq8WieVIQFbs1eXdY4DfX0c33IAGUTOAAFEAEcIn3ADtigDAcGPAdTyHF0EC0BVjGUHRPnJLQ+kuJoXzfBcl1rVdGz8YETTBc1uQANTAZYimtI97RPTFs1Q7QCQ4QxhgGFUNA0Po50rD9SO-NcKPZP8aLmAAJQhlmYAAvMRuxY-tHTPYdUK+QkATdS9cTuHoRPfRcaxXCTyPGKNqNbSJojiBIwGhLB4ggPAU1gBCtOQs4bBvekelJeRcKUAiWgDK5VHUCcJ0vf5RikqiW1jHlXMwFy3I83zB2dMoLi0DDvwUb9nB4iozOIyyvx-FK7LSi1lAyQhQh7TyFhynkxDAZRE1IQh0BatqwAAFUIEg8qQgqZHpQxMJuCpcSUeR5BLTU3QWu462Jd1i1kcrf3s2MRva0ROsy9yGGWZZFOUPhiDiNZFIyM7xsmjT0Rmjir16ZQK0URcGQZP5NvxZQDF1UMeiMDRAQa5sY2a1rzsu7qwAg5g+DwDBPum9jz1xQNGj6cldBVNDZE1Lo7CMdC-kGElFGOprwnevAOrwLqwGuq0bT7b7CZ0m5-tDfDYqfATNWLDg1EnNbDGK5xalZ5H2YiIRRCgXHProCJRExiJsd1qbWMQ4WUPcT5MLQxRQzuXMFE1bo5ZufElXK2p1rV-9aGUTXEx1vGSAYLGcZDr6Mx+89rdUW3CwdsqNE1db4-UHjvx0Hilt92S+sD7XTeIBhYGtW0CadDjHFDd5ZCVn5+lcYxYpl+uAfUS8FCGYYfERjd8+UJhhCLgB3Vh8ChGFRCiHrDf60RBuG3ksrbBEMBA5E9lgAB5UQQJYdhzb82aEHJRc1HW9btFi5UXaEwlC2JH4J2ZekbMoxr1f94eijHie8BTx7LPBid1lgPSehgF6yw3or3iGvQUm8RRwD3gfVgldtIoXPvHG4fRYrMkMH0YsqcDDKHWneYsT4DCxTzg5Ieh8g54HHnBQB0JgF8AynyCgKxBRImQT5Y++VfpK3jg8CystZCfG-JqPEcshLaELOSHisg3S+AoqIcI8A8jSROhaIWVciYqO4rhd0t9KaEJphhMMRhGaFnVLILQtDTqowoFzHm7l9GYICnIQkFJejqkLLOF8U53hA3+C4CKvE1pOOaoXYOn1PH+WsIuG8i5XAjEOuoZuLsjD2E0J4e2PQjIfx0Wzf2sBmG4EYZHRJp9nAX0IWtOUsN3YkKqNoIGuF3A2AnI4-uMk6G-0YcwyebCZ58Fqb9DwJULg2EaHoc4GoXweHjgMNa+ECnXlkDE9mQztaTPPEom8hDKi1H+MMdam1nCQ3DLqXM3R647P9gbI22M+DVISdHS2ZR6lVHrnWOs9IlqKBdqoFQTTbgjGKgqRoajvBAA */
  context: ({ input }): SketchSolveContext => {
    return {
      sketchSolveToolName: null,
      selectedIds: [],
      duringAreaSelectIds: [],
      hoveredId: null,
      constraintHoverPopups: [],
      initialPlane: input?.initialSketchSolvePlane ?? undefined,
      sketchExecOutcome: {
        sourceDelta: {
          text: input.kclManager.code,
        },
        sceneGraphDelta: input.initialSceneGraphDelta,
      },
      sketchId: input?.sketchId || 0,
      sceneInfra: input.kclManager.sceneInfra,
      sceneEntitiesManager: input.kclManager.sceneEntitiesManager,
      rustContext: input.kclManager.rustContext,
      kclManager: input.kclManager,
      showNonVisualConstraints: false,
    }
  },
  id: 'Sketch Solve Mode',
  initial: 'move and select',
  on: {
    exit: {
      target: '#Sketch Solve Mode.exiting with cleanup',
      actions: [
        'clear sketch solve scale refresh',
        'send unequip to tool',
        'send tool unequipped to parent',
      ],
      description:
        'the outside world can request that sketch mode exit, but it needs to handle its own teardown first.',
    },
    'update sketch outcome': {
      actions: 'update sketch outcome',
      description:
        'Updates the sketch execution outcome in the context when tools complete operations',
    },
    'set draft entities': {
      actions: 'set draft entities',
      description:
        'Sets which entities are currently in draft state (e.g., while user is drawing a line)',
    },
    'clear draft entities': {
      actions: ['clear draft entities', 'refresh selection styling'],
      description: 'Clears the draft entities tracking and refreshes styling',
    },
    'delete draft entities': {
      actions: 'delete draft entities',
      description:
        'Deletes the currently tracked draft entities (e.g., when user cancels with escape)',
    },
    'toggle non-visual constraints': {
      actions: [
        'toggle non-visual constraints',
        'send show non-visual constraints changed to parent',
        'refresh selection styling',
      ],
      description:
        'Toggles whether non-visual constraints should be shown in sketch solve mode.',
    },
    escape: {
      // Only forward to tool if we're in 'using tool' state
      // If in 'move and select', the state-level handler will exit sketch mode
      // If in 'unequipping tool' or 'switching tool', ignore (tool is already stopping)
      description:
        'ESC key - forwarded to child tool when a tool is equipped. Handled at state level when no tool is equipped.',
    },
    coincident: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add a coincident constraint',
          async () => {
            // TODO this is not how coincident should operate long term, as it should be an equipable tool
            const selectedIds = context.selectedIds.map(
              (id): ConstraintSegment => (id === ORIGIN_TARGET ? 'ORIGIN' : id)
            )
            const result = await context.rustContext.addConstraint(
              0,
              context.sketchId,
              {
                type: 'Coincident',
                segments: selectedIds,
              },
              jsAppSettings(context.kclManager.systemDeps.settings),
              true
            )
            sendToolbarConstraintOutcome(self, result)
          }
        )
      },
    },
    Fixed: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add a fixed constraint',
          async () => {
            await addFixedConstraint(context, self)
          }
        )
      },
    },
    Tangent: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add a tangent constraint',
          async () => {
            const objects =
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects || []
            const tangentConstraint = buildTangentConstraintInput(
              getObjectSelectionIds(context.selectedIds),
              objects
            )
            if (!tangentConstraint) {
              return
            }

            const result = await context.rustContext.addConstraint(
              0,
              context.sketchId,
              tangentConstraint,
              jsAppSettings(context.kclManager.systemDeps.settings),
              true
            )
            sendToolbarConstraintOutcome(self, result)
          }
        )
      },
    },
    Dimension: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add a dimension constraint',
          async () => {
            // TODO this is not how coincident should operate long term, as it should be an equipable tool
            const segmentsToConstrain = [...context.selectedIds]
            const objects =
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects || []
            const currentSelections = segmentsToConstrain
              .map((id) => (id === ORIGIN_TARGET ? ORIGIN_TARGET : objects[id]))
              .filter(Boolean)
            let distance = DEFAULT_DISTANCE_FALLBACK
            const units = baseUnitToNumericSuffix(
              context.kclManager.fileSettings.defaultLengthUnit
            )

            if (currentSelections.length === 2) {
              const first = currentSelections[0]
              const second = currentSelections[1]
              const firstObject = first === ORIGIN_TARGET ? undefined : first
              const secondObject = second === ORIGIN_TARGET ? undefined : second
              if (isLineSegment(firstObject) && isLineSegment(secondObject)) {
                const angleConstraint = buildAngleConstraintInput(
                  firstObject,
                  secondObject,
                  objects
                )
                if (angleConstraint) {
                  const result = await context.rustContext.addConstraint(
                    0,
                    context.sketchId,
                    angleConstraint,
                    jsAppSettings(context.kclManager.systemDeps.settings),
                    true
                  )
                  sendToolbarConstraintOutcome(self, result)
                  return
                }
              }

              // Calculate distance between two points if both are point segments
              if (isPointSegment(firstObject) && isPointSegment(secondObject)) {
                // the units of these points will have already been normalized to the user's default units
                // even `at = [var -0.09in, var 0.19in]` will be unit: 'Mm' if the user's default is mm
                const point1 = {
                  x: firstObject.kind.segment.position.x,
                  y: firstObject.kind.segment.position.y,
                }
                const point2 = {
                  x: secondObject.kind.segment.position.x,
                  y: secondObject.kind.segment.position.y,
                }
                const distanceResult = distanceBetweenPoint2DExpr(
                  point1,
                  point2,
                  await context.kclManager.wasmInstancePromise
                )
                if (!(distanceResult instanceof Error)) {
                  distance = roundOff(distanceResult.distance)
                }
              } else {
                const point1 = getSelectionPointCoords(first)
                const point2 = getSelectionPointCoords(second)
                if (point1 && point2) {
                  distance = roundOff(
                    Math.hypot(point2.x - point1.x, point2.y - point1.y)
                  )
                }
              }
            } else if (currentSelections.length === 1) {
              const first = currentSelections[0]
              const firstObject = first === ORIGIN_TARGET ? undefined : first
              if (isArcSegment(firstObject) || isCircleSegment(firstObject)) {
                // Calculate radius for arc segment from its center and start point
                const centerPoint =
                  context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
                    firstObject.kind.segment.center
                  ]
                const startPoint =
                  context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
                    firstObject.kind.segment.start
                  ]
                if (isPointSegment(centerPoint) && isPointSegment(startPoint)) {
                  const point1 = {
                    x: centerPoint.kind.segment.position.x,
                    y: centerPoint.kind.segment.position.y,
                  }
                  const point2 = {
                    x: startPoint.kind.segment.position.x,
                    y: startPoint.kind.segment.position.y,
                  }
                  const distanceResult = distanceBetweenPoint2DExpr(
                    point1,
                    point2,
                    await context.kclManager.wasmInstancePromise
                  )
                  if (!(distanceResult instanceof Error)) {
                    distance = roundOff(distanceResult.distance)
                  }
                }
                // Apply radius constraint for arc
                const result = await context.rustContext.addConstraint(
                  0,
                  context.sketchId,
                  {
                    type: 'Radius',
                    radius: { value: distance, units },
                    arc: firstObject.id,
                    source: {
                      expr: distance.toString(),
                      is_literal: true,
                    },
                  },
                  jsAppSettings(context.kclManager.systemDeps.settings),
                  true
                )
                sendToolbarConstraintOutcome(self, result)
                return
              } else if (isLineSegment(firstObject)) {
                // Calculate distance for line segment from its endpoints
                const startPoint =
                  context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
                    firstObject.kind.segment.start
                  ]
                const endPoint =
                  context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
                    firstObject.kind.segment.end
                  ]
                if (isPointSegment(startPoint) && isPointSegment(endPoint)) {
                  const point1 = {
                    x: startPoint.kind.segment.position.x,
                    y: startPoint.kind.segment.position.y,
                  }
                  const point2 = {
                    x: endPoint.kind.segment.position.x,
                    y: endPoint.kind.segment.position.y,
                  }
                  const distanceResult = distanceBetweenPoint2DExpr(
                    point1,
                    point2,
                    await context.kclManager.wasmInstancePromise
                  )
                  if (!(distanceResult instanceof Error)) {
                    distance = roundOff(distanceResult.distance)
                  }
                }
              }
            }
            // distance() accepts two points: when user selects one line, pass its endpoints
            const firstSelection =
              currentSelections.length === 1 &&
              currentSelections[0] !== ORIGIN_TARGET
                ? currentSelections[0]
                : undefined
            const pointsForDistance: ConstraintSegment[] =
              currentSelections.length === 1 && isLineSegment(firstSelection)
                ? [
                    firstSelection.kind.segment.start,
                    firstSelection.kind.segment.end,
                  ]
                : segmentsToConstrain.map(
                    (id): ConstraintSegment =>
                      id === ORIGIN_TARGET ? 'ORIGIN' : id
                  )
            const result = await context.rustContext.addConstraint(
              0,
              context.sketchId,
              {
                type: 'Distance',
                distance: { value: distance, units },
                points: pointsForDistance as unknown as number[],
                source: {
                  expr: distance.toString(),
                  is_literal: true,
                },
              },
              jsAppSettings(context.kclManager.systemDeps.settings),
              true
            )
            sendToolbarConstraintOutcome(self, result)
          }
        )
      },
    },
    HorizontalDistance: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add a horizontal distance constraint',
          async () => {
            await addAxisDistanceConstraint(context, self, 'horizontal')
          }
        )
      },
    },
    VerticalDistance: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add a vertical distance constraint',
          async () => {
            await addAxisDistanceConstraint(context, self, 'vertical')
          }
        )
      },
    },
    Parallel: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add a parallel constraint',
          async () => {
            // TODO this is not how coincident should operate long term, as it should be an equipable tool
            const selectedIds = getObjectSelectionIds(context.selectedIds)
            const result = await context.rustContext.addConstraint(
              0,
              context.sketchId,
              {
                type: 'Parallel',
                lines: selectedIds,
              },
              jsAppSettings(context.kclManager.systemDeps.settings),
              true
            )
            sendToolbarConstraintOutcome(self, result)
          }
        )
      },
    },
    Perpendicular: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add a perpendicular constraint',
          async () => {
            // TODO this is not how coincident should operate long term, as it should be an equipable tool
            const selectedIds = getObjectSelectionIds(context.selectedIds)
            const result = await context.rustContext.addConstraint(
              0,
              context.sketchId,
              {
                type: 'Perpendicular',
                lines: selectedIds,
              },
              jsAppSettings(context.kclManager.systemDeps.settings),
              true
            )
            sendToolbarConstraintOutcome(self, result)
          }
        )
      },
    },
    EqualLength: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add an equal length constraint',
          async () => {
            // TODO this is not how EqualLength should operate long term, as it should be an equipable tool
            const selectedIds = getObjectSelectionIds(context.selectedIds)
            const objects =
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects || []
            const equalLengthConstraint = buildEqualLengthConstraintInput(
              selectedIds,
              objects
            )
            if (!equalLengthConstraint) {
              return
            }

            const result = await context.rustContext.addConstraint(
              0,
              context.sketchId,
              equalLengthConstraint,
              jsAppSettings(context.kclManager.systemDeps.settings),
              true
            )
            sendToolbarConstraintOutcome(self, result)
          }
        )
      },
    },
    Vertical: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add a vertical constraint',
          async () => {
            const itemsToConstrain = context.selectedIds
            const selectionIsAllPoints = itemsToConstrain
              .map((id) =>
                id === ORIGIN_TARGET
                  ? ORIGIN_TARGET
                  : context.sketchExecOutcome?.sceneGraphDelta.new_graph
                      .objects[id]
              )
              .every((selection) => isPointSelectionOrOrigin(selection))

            // If every selected item is a Point, "Vertical" really means "horizontal distance of zero"
            if (itemsToConstrain.length > 1 && selectionIsAllPoints) {
              await addAxisDistanceConstraint(context, self, 'horizontal', 0)
              return
            } else {
              // Otherwise, just apply the horizontal constraint to each item, as if they're Lines
              await addVerticalConstraint(context, self)
            }
          }
        )
      },
    },
    Horizontal: {
      actions: async ({ self, context }) => {
        await runSketchSolveToolbarAction(
          'add a horizontal constraint',
          async () => {
            const itemsToConstrain = context.selectedIds
            const selectionIsAllPoints = itemsToConstrain
              .map((id) =>
                id === ORIGIN_TARGET
                  ? ORIGIN_TARGET
                  : context.sketchExecOutcome?.sceneGraphDelta.new_graph
                      .objects[id]
              )
              .every((selection) => isPointSelectionOrOrigin(selection))

            // If every selected item is a Point, "Horizontal" really means "vertical distance of zero"
            if (itemsToConstrain.length > 1 && selectionIsAllPoints) {
              await addAxisDistanceConstraint(context, self, 'vertical', 0)
              return
            } else {
              // Otherwise, just apply the horizontal constraint to each item, as if they're Lines
              await addHorizontalConstraint(context, self)
            }
          }
        )
      },
    },
    construction: {
      actions: async ({ self, context }) => {
        const selectedIds = getObjectSelectionIds(context.selectedIds)
        const objects =
          context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects || []

        if (selectedIds.length === 0) {
          return
        }

        const segmentsToEdit: Array<{
          id: number
          ctor: SegmentCtor
        }> = []

        for (const id of selectedIds) {
          const obj = objects[id]
          if (!obj || obj.kind.type !== 'Segment') {
            continue
          }

          // Only drawable curve segments support construction geometry
          if (
            obj.kind.segment.type !== 'Line' &&
            obj.kind.segment.type !== 'Arc' &&
            obj.kind.segment.type !== 'Circle' &&
            obj.kind.segment.type !== 'ControlPointSpline'
          ) {
            continue
          }

          // Build the base segment ctor
          const baseCtor = buildSegmentCtorFromObject(obj, objects)
          if (!baseCtor) {
            continue
          }

          // Get current construction state
          const currentConstruction =
            isLineSegment(obj) ||
            isArcSegment(obj) ||
            isCircleSegment(obj) ||
            isControlPointSplineSegment(obj)
              ? obj.kind.segment.construction
              : false

          // Toggle construction state
          const newConstruction = !currentConstruction

          // Add construction property to Line or Arc ctors
          if (baseCtor.type === 'Line') {
            segmentsToEdit.push({
              id,
              ctor: {
                ...baseCtor,
                construction: newConstruction,
              },
            })
          } else if (baseCtor.type === 'Arc') {
            segmentsToEdit.push({
              id,
              ctor: {
                ...baseCtor,
                construction: newConstruction,
              },
            })
          } else if (baseCtor.type === 'Circle') {
            segmentsToEdit.push({
              id,
              ctor: {
                ...baseCtor,
                construction: newConstruction,
              },
            })
          } else if (baseCtor.type === 'ControlPointSpline') {
            segmentsToEdit.push({
              id,
              ctor: {
                ...baseCtor,
                construction: newConstruction,
              },
            })
          }
        }

        if (segmentsToEdit.length === 0) {
          return
        }

        // Edit segments via Rust context
        const result = await context.rustContext
          .editSegments(
            0,
            context.sketchId,
            segmentsToEdit,
            jsAppSettings(context.kclManager.systemDeps.settings),
            true
          )
          .catch((err) => {
            console.error('failed to toggle construction geometry', err)
            toastSketchSolveError(err)
            return null
          })

        if (result) {
          sendToActorIfActive(self, {
            type: 'update sketch outcome',
            data: {
              sourceDelta: result.kclSource,
              sceneGraphDelta: result.sceneGraphDelta,
              checkpointId: result.checkpointId ?? null,
            },
          })
        }
      },
    },
    'update selected ids': {
      actions: ['update selected ids', 'refresh selection styling'],
    },
    'update hovered id': {
      actions: ['update hovered id', 'refresh selection styling'],
    },
    'delete selected': {
      actions: async ({ self, context }) => {
        const selectedIds = getObjectSelectionIds(context.selectedIds)

        // Only proceed if there are selected IDs
        if (selectedIds.length === 0) {
          return
        }

        // Partition selectedIds into constraints and segments
        const objects =
          context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects || []
        const constraintIds: number[] = []
        const segmentIds: number[] = []
        for (const id of selectedIds) {
          const obj = objects[id]
          if (obj?.kind.type === 'Constraint') {
            constraintIds.push(id)
          } else {
            segmentIds.push(id)
          }
        }

        const result = await context.rustContext
          .deleteObjects(
            SKETCH_FILE_VERSION,
            context.sketchId,
            constraintIds,
            segmentIds,
            jsAppSettings(context.kclManager.systemDeps.settings)
          )
          .catch((err) => {
            console.error('failed to delete objects', err)
            toastSketchSolveError(err)
            return null
          })

        if (result) {
          // Clear selection after deletion
          sendToActorIfActive(self, {
            type: 'update selected ids',
            data: { selectedIds: [], duringAreaSelectIds: [] },
          })

          // Send the update sketch outcome event
          sendToActorIfActive(self, {
            type: 'update sketch outcome',
            data: {
              sourceDelta: result.kclSource,
              sceneGraphDelta: result.sceneGraphDelta,
            },
          })
        }
      },
    },
    'start editing constraint': {
      actions: [
        assign({
          editingConstraintId: ({ event }) => {
            assertEvent(event, 'start editing constraint')
            return event.data.constraintId
          },
        }),
      ],
    },
    'stop editing constraint': {
      actions: [
        assign({
          editingConstraintId: undefined,
        }),
      ],
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
        escape: {
          target: '#Sketch Solve Mode.exiting',
          actions: [
            'send tool unequipped to parent',
            'cleanup sketch solve group',
          ],
          description:
            'ESC in move and select (no tool equipped) exits sketch mode',
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
          actions: 'toast sketch solve error',
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
        [CHILD_TOOL_DONE_EVENT]: {
          target: 'move and select',
          actions: ['clear child tool', 'send tool unequipped to parent'],
        },
        escape: {
          // Forward escape to child tool only when tool is active
          actions: 'send escape to tool',
          description: 'ESC forwarded to child tool for hierarchical handling',
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
          actions: [],
        },
      },

      description:
        'Intermediate state while the current tool is cleaning up before spawning a new tool.',
    },

    'exiting with cleanup': {
      on: {
        'delete draft entities': {
          description: `We override the default "delete draft entities" action with a no-op here because the async invoke above is already performing that cleanup.`,
        },
      },
      invoke: {
        id: 'tearDownSketchSolve',
        src: 'tearDownSketchSolve',
        input: ({ context }: { context: SketchSolveContext }) => {
          return { context }
        },
        onDone: {
          target: '#Sketch Solve Mode.exiting',
          actions: [
            ({ event, context, self }) => {
              // Update code editor if new source was returned
              if (event.output?.kclSource) {
                context.kclManager.updateCodeEditor(event.output.kclSource.text)
              }

              // Scene cleanup will run on entry of final exiting state

              // Always clear draft entities after deletion attempt
              sendToActorIfActive(self, { type: 'clear draft entities' })
            },
            // No need to update context with scene graph on exit
          ],
        },
        onError: {
          target: '#Sketch Solve Mode.exiting',
          actions: [
            ({ event }) => {
              toastSketchSolveError(event, 'Failed to exit sketch cleanly')
            },
            ({ event, context, self }) => {
              // Clear draft entities even on error to allow exit to continue
              sendToActorIfActive(self, { type: 'clear draft entities' })
            },
          ],
        },
      },
      description:
        'Intermediate state that deletes draft entities before final exit. The invoke will return immediately if no draft entities exist, otherwise it waits for deletion to complete.',
    },
    exiting: {
      type: 'final',
      entry: ['cleanup sketch solve group'],
      description: 'Place any teardown code here.',
    },

    'unequipping tool': {
      on: {
        [CHILD_TOOL_DONE_EVENT]: {
          target: 'move and select',
          actions: ['clear child tool', 'send tool unequipped to parent'],
        },
      },

      description: `Intermediate state, same as the "switching tool" state, but for unequip`,
    },
  },

  entry: [
    'register sketch solve scale refresh',
    'initialize intersection plane',
    'initialize initial scene graph',
    'setUpOnDragAndSelectionClickCallbacks',
    ({ context }) => toggleSketchExtension(context.kclManager.editorView, true),
  ],

  exit: [
    ({ context }) =>
      toggleSketchExtension(context.kclManager.editorView, false),
  ],
})
