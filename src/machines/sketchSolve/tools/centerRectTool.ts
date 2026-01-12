import type { ProvidedActor, AssignArgs } from 'xstate'
import { createMachine, setup, fromPromise, assertEvent, assign } from 'xstate'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'
import type {
  SegmentCtor,
  SourceDelta,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { baseUnitToNumericSuffix } from '@src/lang/wasm'
import { roundOff } from '@src/lib/utils'

export const TOOL_ID = 'Center Rectangle tool'
export const ADDING_POINT = `xstate.done.actor.0.${TOOL_ID}.Adding first point`
export type CenterRectToolEvent =
  | BaseToolEvent
  | {
      type: typeof ADDING_POINT
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      }
    }

type CenterRectToolContext = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  draftPointId?: number
}

//type ToolActionArgs = ActionArgs<ToolContext, ToolEvents, ToolEvents>

type CenterRectToolAssignArgs<TActor extends ProvidedActor = any> = AssignArgs<
  CenterRectToolContext,
  CenterRectToolEvent,
  CenterRectToolEvent,
  TActor
>

export const machine = setup({
  types: {
    context: {} as CenterRectToolContext,
    events: {} as CenterRectToolEvent,
    input: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
    },
  },
  actions: {
    'add first point listener': ({ self, context }) => {
      context.sceneInfra.setCallbacks({
        onMove: () => {},
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (!twoD) return
          self.send({
            type: 'add point',
            data: [twoD.x, twoD.y],
          })
        },
      })
    },
    'add second point listener': ({ self, context }) => {
      let isEditInProgress = false
      context.sceneInfra.setCallbacks({
        onMove: async (args) => {
          if (!args || !context.draftPointId) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD && !isEditInProgress) {
            // Send the add point event with the clicked coordinates

            const units = baseUnitToNumericSuffix(
              context.kclManager.fileSettings.defaultLengthUnit
            )
            try {
              isEditInProgress = true
              const settings = await jsAppSettings(
                context.rustContext.settingsActor
              )
              // Note: twoD comes from intersectionPoint.unscaledTwoD which is in world coordinates, and always mm
              const result = await context.rustContext.editSegments(
                0,
                context.sketchId,
                [
                  {
                    id: context.draftPointId,
                    ctor: {
                      type: 'Point',
                      position: {
                        x: {
                          type: 'Var',
                          value: roundOff(twoD.x),
                          units,
                        },
                        y: {
                          type: 'Var',
                          value: roundOff(twoD.y),
                          units,
                        },
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
              await new Promise((resolve) => requestAnimationFrame(resolve))
            } catch (err) {
              console.error('failed to edit segment', err)
            } finally {
              isEditInProgress = false
            }
          }
        },
        onClick: (args) => {
          if (!args) return
          if (args.mouseEvent.which !== 1) return
          const twoD = args.intersectionPoint?.twoD
          if (!twoD) return
        },
      })
    },
    'send result to parent': assign(
      ({ event, self }: CenterRectToolAssignArgs) => {
        if (
          event.type !==
          'xstate.done.actor.0.Center Rectangle tool.Adding first point'
        ) {
          return {}
        }

        const output = event.output

        // Find the 2 points for the line we just added
        const pointIds =
          output.sceneGraphDelta?.new_objects.filter((objId) => {
            const obj = output.sceneGraphDelta.new_graph.objects[objId]
            if (!obj) return false
            return (
              obj.kind.type === 'Segment' && obj.kind.segment.type === 'Point'
            )
          }) || []

        // Find the line segment to get its end point ID
        const lineId = [...(output.sceneGraphDelta?.new_objects || [])]
          .reverse()
          .find((objId) => {
            const obj = output.sceneGraphDelta.new_graph.objects[objId]
            if (!obj) return false
            return (
              obj.kind.type === 'Segment' && obj.kind.segment.type === 'Line'
            )
          })

        // Track entities created in first point creation for potential deletion on unequip
        const entitiesToTrack: {
          segmentIds: Array<number>
          constraintIds: Array<number>
        } = {
          segmentIds: [],
          constraintIds: [],
        }

        // Add point IDs and line ID to tracking
        if (pointIds.length > 0 && output.sceneGraphDelta) {
          entitiesToTrack.segmentIds.push(...pointIds)
        }
        if (lineId !== undefined) {
          entitiesToTrack.segmentIds.push(lineId)
        }

        // Send draft entities to parent for tracking
        if (entitiesToTrack.segmentIds.length > 0) {
          self._parent?.send({
            type: 'set draft entities',
            data: entitiesToTrack,
          })
        }

        const pointId = pointIds[pointIds.length - 1]

        if (pointId !== undefined && output.sceneGraphDelta) {
          return {
            draftPointId: pointId,
            // lastLineEndPointId,
            //sceneGraphDelta: output.sceneGraphDelta,
          }
        }

        return {}
      }
    ),
    'show draft geometry': () => {
      console.log('show draft geometry')
      // Add your action code here
      // ...
    },
    'remove point listener': ({ context }) => {
      console.log('remove point listener')
      context.sceneInfra.setCallbacks({
        onClick: () => {},
        onMove: () => {},
      })
    },
  },
  actors: {
    modAndSolveFirstClick: fromPromise(
      async ({
        input,
      }: {
        input: {
          pointData: [number, number]
          rustContext: RustContext
          kclManager: KclManager
          sketchId: number
        }
      }) => {
        const { pointData, rustContext, kclManager, sketchId } = input
        const [x, y] = pointData

        const units = baseUnitToNumericSuffix(
          kclManager.fileSettings.defaultLengthUnit
        )

        try {
          // Note: x and y come from intersectionPoint.twoD which is in world coordinates, and scaled to units
          // we're creating a line with the same start and end point initially
          // that's because we'll then 'animate' the line by moving the endpoint with the user's mouse
          const segmentCtor: SegmentCtor = {
            type: 'Line',
            start: {
              x: { type: 'Var', value: roundOff(x), units },
              y: { type: 'Var', value: roundOff(y), units },
            },
            end: {
              x: { type: 'Var', value: roundOff(x), units },
              y: { type: 'Var', value: roundOff(y), units },
            },
          }

          // Call the addSegment method using the rustContext from context
          const result = await rustContext.addSegment(
            0, // version - TODO: Get this from actual context
            sketchId, // sketchId from context
            segmentCtor,
            'line-segment', // label
            await jsAppSettings(rustContext.settingsActor)
          )

          return result
        } catch (error) {
          console.error('Failed to add point segment:', error)
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        }
      }
    ),
    askUserForDimensionValues: createMachine({
      /* ... */
    }),
  },
}).createMachine({
  context: ({ input }) => ({
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId,
  }),
  id: 'Center Rectangle tool',
  initial: 'awaiting first point',
  on: {
    unequip: {
      target: '#Center Rectangle tool.unequipping',
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
    escape: {
      target: '#Center Rectangle tool.unequipping',
      description: 'ESC unequips the tool',
    },
  },
  description:
    'Creates a rectangle based on two points from the user: the center point followed by a corner point.',
  states: {
    'awaiting first point': {
      entry: 'add first point listener',
      on: {
        'add point': {
          target: 'Adding first point',
        },
        // TODO escape
      },
    },
    'Adding first point': {
      invoke: {
        src: 'modAndSolveFirstClick',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            pointData: event.data,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          actions: 'send result to parent',
          target: 'awaiting second point',
        },
        onError: 'awaiting first point',
      },
    },
    'awaiting second point': {
      on: {
        'add point': {
          target: 'Confirming dimensions',
        },
      },
      entry: 'add second point listener',
      exit: 'remove point listener',
    },
    'Confirming dimensions': {
      invoke: {
        input: {},
        onDone: {
          target: 'unequipping',
        },
        onError: {
          target: 'unequipping',
        },
        src: 'askUserForDimensionValues',
      },
      description:
        'Show the user form fields for the width and height of the rectangle, allowing them to input values directly. This will add dimension-type constraints for either of the fields that are filled out.',
    },
    unequipping: {
      type: 'final',
      entry: 'remove point listener',
      description: 'Any teardown logic should go here.',
    },
  },
})
