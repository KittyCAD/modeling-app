import {
  isSketchSolveErrorOutput,
  toastSketchSolveError,
} from '@src/machines/sketchSolve/sketchSolveErrors'
import type { ToolInput } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  addFirstSegmentListener,
  addRadiusListener,
  addSecondSegmentListener,
  createFilletArcActor,
  finalizeFilletActor,
  removeFilletListeners,
  sendResultToParent,
  storeConfirmedGeometry,
  storeCreatedFilletArc,
  storeFirstSegment,
  storeInitialFirstSegment,
  storeInitialSelection,
  storeSelectedPair,
  type ToolContext,
  type ToolEvents,
  tryResolveInitialFirstSegment,
  tryResolveInitialSelection,
} from '@src/machines/sketchSolve/tools/filletToolImpl'
import { assertEvent, assign, fromPromise, setup } from 'xstate'

export const toolId = 'Fillet tool'

export const machine = setup({
  types: {
    context: {} as ToolContext,
    events: {} as ToolEvents,
    input: {} as ToolInput,
  },
  guards: {
    'invoke output has error': ({ event }) =>
      'output' in event && isSketchSolveErrorOutput(event.output),
    'has valid initial selection': ({ context }) =>
      tryResolveInitialSelection(context) !== null,
    'has initial first segment': ({ context }) =>
      tryResolveInitialFirstSegment(context) !== null,
  },
  actions: {
    'add first segment listener': addFirstSegmentListener,
    'add second segment listener': addSecondSegmentListener,
    'add radius listener': addRadiusListener,
    'remove fillet listeners': removeFilletListeners,
    'send result to parent': sendResultToParent,
    'store confirmed geometry': assign(storeConfirmedGeometry),
    'store created fillet arc': assign(storeCreatedFilletArc),
    'store first segment': assign(storeFirstSegment),
    'store initial first segment': assign(storeInitialFirstSegment),
    'store initial selection': assign(storeInitialSelection),
    'store selected pair': assign(storeSelectedPair),
    'toast sketch solve error': ({ event }) => {
      toastSketchSolveError(event)
    },
  },
  actors: {
    createFilletArc: fromPromise(createFilletArcActor),
    finalizeFillet: fromPromise(finalizeFilletActor),
  },
}).createMachine({
  id: toolId,
  description:
    'Creates a real tangent arc between two adjacent sketch segments',
  context: ({ input }): ToolContext => ({
    sceneInfra: input.sceneInfra,
    rustContext: input.rustContext,
    kclManager: input.kclManager,
    sketchId: input.sketchId || 0,
    initialSelectionIds: input.initialSelectionIds,
    initialObjects: input.initialObjects,
  }),
  initial: 'checking initial selection',
  on: {
    unequip: {
      target: '.unequipping',
    },
  },
  states: {
    'checking initial selection': {
      always: [
        {
          guard: 'has valid initial selection',
          target: 'Creating fillet arc',
          actions: 'store initial selection',
        },
        {
          guard: 'has initial first segment',
          target: 'ready for second segment',
          actions: 'store initial first segment',
        },
        {
          target: 'ready for first segment',
        },
      ],
    },

    'ready for first segment': {
      entry: 'add first segment listener',
      on: {
        'select first segment': {
          target: 'ready for second segment',
          actions: 'store first segment',
        },
        escape: {
          target: 'unequipping',
        },
      },
    },

    'ready for second segment': {
      entry: 'add second segment listener',
      on: {
        'select fillet pair': {
          target: 'Creating fillet arc',
          actions: 'store selected pair',
        },
        escape: {
          target: 'ready for first segment',
          actions: assign({
            firstSegmentId: undefined,
          }),
        },
      },
    },

    'Creating fillet arc': {
      invoke: {
        src: 'createFilletArc',
        input: ({ context }) => {
          if (!context.selection) {
            return { error: 'Select two adjacent line or arc segments' }
          }
          return {
            selection: context.selection,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: [
          {
            guard: 'invoke output has error',
            target: 'ready for first segment',
            actions: 'toast sketch solve error',
          },
          {
            target: 'Choosing radius',
            actions: ['send result to parent', 'store created fillet arc'],
          },
        ],
        onError: {
          target: 'ready for first segment',
          actions: 'toast sketch solve error',
        },
      },
    },

    'Choosing radius': {
      entry: 'add radius listener',
      exit: 'remove fillet listeners',
      on: {
        'confirm fillet radius': {
          target: 'Finalizing fillet',
          actions: 'store confirmed geometry',
        },
        escape: {
          target: 'unequipping',
        },
      },
    },

    'Finalizing fillet': {
      invoke: {
        src: 'finalizeFillet',
        input: ({ context, event }) => {
          assertEvent(event, 'confirm fillet radius')
          if (!context.selection || !context.draft) {
            return { error: 'Fillet selection and preview arc are required' }
          }
          return {
            selection: context.selection,
            geometry: event.data,
            draft: context.draft,
            rustContext: context.rustContext,
            kclManager: context.kclManager,
            sketchId: context.sketchId,
          }
        },
        onDone: [
          {
            guard: 'invoke output has error',
            target: 'Choosing radius',
            actions: 'toast sketch solve error',
          },
          {
            target: 'ready for first segment',
            actions: [
              'send result to parent',
              ({ self }) => {
                self._parent?.send({ type: 'clear draft entities' })
                self._parent?.send({
                  type: 'update selected ids',
                  data: { selectedIds: [], duringAreaSelectIds: [] },
                })
              },
              assign({
                firstSegmentId: undefined,
                selection: undefined,
                currentGeometry: undefined,
                draft: undefined,
              }),
            ],
          },
        ],
        onError: {
          target: 'Choosing radius',
          actions: 'toast sketch solve error',
        },
      },
    },

    unequipping: {
      type: 'final',
      entry: [
        'remove fillet listeners',
        ({ self }) => {
          self._parent?.send({ type: 'delete draft entities' })
        },
      ],
    },
  },
})
