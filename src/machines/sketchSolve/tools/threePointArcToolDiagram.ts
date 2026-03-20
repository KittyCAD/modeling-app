import { assertEvent, assign, fromPromise, setup } from 'xstate'

import type {
  SketchSolveMachineEvent,
  ToolInput,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  type TOOL_ID,
  type ToolContext,
  type ToolEvents,
  addDraftPointActor,
  addFirstPointListener,
  addSecondPointListener,
  animateArcEndPointListener,
  createArcActor,
  finalizeArcActor,
  removePointListener,
  sendResultToParent,
  storeCreatedArcResult,
  storeFirstPointResult,
  storeSecondPointResult,
} from '@src/machines/sketchSolve/tools/threePointArcToolImpl'

export const toolId: typeof TOOL_ID = 'Three-point arc tool'

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as ToolInput,
  },
  actions: {
    'add first point listener': addFirstPointListener,
    'add second point listener': addSecondPointListener,
    'animate arc end point listener': animateArcEndPointListener,
    'remove point listener': removePointListener,
    'send result to parent': sendResultToParent,
    'store first point result': assign(storeFirstPointResult),
    'store second point result': assign(storeSecondPointResult),
    'store created arc result': assign(storeCreatedArcResult),
  },
  actors: {
    addDraftPoint: fromPromise(addDraftPointActor),
    createArc: fromPromise(createArcActor),
    finalizeArc: fromPromise(finalizeArcActor),
  },
}).createMachine({
  context: ({ input }): ToolContext => ({
    startPoint: undefined,
    startPointId: undefined,
    throughPoint: undefined,
    throughPointId: undefined,
    arcId: undefined,
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId || 0,
  }),
  id: toolId,
  initial: 'ready for first point click',
  on: {
    unequip: {
      target: `#Three-point arc tool.unequipping`,
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
  },
  description: 'Creates an arc from start point, through point, and end point',
  states: {
    'ready for first point click': {
      entry: 'add first point listener',
      on: {
        'add point': {
          target: 'Adding first point',
          guard: ({ event }) => {
            if (event.type !== 'add point') return false
            return 'clickNumber' in event && event.clickNumber === 1
          },
        },
        escape: {
          target: 'unequipping',
        },
      },
    },

    'Adding first point': {
      invoke: {
        src: 'addDraftPoint',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            point: event.data,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          target: 'ready for second point click',
          actions: ['send result to parent', 'store first point result'],
        },
        onError: 'ready for first point click',
      },
    },

    'ready for second point click': {
      entry: 'add second point listener',
      on: {
        'add point': {
          target: 'Adding second point',
          guard: ({ event }) => {
            if (event.type !== 'add point') return false
            return 'clickNumber' in event && event.clickNumber === 2
          },
        },
        escape: {
          target: 'unequipping',
        },
      },
    },

    'Adding second point': {
      invoke: {
        src: 'addDraftPoint',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          return {
            point: event.data,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          target: 'Creating arc',
          actions: ['send result to parent', 'store second point result'],
        },
        onError: 'ready for second point click',
      },
    },

    'Creating arc': {
      invoke: {
        src: 'createArc',
        input: ({ context }) => {
          if (!context.startPoint || !context.throughPoint) {
            return { error: 'Start point and through point must be set' }
          }
          return {
            startPoint: context.startPoint,
            throughPoint: context.throughPoint,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          target: 'Animating arc',
          actions: ['send result to parent', 'store created arc result'],
        },
        onError: 'ready for second point click',
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
            return 'clickNumber' in event && event.clickNumber === 3
          },
        },
        escape: {
          target: 'unequipping',
        },
        unequip: {
          target: 'unequipping',
        },
      },
    },

    'Finalizing arc': {
      invoke: {
        src: 'finalizeArc',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          if (
            !context.arcId ||
            !context.startPoint ||
            !context.throughPoint ||
            context.throughPointId === undefined
          ) {
            return {
              error:
                'Arc, start point, and through point must be set before finalizing',
            }
          }
          return {
            arcId: context.arcId,
            startPoint: context.startPoint,
            startPointId: context.startPointId,
            throughPoint: context.throughPoint,
            throughPointId: context.throughPointId,
            endPoint: event.data,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          target: 'ready for first point click',
          actions: [
            'send result to parent',
            ({ self }) => {
              const sendData: SketchSolveMachineEvent = {
                type: 'clear draft entities',
              }
              self._parent?.send(sendData)
            },
            assign({
              startPoint: undefined,
              startPointId: undefined,
              throughPoint: undefined,
              throughPointId: undefined,
              arcId: undefined,
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
            type: 'delete draft entities',
          }
          self._parent?.send(sendData)
        },
      ],
      description: 'Any teardown logic should go here.',
    },
  },
})
