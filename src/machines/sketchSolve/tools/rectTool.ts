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
import type {
  SketchSolveMachineEvent,
  ToolInput,
} from '@src/machines/sketchSolve/sketchSolveImpl'

import type { RectDraftIds } from '@src/machines/sketchSolve/tools/rectUtils'
import {
  createDraftRectangle,
  updateDraftRectangleAngled,
  updateDraftRectangleAligned,
} from '@src/machines/sketchSolve/tools/rectUtils'
import type { Coords2d } from '@src/lang/util'
import { pointsAreEqual } from '@src/lib/utils2d'

export const RECTANGLE_TOOL_ID = 'Rectangle tool'
export const ADDING_FIRST_POINT = `xstate.done.actor.0.${RECTANGLE_TOOL_ID}.adding first point`
export type RectOriginMode = 'corner' | 'center' | 'angled'
export type RectToolEvent =
  | BaseToolEvent
  | { type: 'finalize' }
  | {
      type: 'set second point'
      data: Coords2d
    }
  | {
      type: typeof ADDING_FIRST_POINT
      output: {
        kclSource: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        draft: RectDraftIds
      }
    }

type RectToolContext = {
  sceneInfra: SceneInfra
  rustContext: RustContext
  kclManager: KclManager
  sketchId: number
  firstPointId?: number
  draft?: RectDraftIds
  origin: Coords2d
  secondPoint?: Coords2d
  rectOriginMode: RectOriginMode
}

type RectToolAssignArgs<TActor extends ProvidedActor = any> = AssignArgs<
  RectToolContext,
  RectToolEvent,
  RectToolEvent,
  TActor
>

export const machine = setup({
  types: {
    context: {} as RectToolContext,
    events: {} as RectToolEvent,
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

              let result: {
                kclSource: SourceDelta
                sceneGraphDelta: SceneGraphDelta
              }

              if (context.rectOriginMode === 'angled') {
                result = await updateDraftRectangleAngled({
                  rustContext: context.rustContext,
                  kclManager: context.kclManager,
                  sketchId: context.sketchId,
                  draft: context.draft,
                  p1: context.origin,
                  p2: [twoD.x, twoD.y],
                  p3: [twoD.x, twoD.y], // no third click yet
                })
              } else {
                const start = context.origin
                const end: Coords2d = [twoD.x, twoD.y]

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

                result = await updateDraftRectangleAligned({
                  rustContext: context.rustContext,
                  kclManager: context.kclManager,
                  sketchId: context.sketchId,
                  draft: context.draft,
                  rect: { min, max },
                })
              }

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

          if (context.rectOriginMode === 'angled') {
            const twoD = args.intersectionPoint?.twoD
            if (!twoD) return
            self.send({
              type: 'set second point',
              data: [twoD.x, twoD.y],
            })
          } else {
            self.send({
              type: 'finalize',
            })
          }
        },
      })
    },
    'add third point listener': ({ self, context }) => {
      let isEditInProgress = false
      context.sceneInfra.setCallbacks({
        onMove: async (args) => {
          if (!args || !context.draft || !context.secondPoint) return
          const twoD = args.intersectionPoint?.twoD
          if (twoD && !isEditInProgress) {
            try {
              isEditInProgress = true
              const result = await updateDraftRectangleAngled({
                rustContext: context.rustContext,
                kclManager: context.kclManager,
                sketchId: context.sketchId,
                draft: context.draft,
                p1: context.origin,
                p2: context.secondPoint,
                p3: [twoD.x, twoD.y],
              })

              const sendData: SketchSolveMachineEvent = {
                type: 'update sketch outcome',
                data: {
                  sourceDelta: result.kclSource,
                  sceneGraphDelta: result.sceneGraphDelta,
                  writeToDisk: false,
                },
              }
              self._parent?.send(sendData)
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
          if (
            context.secondPoint &&
            pointsAreEqual(context.secondPoint, [twoD.x, twoD.y])
          ) {
            return
          }
          self.send({
            type: 'finalize',
          })
        },
      })
    },
    'send result to parent': assign(({ event, self }: RectToolAssignArgs) => {
      if (event.type !== ADDING_FIRST_POINT) {
        return {}
      }

      const output = event.output

      const sendData: SketchSolveMachineEvent = {
        type: 'set draft entities',
        data: {
          segmentIds: output.draft.segmentIds,
          constraintIds: output.draft.constraintIds,
        },
      }
      self._parent?.send(sendData)

      return {
        draft: output.draft,
      }
    }),
    'delete draft entities': ({ self }) => {
      const sendData: SketchSolveMachineEvent = {
        type: 'delete draft entities',
      }
      self._parent?.send(sendData)
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
          rectOriginMode: RectOriginMode
        }
      }) => {
        const { rustContext, kclManager, sketchId, rectOriginMode } = input

        try {
          const result = await createDraftRectangle({
            rustContext,
            kclManager,
            sketchId,
            mode: rectOriginMode,
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
    'Creates a rectangle from user clicks: corner/center use two points, angled uses three points.',
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
            rectOriginMode: context.rectOriginMode,
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
              const sendData: SketchSolveMachineEvent = {
                type: 'clear draft entities',
              }
              self._parent?.send(sendData)
            },
            assign({
              origin: [0, 0],
              secondPoint: undefined,
              draft: undefined,
            }),
          ],
          target: 'awaiting first point',
        },
        'set second point': {
          guard: ({ context, event }) => {
            if (context.rectOriginMode !== 'angled') return false
            if (event.type !== 'set second point') return false
            return !pointsAreEqual(context.origin, event.data)
          },
          actions: assign(({ event }) => {
            if (event.type !== 'set second point') return {}
            return {
              secondPoint: event.data,
            }
          }),
          target: 'awaiting third point',
        },
        escape: {
          target: 'delete draft entities',
        },
      },
      entry: 'add second point listener',
      exit: 'remove point listener',
    },
    'awaiting third point': {
      on: {
        finalize: {
          actions: [
            ({ self }) => {
              self._parent?.send({ type: 'clear draft entities' })
            },
            assign({
              origin: [0, 0],
              secondPoint: undefined,
              draft: undefined,
            }),
          ],
          target: 'awaiting first point',
        },
        escape: {
          target: 'delete draft entities',
        },
      },
      entry: 'add third point listener',
      exit: 'remove point listener',
    },
    'delete draft entities': {
      entry: ({ self }) => {
        const sendData: SketchSolveMachineEvent = {
          type: 'delete draft entities',
        }
        self._parent?.send(sendData)
      },
      always: {
        target: 'awaiting first point',
        actions: assign({
          origin: [0, 0],
          secondPoint: undefined,
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
