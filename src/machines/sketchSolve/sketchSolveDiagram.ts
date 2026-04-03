import { assertEvent, assign, createMachine, sendParent, setup } from 'xstate'
import type {
  CoincidentSegment,
  SceneGraphDelta,
  SegmentCtor,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclManager } from '@src/lang/KclManager'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { roundOff } from '@src/lib/utils'
import type {
  DefaultPlane,
  ExtrudeFacePlane,
  OffsetPlane,
} from '@src/machines/modelingSharedTypes'
import {
  baseUnitToNumericSuffix,
  distanceBetweenPoint2DExpr,
} from '@src/lang/wasm'
import {
  type SketchSolveMachineEvent,
  type SketchSolveContext,
  type SpawnToolActor,
  type SolveActionArgs,
  CHILD_TOOL_DONE_EVENT,
  equipTools,
  initializeIntersectionPlane,
  initializeInitialSceneGraph,
  clearHoverCallbacks,
  updateSelectedIds,
  refreshSelectionStyling,
  updateSketchOutcome,
  spawnTool,
  setDraftEntities,
  clearDraftEntities,
  deleteDraftEntities,
  cleanupSketchSolveGroup,
  buildSegmentCtorFromObject,
  getObjectSelectionIds,
  ORIGIN_TARGET,
  refreshSketchSolveScale,
  tearDownSketchSolve,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { setUpOnDragAndSelectionClickCallbacks } from '@src/machines/sketchSolve/tools/moveTool/moveTool'
import { SKETCH_FILE_VERSION } from '@src/lib/constants'
import {
  buildAngleConstraintInput,
  buildFixedConstraintInput,
  buildTangentConstraintInput,
  isArcSegment,
  isCircleSegment,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import { toggleSketchExtension } from '@src/editor/plugins/sketch'

const DEFAULT_DISTANCE_FALLBACK = 5

function sendToolbarConstraintOutcome(
  self: SolveActionArgs['self'],
  result:
    | Awaited<ReturnType<SketchSolveContext['rustContext']['addConstraint']>>
    | undefined
) {
  if (result) {
    self.send({
      type: 'update selected ids',
      data: { selectedIds: [], duringAreaSelectIds: [] },
    })
    self.send({
      type: 'update sketch outcome',
      data: {
        sourceDelta: result.kclSource,
        sceneGraphDelta: result.sceneGraphDelta,
      },
    })
  }
}

async function addAxisDistanceConstraint(
  context: SketchSolveContext,
  self: SolveActionArgs['self'],
  axis: 'horizontal' | 'vertical',
  providedDistance?: number
) {
  let segmentsToConstrain = getObjectSelectionIds(context.selectedIds)
  if (segmentsToConstrain.length === 1) {
    const first =
      context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
        segmentsToConstrain[0]
      ]
    if (isLineSegment(first)) {
      segmentsToConstrain = [first.kind.segment.start, first.kind.segment.end]
    }
  }
  const currentSelections = segmentsToConstrain
    .map(
      (id) => context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[id]
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
    if (isPointSegment(first) && isPointSegment(second)) {
      const point1 = {
        x: first.kind.segment.position.x,
        y: first.kind.segment.position.y,
      }
      const point2 = {
        x: second.kind.segment.position.x,
        y: second.kind.segment.position.y,
      }
      const signedDistance =
        axis === 'horizontal'
          ? roundOff(point2.x.value - point1.x.value)
          : roundOff(point2.y.value - point1.y.value)

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
      points: segmentsToConstrain,
      source: {
        expr: distance.toString(),
        is_literal: true,
      },
    },
    jsAppSettings(context.kclManager.systemDeps.settings)
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
      jsAppSettings(context.kclManager.systemDeps.settings)
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
    jsAppSettings(context.kclManager.systemDeps.settings)
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
    setUpOnDragAndSelectionClickCallbacks,
    'clear hover callbacks': clearHoverCallbacks,
    'cleanup sketch solve group': ({ context }) => {
      cleanupSketchSolveGroup(context.sceneInfra)
    },
    'send unequip to tool': ({ context }) => {
      // Use the actor reference directly - optional chaining handles missing actor gracefully
      context.childTool?.send({ type: 'unequip' })
    },
    'send escape to tool': ({ context }) => {
      // Use the actor reference directly - optional chaining handles missing actor gracefully
      context.childTool?.send({ type: 'escape' })
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
        // TODO this is not how coincident should operate long term, as it should be an equipable tool
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
          {
            type: 'Coincident',
            segments: context.selectedIds.map(
              (id): CoincidentSegment => (id === ORIGIN_TARGET ? 'ORIGIN' : id)
            ),
          },
          jsAppSettings(context.kclManager.systemDeps.settings)
        )
        sendToolbarConstraintOutcome(self, result)
      },
    },
    Fixed: {
      actions: async ({ self, context }) => {
        await addFixedConstraint(context, self)
      },
    },
    Tangent: {
      actions: async ({ self, context }) => {
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
          jsAppSettings(context.kclManager.systemDeps.settings)
        )
        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: {
              sourceDelta: result.kclSource,
              sceneGraphDelta: result.sceneGraphDelta,
            },
          })
        }
      },
    },
    Dimension: {
      actions: async ({ self, context }) => {
        // TODO this is not how coincident should operate long term, as it should be an equipable tool
        const segmentsToConstrain = getObjectSelectionIds(context.selectedIds)
        const objects =
          context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects || []
        const currentSelections = segmentsToConstrain
          .map((id) => objects[id])
          .filter(Boolean)
        let distance = DEFAULT_DISTANCE_FALLBACK
        const units = baseUnitToNumericSuffix(
          context.kclManager.fileSettings.defaultLengthUnit
        )

        if (currentSelections.length === 2) {
          const first = currentSelections[0]
          const second = currentSelections[1]
          if (isLineSegment(first) && isLineSegment(second)) {
            const angleConstraint = buildAngleConstraintInput(
              first,
              second,
              objects
            )
            if (angleConstraint) {
              const result = await context.rustContext.addConstraint(
                0,
                context.sketchId,
                angleConstraint,
                jsAppSettings(context.kclManager.systemDeps.settings)
              )
              sendToolbarConstraintOutcome(self, result)
              return
            }
          }

          // Calculate distance between two points if both are point segments
          if (isPointSegment(first) && isPointSegment(second)) {
            // the units of these points will have already been normalized to the user's default units
            // even `at = [var -0.09in, var 0.19in]` will be unit: 'Mm' if the user's default is mm
            const point1 = {
              x: first.kind.segment.position.x,
              y: first.kind.segment.position.y,
            }
            const point2 = {
              x: second.kind.segment.position.x,
              y: second.kind.segment.position.y,
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
        } else if (currentSelections.length === 1) {
          const first = currentSelections[0]
          if (isArcSegment(first) || isCircleSegment(first)) {
            // Calculate radius for arc segment from its center and start point
            const centerPoint =
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
                first.kind.segment.center
              ]
            const startPoint =
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
                first.kind.segment.start
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
                arc: segmentsToConstrain[0],
                source: {
                  expr: distance.toString(),
                  is_literal: true,
                },
              },
              jsAppSettings(context.kclManager.systemDeps.settings)
            )
            sendToolbarConstraintOutcome(self, result)
            return
          } else if (isLineSegment(first)) {
            // Calculate distance for line segment from its endpoints
            const startPoint =
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
                first.kind.segment.start
              ]
            const endPoint =
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
                first.kind.segment.end
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
        const pointsForDistance =
          currentSelections.length === 1 && isLineSegment(currentSelections[0])
            ? [
                currentSelections[0].kind.segment.start,
                currentSelections[0].kind.segment.end,
              ]
            : segmentsToConstrain
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
          {
            type: 'Distance',
            distance: { value: distance, units },
            points: pointsForDistance,
            source: {
              expr: distance.toString(),
              is_literal: true,
            },
          },
          jsAppSettings(context.kclManager.systemDeps.settings)
        )
        sendToolbarConstraintOutcome(self, result)
      },
    },
    HorizontalDistance: {
      actions: async ({ self, context }) => {
        await addAxisDistanceConstraint(context, self, 'horizontal')
      },
    },
    VerticalDistance: {
      actions: async ({ self, context }) => {
        await addAxisDistanceConstraint(context, self, 'vertical')
      },
    },
    Parallel: {
      actions: async ({ self, context }) => {
        // TODO this is not how coincident should operate long term, as it should be an equipable tool
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
          {
            type: 'Parallel',
            lines: getObjectSelectionIds(context.selectedIds),
          },
          jsAppSettings(context.kclManager.systemDeps.settings)
        )
        sendToolbarConstraintOutcome(self, result)
      },
    },
    Perpendicular: {
      actions: async ({ self, context }) => {
        // TODO this is not how coincident should operate long term, as it should be an equipable tool
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
          {
            type: 'Perpendicular',
            lines: getObjectSelectionIds(context.selectedIds),
          },
          jsAppSettings(context.kclManager.systemDeps.settings)
        )
        sendToolbarConstraintOutcome(self, result)
      },
    },
    LinesEqualLength: {
      actions: async ({ self, context }) => {
        // TODO this is not how LinesEqualLength should operate long term, as it should be an equipable tool
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
          {
            type: 'LinesEqualLength',
            lines: getObjectSelectionIds(context.selectedIds),
          },
          jsAppSettings(context.kclManager.systemDeps.settings)
        )
        sendToolbarConstraintOutcome(self, result)
      },
    },
    Vertical: {
      actions: async ({ self, context }) => {
        const itemsToConstrain = getObjectSelectionIds(context.selectedIds)
        const selectionIsAllPoints = itemsToConstrain
          .map(
            (id) =>
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[id]
          )
          .every((selection) => isPointSegment(selection))

        // If every selected item is a Point, "Vertical" really means "horizontal distance of zero"
        if (itemsToConstrain.length > 1 && selectionIsAllPoints) {
          await addAxisDistanceConstraint(context, self, 'horizontal', 0)
          return
        } else {
          // Otherwise, just apply the horizontal constraint to each item, as if they're Lines
          await addVerticalConstraint(context, self)
        }
      },
    },
    Horizontal: {
      actions: async ({ self, context }) => {
        const itemsToConstrain = getObjectSelectionIds(context.selectedIds)
        const selectionIsAllPoints = itemsToConstrain
          .map(
            (id) =>
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[id]
          )
          .every((selection) => isPointSegment(selection))

        // If every selected item is a Point, "Horizontal" really means "vertical distance of zero"
        if (itemsToConstrain.length > 1 && selectionIsAllPoints) {
          await addAxisDistanceConstraint(context, self, 'vertical', 0)
          return
        } else {
          // Otherwise, just apply the horizontal constraint to each item, as if they're Lines
          await addHorizontalConstraint(context, self)
        }
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

          // Only Line, Arc, and Circle segments support construction geometry
          if (
            obj.kind.segment.type !== 'Line' &&
            obj.kind.segment.type !== 'Arc' &&
            obj.kind.segment.type !== 'Circle'
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
            isLineSegment(obj) || isArcSegment(obj) || isCircleSegment(obj)
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
            jsAppSettings(context.kclManager.systemDeps.settings)
          )
          .catch((err) => {
            console.error('failed to toggle construction geometry', err)
            return null
          })

        if (result) {
          self.send({
            type: 'update sketch outcome',
            data: {
              sourceDelta: result.kclSource,
              sceneGraphDelta: result.sceneGraphDelta,
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
            return null
          })

        if (result) {
          // Clear selection after deletion
          self.send({
            type: 'update selected ids',
            data: { selectedIds: [], duringAreaSelectIds: [] },
          })

          // Send the update sketch outcome event
          self.send({
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
              self.send({ type: 'clear draft entities' })
            },
            // No need to update context with scene graph on exit
          ],
        },
        onError: {
          target: '#Sketch Solve Mode.exiting',
          actions: [
            ({ event, context, self }) => {
              // Clear draft entities even on error to allow exit to continue
              self.send({ type: 'clear draft entities' })
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
