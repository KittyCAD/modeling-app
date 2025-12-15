import {
  assertEvent,
  assign,
  createMachine,
  sendParent,
  setup,
  fromPromise,
} from 'xstate'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { SceneEntities } from '@src/clientSideScene/sceneEntities'
import type RustContext from '@src/lib/rustContext'
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
  deleteDraftEntitiesPromise,
  cleanupSketchSolveGroup,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import { setUpOnDragAndSelectionClickCallbacks } from '@src/machines/sketchSolve/tools/moveTool/moveTool'

export const sketchSolveMachine = setup({
  types: {
    context: {} as SketchSolveContext,
    events: {} as SketchSolveMachineEvent,
    input: {} as {
      // dependencies
      sceneInfra: SceneInfra
      sceneEntitiesManager: SceneEntities
      rustContext: RustContext
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
    setUpOnDragAndSelectionClickCallbacks,
    'clear hover callbacks': clearHoverCallbacks,
    'cleanup sketch solve group': cleanupSketchSolveGroup,
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
    'clear child tool': assign({
      sketchSolveToolName: null,
      childTool: undefined,
    }),
    'update selected ids': assign(updateSelectedIds),
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
    deleteDraftEntitiesOnExit: fromPromise(
      async ({
        input,
      }: {
        input: { context: SketchSolveContext }
      }) => {
        // Only delete if draft entities exist
        if (!input.context.draftEntities) {
          return null
        }
        return deleteDraftEntitiesPromise(input)
      }
    ),
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
      initialPlane: input?.initialSketchSolvePlane ?? undefined,
      sketchExecOutcome: {
        kclSource: {
          text: input.kclManager.code,
        },
        sceneGraphDelta: input.initialSceneGraphDelta,
      },
      sketchId: input?.sketchId || 0,
      sceneInfra: input.sceneInfra,
      sceneEntitiesManager: input.sceneEntitiesManager,
      rustContext: input.rustContext,
      kclManager: input.kclManager,
    }
  },
  id: 'Sketch Solve Mode',
  initial: 'move and select',
  on: {
    exit: {
      target: '#Sketch Solve Mode.exiting with cleanup',
      actions: ['send unequip to tool', 'send tool unequipped to parent'],
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
      actions: 'clear draft entities',
      description: 'Clears the draft entities tracking',
    },
    'delete draft entities': {
      actions: 'delete draft entities',
      description:
        'Deletes the currently tracked draft entities (e.g., when user cancels with escape)',
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
            segments: context.selectedIds,
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
    Distance: {
      actions: async ({ self, context }) => {
        // TODO this is not how coincident should operate long term, as it should be an equipable tool
        let segmentsToConstrain = context.selectedIds
        if (segmentsToConstrain.length === 1) {
          const first =
            context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[
              segmentsToConstrain[0]
            ]
          if (
            first?.kind?.type === 'Segment' &&
            first?.kind?.segment?.type === 'Line'
          ) {
            segmentsToConstrain = [
              first.kind.segment.start,
              first.kind.segment.end,
            ]
          }
        }
        const currentSelections = segmentsToConstrain
          .map(
            (id) =>
              context.sketchExecOutcome?.sceneGraphDelta.new_graph.objects[id]
          )
          .filter(Boolean)
        let distance = 5
        const units = baseUnitToNumericSuffix(
          context.kclManager.fileSettings.defaultLengthUnit
        )
        // Calculate distance between two points if both are point segments
        if (currentSelections.length === 2) {
          const first = currentSelections[0]
          const second = currentSelections[1]
          if (
            first?.kind?.type === 'Segment' &&
            first?.kind.segment?.type === 'Point' &&
            second?.kind?.type === 'Segment' &&
            second?.kind.segment?.type === 'Point'
          ) {
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
            const distanceResult = distanceBetweenPoint2DExpr(point1, point2)
            if (!(distanceResult instanceof Error)) {
              distance = roundOff(distanceResult.distance)
            }
          }
        }
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
          {
            type: 'Distance',
            distance: { value: distance, units },
            points: segmentsToConstrain,
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
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
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
        const result = await context.rustContext.addConstraint(
          0,
          context.sketchId,
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
          result = await context.rustContext.addConstraint(
            0,
            context.sketchId,
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
          result = await context.rustContext.addConstraint(
            0,
            context.sketchId,
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
    'delete selected': {
      actions: async ({ self, context }) => {
        const selectedIds = context.selectedIds

        // Only proceed if there are selected IDs
        if (selectedIds.length === 0) {
          return
        }

        // Call deleteObjects with the selected segment IDs
        const result = await context.rustContext
          .deleteObjects(
            0,
            context.sketchId,
            [],
            selectedIds,
            await jsAppSettings()
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
            data: result,
          })
        }
      },
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
        id: 'deleteDraftEntitiesOnExit',
        src: 'deleteDraftEntitiesOnExit',
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
    'initialize intersection plane',
    'initialize initial scene graph',
    'setUpOnDragAndSelectionClickCallbacks',
  ],
})
