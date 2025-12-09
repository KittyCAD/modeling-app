import {
  assertEvent,
  assign,
  createMachine,
  sendParent,
  sendTo,
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
  CHILD_TOOL_ID,
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
    'send unequip to tool': sendTo(CHILD_TOOL_ID, { type: 'unequip' }),
    'send escape to tool': sendTo(CHILD_TOOL_ID, { type: 'escape' }),
    'store pending tool': assign(({ event }) => {
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
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiMADwEsMBtABgF1FQAHQrFbNCAO14hGiAMwcAjAA4AdAHYALADYVC6WoCcshQCYANCACeiORxVK5BhWo4KVclTelGAvl7NpMuAQk5FQ09ACufBAAhhgUsGDEYFgYIqKcPEggAkKpYhJSCHIactJKegCsehyaVRUV0hoKZpYIALRqRrZyFUZGpcVVnpU+fujY+ERkFNS0dJExcXiw44GE4diEALZgGRI5wvlZhUYcGhxKagoVJerujSrSLYgdRmpKGkZ6JW86FdoaUYgfwTILTUJzBIYPAQABO0QAZtCwKJUqk4Hssgc8uJjlY9Co9OUSucmqUjNdnu1PrZruc1NIGmpmW8gSDAlMQrN6FgktFYTD4Ui8Ci0cwMdx9oJDrjQIUBmUjJ41Co+iqevoqW1pHp3oyul8SjViio2atJsEZmE6LQkks4YjkajhBLMvxpTiCogvtolDdHDrjBxpJ4tZ13p9vnJfoyAWaAhbwdyGLAsNE+LtJViPWkvQgjBU1BUlJ5ekYNAYugSVGGaqpnM4FKUVBpOiH46DOVa5lhCMxRFhmLRUZj3blc3iEMy5HIlEqODVvl9dXoqXoC0obE4KsZrNIeoDfMDzWCudaACLMWAYaIDzNu7I5o5ymStokEs6KVUDNcbrccHd+mDHoKg7DlLQhegAAV+WiYgkmIUdH3HZ9JBkXplBqCsGQAkMdTUX9i3-QC9xAsDEzPOYABl+zgABRABHcI4KolEoAwHAkOxCcXynfpZ30Cl1BDToukIzd1AA3dgJucjT27egADUwFhVI00QrMxxlPMnAMOxmyuQspIIixEHXIjJJImTDzGBN5MgugAAlCFhZgAC8xBvDSH241DCh1f45yLIt90+Dhqg0cTiOk-d6jkrsHIWWJ4kSZI4ggPAh1gLin1lNCig0JolCDasFF3VVV1M6keg+FQKmNdwDC0PR4og5NbUwFKkhSSAcpQvL-MJWdnBVBk5AZT45CiyyYoPVqkzCJQtkIEJbwyhJuowG0xDAJR+1IQh0CWlawAAFUIEg+u0ycCxsS5-gqexCQZR6TNaPQiULV6mmucbrlNI92QohTjtW0R1tSlIGFhWEXKUPhiFiBEXK2UGzou7ypX6vNbuUaMmpE7RnAqKlxo0Ow-gpddyyLOR5so3blrBiHNoYJjmD4PAMAxq7PUnclhuE9RmQJNQeipNUPmkR5vkZRd+gB2zOzaxamYoNblkhra4DTDNeZ4-L+gUC5y0Kws3Eer4qU+MoNGkHRdTqQwFHpkHwiEUQoC5jH5lEMB2c57nLs05Drt4voqhLGdehVPQZw4JUqUaYsQ0cBQK3ClrAZPBLuSUd3+y9oPiDZ8IOe94OfNynGCyJfcejeIa9ypK5Z0Kilen3dxNDUV3IPzj2i59nX03vLGw8N+xlALT5LYZWmSaq43lFcOPSh3XV9F77O7NzxamGET28AAd1YfBeTAW9Im2v29tEA6jo6uJzyFDA6OddFYAAeVEOiWHYEOvkBpWGNkYcoMtPAlH0GcRerQWzvEemVNeqdHp9zzgfVIR9T4cTwBfK+fBoaw1hPDRGGBkawlRk-MAL9HTvzFHAH+f9WD6z8iAhO4CdSQPGhFWBiB07KDKroCs9twr9GkGg-e-9C4nzPrgvkohr5UMFI6EUH9xTZUAdXfmoCOGVigTwtcjwgrGxVDSD6xQfBHlEGEeAWQgb2W5OPPmvEZyfHKLqFQLZow2EKlqdOfpCrG0jJNPo4id7KwWrQNGeANYbTSk4g28odzTxcPoFsxs9BlV4UUUoATSi6gUJk9QGgdwSKiQXI+xcEmsIKmcOcnjwqjQMDOJO9gSyfnLH0LohTCxlN2rAbBuBpFVOzNjG6FVNx9HUFUYS9saxVX0ESOq0Z6rpy+F0RkfSlAYOkdg8+8jIjVOAUUIC7iVReNOC2SKS9Gh+kUIUmcKC6bhPApE3aOzPZHJxhWWw6pejyA1I0Um1gPgAR9OGRQpwbLHl3ircpfsA58GGRjL54yvj6UZIZMsGyk4lICZ8achYdBhJ8EAA */
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
            points: context.selectedIds,
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
          actions: ['send tool unequipped to parent'],
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
        // We override the default `delete draft entities` action with a no-op here
        // because the async invoke above is already performing that cleanup.
        'delete draft entities': {
          actions: [],
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
          actions: ['send tool unequipped to parent'],
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
