import { assertEvent, assign, fromPromise, setup } from 'xstate'

import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  type ToolEvents,
  type ToolContext,
  type TOOL_ID,
  type SHOWING_RADIUS_PREVIEW,
  showRadiusPreviewListener,
  addPointListener,
  removePointListener,
  sendResultToParent,
  createCircleActor,
} from '@src/machines/sketchSolve/tools/circleToolImpl'
import type { ToolInput } from '@src/machines/sketchSolve/sketchSolveImpl'

export const toolId: typeof TOOL_ID = 'Circle tool'

export const showingRadiusPreview: typeof SHOWING_RADIUS_PREVIEW =
  'Showing radius preview'

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as ToolInput,
  },
  actions: {
    'show radius preview listener': showRadiusPreviewListener,
    'add point listener': addPointListener,
    'remove point listener': removePointListener,
    'send result to parent': assign(sendResultToParent),
  },
  actors: {
    createCircle: fromPromise(createCircleActor),
  },
}).createMachine({
  context: ({ input }): ToolContext => ({
    centerPointId: undefined,
    centerPoint: undefined,
    centerSnapTarget: undefined,
    circleId: undefined,
    sceneGraphDelta: {} as SceneGraphDelta,
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId || 0,
  }),
  id: toolId,
  initial: 'ready for center click',
  on: {
    unequip: {
      target: `#Circle tool.unequipping`,
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
  },
  description: 'Creates a circle by center and radius',
  states: {
    'ready for center click': {
      entry: 'add point listener',
      on: {
        'add point': {
          target: showingRadiusPreview,
          guard: ({ event }) => {
            if (event.type !== 'add point') return false
            return 'clickNumber' in event
              ? event.clickNumber === 1 || !event.clickNumber
              : true
          },
          actions: assign(({ event }) => {
            assertEvent(event, 'add point')
            return {
              centerPoint: event.data,
              centerSnapTarget: event.snapTarget,
            }
          }),
        },
        escape: {
          target: 'unequipping',
        },
      },
    },

    [showingRadiusPreview]: {
      entry: 'show radius preview listener',
      exit: 'remove point listener',
      on: {
        'add point': {
          target: 'Creating circle',
          guard: ({ event }) => {
            if (event.type !== 'add point') return false
            return 'clickNumber' in event ? event.clickNumber === 2 : false
          },
        },
        escape: {
          target: 'unequipping',
        },
      },
    },

    'Creating circle': {
      invoke: {
        src: 'createCircle',
        input: ({ event, context }) => {
          assertEvent(event, 'add point')
          if (!context.centerPoint) {
            return {
              error: 'Center point not set',
            }
          }
          return {
            centerPoint: context.centerPoint,
            startPoint: event.data,
            centerSnapTarget: context.centerSnapTarget,
            startSnapTarget: event.snapTarget,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: {
          target: 'ready for center click',
          actions: [
            'send result to parent',
            assign({
              centerPoint: undefined,
              centerPointId: undefined,
              centerSnapTarget: undefined,
              circleId: undefined,
            }),
          ],
        },
        onError: showingRadiusPreview,
      },
    },

    unequipping: {
      type: 'final',
      entry: ['remove point listener'],
      description: 'Any teardown logic should go here.',
    },
  },
})
