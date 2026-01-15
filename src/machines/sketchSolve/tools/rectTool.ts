import type { ProvidedActor, AssignArgs } from 'xstate'
import { createMachine, setup, fromPromise, assertEvent, assign } from 'xstate'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'
import type {
  SourceDelta,
  SceneGraphDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { ToolInput } from '@src/machines/sketchSolve/sketchSolveImpl'

import type { RectDraftIds } from '@src/machines/sketchSolve/tools/rectUtils'
import {
  createDraftRectangle,
  updateDraftRectangle,
} from '@src/machines/sketchSolve/tools/rectUtils'
import type { Coords2d } from '@src/lang/util'

export const RECTANGLE_TOOL_ID = 'Rectangle tool'
export const ADDING_FIRST_POINT = `xstate.done.actor.0.${RECTANGLE_TOOL_ID}.adding first point`
export type RectOriginMode = 'corner' | 'center'
export type CenterRectToolEvent =
  | BaseToolEvent
  | { type: 'finalize' }
  | {
      type: typeof ADDING_FIRST_POINT
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        draft: RectDraftIds
      }
    }

type CenterRectToolContext = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  firstPointId?: number
  draft?: RectDraftIds
  origin: Coords2d
  rectOriginMode: RectOriginMode
}

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
    input: {} as ToolInput,
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
          if (!args || !context.draft) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD && !isEditInProgress) {
            try {
              isEditInProgress = true

              const start = context.origin
              const end = [twoD.x, twoD.y]

              const min: Coords2d = [
                Math.min(start[0], end[0]),
                Math.min(start[1], end[1]),
              ]
              const max: Coords2d = [
                Math.max(start[0], end[0]),
                Math.max(start[1], end[1]),
              ]

              if (context.rectOriginMode === 'center') {
                const size = [max[0] - min[0], max[1] - min[1]]
                min[0] = start[0] - size[0]
                min[1] = start[1] - size[1]
                max[0] = min[0] + size[0] * 2
                max[1] = min[1] + size[1] * 2
              }

              const result = await updateDraftRectangle({
                rustContext: context.rustContext,
                kclManager: context.kclManager,
                sketchId: context.sketchId,
                draft: context.draft,
                rect: { min, max },
              })

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
          // const twoD = args.intersectionPoint?.twoD
          // if (!twoD) return
          self.send({
            type: 'finalize',
          })
        },
      })
    },
    'send result to parent': assign(
      ({ event, self }: CenterRectToolAssignArgs) => {
        if (event.type !== ADDING_FIRST_POINT) {
          return {}
        }

        const output = event.output

        self._parent?.send({
          type: 'set draft entities',
          data: {
            // Only setting line ids instead of segmentIds
            segmentIds: output.draft.segmentIds,
            constraintIds: output.draft.constraintIds,
          },
        })

        return {
          draft: output.draft,
        }
      }
    ),
    'delete draft entities': ({ self }) => {
      self._parent?.send({ type: 'delete draft entities' })
    },
    'remove point listener': ({ context }) => {
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
          origin: [number, number]
        }
      }) => {
        const { rustContext, kclManager, sketchId } = input

        try {
          const result = await createDraftRectangle({
            rustContext,
            kclManager,
            sketchId,
          })

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
    origin: [0, 0],
    rectOriginMode: (input.toolVariant ?? 'corner') as RectOriginMode,
  }),
  id: RECTANGLE_TOOL_ID,
  initial: 'awaiting first point',
  on: {
    unequip: {
      target: `#${RECTANGLE_TOOL_ID}.unequipping`,
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
    escape: {
      target: `#${RECTANGLE_TOOL_ID}.unequipping`,
      description: 'ESC unequips the tool',
    },
  },
  description:
    'Creates a rectangle based on two points from the user. Can be configured to interpret the first point as either a corner or the center.',
  states: {
    'awaiting first point': {
      entry: 'add first point listener',
      on: {
        'add point': {
          actions: assign(({ event }) => {
            return {
              origin: event.data,
            }
          }),
          target: 'adding first point',
        },
      },
    },
    'adding first point': {
      invoke: {
        src: 'modAndSolveFirstClick',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            pointData: event.data,
            origin: context.origin,
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
        // 'add point': {
        //   target: 'Confirming dimensions',
        // },
        finalize: {
          actions: [
            ({ self }) => {
              self._parent?.send({ type: 'clear draft entities' })
            },
            assign({
              origin: [0, 0],
              draft: undefined,
            }),
          ],
          target: 'awaiting first point',
        },
        escape: {
          target: 'delete draft entities',
        },
      },
      entry: 'add second point listener',
      exit: 'remove point listener',
    },
    'delete draft entities': {
      entry: ({ self }) => {
        self._parent?.send({ type: 'delete draft entities' })
      },
      always: {
        target: 'awaiting first point',
        actions: assign({
          origin: [0, 0],
          draft: undefined,
        }),
      },
    },
    // 'Confirming dimensions': {
    //   invoke: {
    //     input: {},
    //     onDone: {
    //       target: 'unequipping',
    //     },
    //     onError: {
    //       target: 'unequipping',
    //     },
    //     src: 'askUserForDimensionValues',
    //   },
    //   description:
    //     'Show the user form fields for the width and height of the rectangle, allowing them to input values directly. This will add dimension-type constraints for either of the fields that are filled out.',
    // },
    unequipping: {
      type: 'final',
      entry: 'remove point listener',
      description: 'Any teardown logic should go here.',
    },
  },
})
