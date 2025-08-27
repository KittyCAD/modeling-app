import { setup } from 'xstate'
import type { ModelingMachineContext } from '@src/machines/modelingMachine'

export interface SketchSolveMachineContext {
  parentContext: ModelingMachineContext
  initialSketchDetails: ModelingMachineContext['sketchDetails']
}

export type SketchSolveMachineEvent = { type: 'Cancel' }

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
  actions: {},
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiAYQEMA7LMYgbQAYBdRUAAdCsAJYZRhFgJAAPRAFYA7ABoQAT0QBGABxKAdAGYATABYAnDvMA2U9Z06FAXydq0mXARLkqNerNgMJgwwfQBXQQhgsB5+JBBhMQkpGXkEQy19UyVuE3tzBWMTQxK1TXSHfS0Fbm5TGqVqmq0XVxAWP3h492x8IjIKaloZRPFJaXi08zLEAFprfVra3QUrJXMcopc3dF6vAd9afVEIYjARkTGUycR7KqUa02MFAu5HLUMZhC1jHX0dCzmczGJRKazcLRaUzbEA9Tz9HxDUJgWRjFhQC5JcapbR3JSGMHGcz1YGmXTGL4rfSg3Q5axaSyFbjOVpAA */
  id: 'Sketch Solve Mode',
  context: ({ input }) => ({
    parentContext: input.parentContext,
    initialSketchDetails: input.initialSketchDetails,
  }),
  on: {
    Cancel: {
      target: '#Sketch Solve Mode.exiting',
    },
  },
  states: {
    idle: {},
    exiting: {
      type: 'final',
    },
  },
  initial: 'idle',
  entry: () => {
    console.log('entered new sketch mode')
  },
})
