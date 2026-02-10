import { assertEvent, assign, fromPromise, setup } from 'xstate'

import type {
  SketchSolveMachineEvent,
  ToolInput,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  type TOOL_ID,
  type ToolContext,
  type ToolEvents,
  addPointListener,
  addTangentAnchorListener,
  animateArcEndPointListener,
  createArcActor,
  finalizeArcActor,
  removePointListener,
  sendResultToParent,
  storeCreatedArcResult,
} from '@src/machines/sketchSolve/tools/tangentialArcToolImpl'

export const toolId: typeof TOOL_ID = 'Tangential arc tool'

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as ToolInput,
  },
  actions: {
    'add tangent anchor listener': addTangentAnchorListener,
    'add point listener': addPointListener,
    'animate arc end point listener': animateArcEndPointListener,
    'remove point listener': removePointListener,
    'send result to parent': assign(sendResultToParent),
    'store created arc result': assign(storeCreatedArcResult),
  },
  actors: {
    createArc: fromPromise(createArcActor),
    finalizeArc: fromPromise(finalizeArcActor),
  },
}).createMachine({
  context: ({ input }): ToolContext => ({
    tangentInfo: undefined,
    arcId: undefined,
    arcStartPointId: undefined,
    arcEndPointId: undefined,
    sceneGraphDelta: undefined,
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId || 0,
  }),
  id: toolId,
  initial: 'ready for tangent anchor click',
  on: {
    unequip: {
      target: `#Tangential arc tool.unequipping`,
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
  },
  description: 'Creates an arc tangent to an existing line at a chosen endpoint',
  states: {
    'ready for tangent anchor click': {
      entry: 'add tangent anchor listener',
      on: {
        'select tangent anchor': {
          target: 'Creating arc',
          actions: assign(({ event }) => {
            assertEvent(event, 'select tangent anchor')
            return {
              tangentInfo: event.data,
            }
          }),
        },
        escape: {
          target: 'unequipping',
          description: 'ESC in ready state unequips the tool',
        },
      },
    },

    'Creating arc': {
      invoke: {
        src: 'createArc',
        input: ({ context }) => {
          if (!context.tangentInfo) {
            return {
              error: 'Tangent info must be set',
            }
          }
          return {
            tangentInfo: context.tangentInfo,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          target: 'Animating arc',
          actions: ['send result to parent', 'store created arc result'],
        },
        onError: 'ready for tangent anchor click',
      },
    },

    'Animating arc': {
      entry: 'animate arc end point listener',
      exit: 'remove point listener',
      on: {
        'add point': {
          target: 'Finalizing arc',
          guard: ({ event }) => {
            if (event.type !== 'add point') return false
            return 'clickNumber' in event && event.clickNumber === 2
          },
        },
        escape: {
          target: 'unequipping',
          actions: ({ self }) => {
            const sendData: SketchSolveMachineEvent = {
              type: 'delete draft entities',
            }
            self._parent?.send(sendData)
          },
        },
        unequip: {
          target: 'unequipping',
          actions: ({ self }) => {
            const sendData: SketchSolveMachineEvent = {
              type: 'delete draft entities',
            }
            self._parent?.send(sendData)
          },
        },
      },
    },

    'Finalizing arc': {
      invoke: {
        src: 'finalizeArc',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          if (!context.arcId || !context.tangentInfo) {
            return {
              error:
                'Arc id and tangent info must be set before finalizing',
            }
          }
          return {
            arcId: context.arcId,
            endPoint: event.data,
            tangentInfo: context.tangentInfo,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          target: 'ready for tangent anchor click',
          actions: [
            'send result to parent',
            ({ self }) => {
              const sendData: SketchSolveMachineEvent = {
                type: 'clear draft entities',
              }
              self._parent?.send(sendData)
            },
            assign({
              tangentInfo: undefined,
              arcId: undefined,
              arcStartPointId: undefined,
              arcEndPointId: undefined,
            }),
          ],
        },
        onError: 'Animating arc',
      },
    },

    unequipping: {
      type: 'final',
      entry: [
        'remove point listener',
        ({ self }) => {
          const sendData: SketchSolveMachineEvent = {
            type: 'clear draft entities',
          }
          self._parent?.send(sendData)
        },
      ],
      description: 'Any teardown logic should go here.',
    },
  },
})
