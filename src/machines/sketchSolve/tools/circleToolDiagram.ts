import { assertEvent, assign, fromPromise, setup } from 'xstate'

import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import {
  isSketchSolveErrorOutput,
  toastSketchSolveError,
} from '@src/machines/sketchSolve/sketchSolveErrors'
import type { ToolInput } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  type SHOWING_RADIUS_PREVIEW,
  type TOOL_ID,
  type ToolContext,
  type ToolEvents,
  addPointListener,
  createCircleActor,
  removePointListener,
  sendResultToParent,
  showRadiusPreviewListener,
} from '@src/machines/sketchSolve/tools/circleToolImpl'

export const toolId: typeof TOOL_ID = 'Circle tool'

export const showingRadiusPreview: typeof SHOWING_RADIUS_PREVIEW =
  'Showing radius preview'

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as ToolInput,
  },
  guards: {
    'invoke output has error': ({ event }) =>
      'output' in event && isSketchSolveErrorOutput(event.output),
  },
  actions: {
    'show radius preview listener': showRadiusPreviewListener,
    'add point listener': addPointListener,
    'remove point listener': removePointListener,
    'send result to parent': assign(sendResultToParent),
    'toast sketch solve error': ({ event }) => {
      toastSketchSolveError(event)
    },
  },
  actors: {
    createCircle: fromPromise(createCircleActor),
    finishPreview: fromPromise(async ({ input }: { input: ToolContext }) => {
      await input.preview?.pending
    }),
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
      always: {
        guard: ({ context }) => Boolean(context.unequipRequested),
        target: 'unequipping',
      },
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
              preview: {
                active: true,
                pending: Promise.resolve(),
                segmentIds: [],
              },
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
      always: {
        guard: ({ context }) => Boolean(context.unequipRequested),
        target: 'unequipping',
      },
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
      // Let the final mutation finish before deleting or unequipping its draft.
      on: {
        unequip: { actions: assign({ unequipRequested: true }) },
        escape: { actions: assign({ unequipRequested: true }) },
      },
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
            circleId: context.preview?.circleId,
            centerSnapTarget:
              context.preview?.circleId === undefined
                ? context.centerSnapTarget
                : undefined,
            startSnapTarget: event.snapTarget,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: [
          {
            guard: 'invoke output has error',
            target: showingRadiusPreview,
            actions: 'toast sketch solve error',
          },
          {
            target: 'ready for center click',
            actions: [
              'send result to parent',
              ({ self }) =>
                self._parent?.send({ type: 'clear draft entities' }),
              assign({
                centerPoint: undefined,
                centerPointId: undefined,
                centerSnapTarget: undefined,
                circleId: undefined,
                preview: undefined,
              }),
            ],
          },
        ],
        onError: {
          target: showingRadiusPreview,
          actions: 'toast sketch solve error',
        },
      },
    },

    done: { type: 'final' },
    unequipping: {
      entry: ['remove point listener'],
      invoke: {
        src: 'finishPreview',
        input: ({ context }) => context,
        onDone: {
          target: 'done',
          actions: ({ self }) =>
            self._parent?.send({ type: 'delete draft entities' }),
        },
      },
      description: 'Any teardown logic should go here.',
    },
  },
})
