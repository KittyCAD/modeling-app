import { assign, setup } from 'xstate'
import type { ModelingMachineContext } from '@src/machines/modelingMachine'

export interface SketchSolveMachineContext {
  parentContext: ModelingMachineContext
  initialSketchDetails: ModelingMachineContext['sketchDetails']
}

export type SketchSolveMachineEvent =
  | { type: 'Cancel' }
  | { type: 'xstate.update'; data: Partial<SketchSolveMachineContext> }

export const sketchSolveMachine = setup({
  types: {
    context: {} as SketchSolveMachineContext,
    events: {} as SketchSolveMachineEvent,
    input: {} as {
      parentContext: ModelingMachineContext
      initialSketchDetails: ModelingMachineContext['sketchDetails']
    },
  },
  guards: {},
  actions: {
    'assign parent context': assign(({ context, event }) => {
      if (event.type !== 'xstate.update') return {}
      return {
        parentContext: {
          ...context.parentContext,
          ...event.data.parentContext,
        },
      }
    }),
  },
}).createMachine({
  id: 'Sketch Solve Mode',
  context: ({ input }) => ({
    parentContext: input.parentContext,
    initialSketchDetails: input.initialSketchDetails,
  }),
  on: {
    Cancel: {
      target: '#Sketch Solve Mode.exiting',
    },
    'xstate.update': {
      actions: 'assign parent context',
    },
  },
  states: {
    idle: {},
    exiting: {
      type: 'final',
    },
  },
  initial: 'idle',
})
