import { fromCallback, fromPromise, sendParent, setup } from 'xstate'
import type { ModelingMachineContext } from '@src/machines/modelingMachine'

export interface SketchSolveMachineContext {
  parentContext: ModelingMachineContext
  initialSketchDetails: ModelingMachineContext['sketchDetails']
}

export type SketchSolveMachineEvent =
  | {
      type: 'Change Tool'
      data:
        | {
            tool: 'select'
          }
        | {
            tool: 'create'
            kind: 'line' | 'arc' // TODO get types from rust
          }
        | {
            tool: 'action'
            kind: 'coincident' | 'equalLength' // TODO get types from rust
          }
    }
  | { type: 'drag-start' }
  | { type: 'drag-end' }
  | { type: 'exit sketch mode' }
  | { type: 'Add draft segment' }
  | { type: 'add draft points or selections' }
  | { type: 'take action' }
  | { type: 'update selection' }
  | { type: 'finalise segment' }

export const sketchSolveMachine = setup({
  types: {
    context: {} as SketchSolveMachineContext,
    events: {} as SketchSolveMachineEvent,
    input: {} as {
      parentContext: ModelingMachineContext
      initialSketchDetails: ModelingMachineContext['sketchDetails']
    },
  },
  actors: {
    dragAnimationActor: fromCallback(({ sendBack }) => {
      // sendBack({type: '...'})
    }),
    finalizeDrag: fromPromise(async () => {
      // Final drag cleanup/commit logic
    }),
    'adding-draft-segment': fromPromise(async () => {
      // Add draft segment logic
    }),
    'finalising-segment': fromPromise(async () => {
      // Finalize segment logic
    }),
    'take-action': fromPromise(async () => {
      // Take action logic
    }),
    'draft-animation-actor': fromCallback(({ sendBack }) => {
      // sendBack({type: '...'})
    }),
    'firing-action': fromPromise(async () => {
      // Firing action logic
    }),
  },
  guards: {
    'is create tool': ({ context }) => {
      // Add guard logic
      return true
    },
    'is action tool': ({ context }) => {
      // Add guard logic
      return true
    },
    'should action be taken': ({ context }) => {
      // Add guard logic
      return true
    },
    'can add draft': ({ context }) => {
      // Add guard logic for draft addition
      return true
    },
  },
  actions: {
    notifyParentOfDragEnd: sendParent({ type: 'drag-end' }),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiAYRwEMA7GPAFUJIG0AGALqJQAB0KwAlhkmFWIkAA9EARgCsAdgB0ANgCcAJgDMatXqN6AHGp0AaEAE9EAWiNHLWozst6N-fpY6ACy+BjoAvuH2aJi4BCTkVDT0YIrSeLDo2PgAtskCwkgg4lIycgrKCM5h-Fr8akFqgfwq-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-PRXwy+ZJQ1BUPrq+ohk+JeC+dyVarskxjDGDyfe-qBGMPJINNtz9egmhdMiOdocxgDogkO6pksx2NpZaAh6KTu4zukeo3QHsRjjAaCYKwtoLA7LMBYVCwQvkpkiJEIAA */
  id: 'Sketch Solve Mode',
  context: ({ input }) => ({
    parentContext: input.parentContext,
    initialSketchDetails: input.initialSketchDetails,
  }),
  on: {
    'Change Tool': '.equiping tool',
    'exit sketch mode': '#Sketch Solve Mode.exiting',
  },
  states: {
    init: {
      after: {
        '600': 'equiping tool',
      },
    },

    exiting: {
      type: 'final',
    },

    'equiping tool': {
      always: [
        {
          target: 'create tool init',
          guard: 'is create tool',
        },
        {
          target: 'action tool',
          guard: 'is action tool',
          reenter: true,
        },
        {
          target: 'select tool',
          reenter: true,
        },
      ],
    },

    'create tool init': {
      on: {
        'add draft points or selections': [
          {
            target: 'show draft segment',
            guard: 'can add draft',
            reenter: true,
          },
          'create tool init',
        ],
      },
    },

    'action tool': {
      on: {
        'update selection': [
          {
            target: 'firing action',
            guard: 'should action be taken',
          },
          'action tool',
        ],
      },
    },

    'select tool': {
      on: {
        'take action': 'taking action',
        'update selection': 'select tool',
        'drag-start': 'dragging',
      },
    },

    'show draft segment': {
      on: {
        'finalise segment': 'finalising segment',
      },

      invoke: {
        src: 'draft-animation-actor',
      },
    },

    'finalising segment': {
      invoke: {
        src: 'finalising-segment',
        onError: 'create tool init',
        onDone: 'create tool init',
      },
    },

    'taking action': {
      invoke: {
        src: 'take-action',
        onDone: 'select tool',
        onError: 'select tool',
      },
    },

    dragging: {
      invoke: {
        src: 'dragAnimationActor',
      },
      on: {
        'drag-end': 'finishing drag',
      },
    },

    'finishing drag': {
      invoke: {
        src: 'finalizeDrag',
        onDone: 'select tool',
        onError: 'select tool',
      },
    },

    'firing action': {
      invoke: {
        src: 'firing-action',
        onDone: 'action tool',
        onError: 'action tool',
      },
    },
  },
  initial: 'init',
  entry: () => {
    console.log('entered new sketch mode')
  },
})
