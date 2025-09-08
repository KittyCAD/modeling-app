import { fromCallback, fromPromise, setup } from 'xstate'
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
  | { type: 'exit sketch mode' }
  | { type: 'update selection' }
  | { type: 'create segment start' }
  | { type: 'move edit start' }
  | { type: 'act on selection' }

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
    'draft-animation-actor': fromCallback(({ sendBack }) => {
      // sendBack({type: '...'})
    }),
    'firing-action': fromPromise(async () => {
      // Firing action logic
    }),
    'move-edit-actor': fromPromise(async () => {
      // Move edit logic
    }),
    'acting-on-selection': fromPromise(async () => {
      // Acting on selection logic
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
  actions: {},
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiAYRwEMA7GPAFUJIG0AGALqJQAB0KwAlhkmFWIkAA9EARgCsAdgB0ANgCcAJgDMatXqN6AHGp0AaEAE9EAWiNHLWozst6N-fpY6ACy+BjoAvuH2aJi4BCTkVDT0YIrSeLDo2PgAtskCwkgg4lIycgrKCM5h-Fr8akFqgfwq-CYW9k5VKkG1am7BKkYGavw6TUGR0VlxRGQU1LRakqzSdIqwGMwYYFrMAGY7AE4AFDr+AJR0Mdnx80lLK9IFCiXSsvJFlc7afhpemiMKkCQMslk6LgMQW0BnUBj0bT0QQMPksUxAN1mCQWyS0YAAjgBXSSiFZQPAYHjEOgvIpvMqfUCVNwGLQaUZGfgadkqWENCFVEa1DQhbl6fr8PQ9bzozH4OaJRa7AnE0nsClUmkqQpiCTvcpfRBGIIqXRWXo9YxBMFBAVuLTA2GBYwaME6DQjWUzeXYh7Kokkskakg0gw64p6hkVI1mNk6HQjKzigwaHQqO1A3RQ0wqJHiuFe2I++5KrRYI5gbYUSkkPBPDB0cuVnYZMBQHJgVgYDJbI4YWm60ofaMIMEeEWWIIWRo6Ny5gXVJp1PRI86+dzudmF24KnFLZhYBnB6mE0QQKut4hgQ8fAcRocGpmqALaKW9V2T3kC3l6OqmAywiEYRhNy25YiWuIHkeNYnmeF6wGAV43nIvDaq8kbDoaCCtEEOhaE6KaaKY-i+AKBj+FojTioYaYBJK-CTFEGLenciq4k22xks4CHtp2DYQHIuwrKQhDoFocqsXuuwcTI7DcW2HZdggwmEFgnEoUId70phT4IKuDrIqm6hmGCC4DFo1jUQBH4irhYHFmxSwyVxPGKQ2YBHEchBHFoojENs+zeTk4ksbufplhWnFya5fHKawIlqQyBRaRhj5KKoKiuhZfj9EYPJhNCZleBZZhmNZYK2RETESWFpaQO87B0AJrBCfFom7DVvp1RADVQHFCXqawyVCOhD6Mul2FjB4PTspYIymP0tqOIgagAVohihLhhipgY9mSeF9WyVAdAeV5Pl+QFQUhUW+3db1-WqYNw3htpaWVNYpqmGCUqWMak56AKq2shtHpbSmCZ7bVkE3uqciXteDJNYJyxtWJnUQfuMPknDCFIQyD2JbemkjXSqXjZUrTDBZ1q2T0xqwgu1r4SowR+MYaZ6O6KiQ110NHXgOOIQjHwnZ53m+f5GCBUcwXo45uxQUGgt4x8BNPcTL1kyOvLImyk7nCzIoDIzHiwqz-Ds7mXM8xjux5Ikh3HnQp7ni2uPCxpmtjSOaamuY1juABLTWHYy0ICappBLh1iNDhIy7dVoW80s9sUI7MF0KneCO5szB9il3tYYEv5fT4KIesCq0ChHlHRw0ahx6tNvy1oWfp5qUEC6w8PIUNJODvq5OqI0QS6CE-31Oc7jfvCf5Az0NEgRozdSa3hAOz13YZ53yse0NaGk4XulDEzljqOYHqrrhZEUVRZj+BoCLwjK6KsMk8BFHLUmjYPI6uAEf5GjNEpv0AGYdnDQiMMzHwfguRcl8MEFe4V6w-yjFhZwKhMqeCRAEUY4oA5tAXFCEunJDBNBXG0RBicbpQyWKkXqqCdITUXLUYEJp-gMQCL9AwJs4xIhRMMIiO0kF1QDGqckMFGFvVUJoOowQwgWHOGYdwagiEhC0BKMhPgEReEYtMGhydpKRRbDBOsqwMBSKHggDQrQ2QN1WpYNo3JcwaCIf0CyYwWgpmNA3fQy9qE7kMXsXux5LEjlBhooYK5ej60BHaVhiYF4jErg3BO+jAm2wis2FyCk+JhKwpglEnhMEWEIiEP6RC5qUXME6KO9jDAiNxIdMk+Tj5jDUHUTk4M3QsyrmHTcf5OQejGPgxpmN+a717q0iaP5WGjAaD4aErRXQCjwv0ScIxXQRxRHZAJ4EW5t03qEw+v8sI2Mjv8PK8cz49FUf0opNg5pzV5BbSw-xGKRCAA */
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
          target: 'move edit tool',
          reenter: true,
        },
      ],
    },

    'create tool init': {
      on: {
        'create segment start': {
          target: 'creating-segment',
          reenter: true,
        },
      },
    },

    'action tool': {
      on: {
        'update selection': [
          {
            target: 'acting on selection',
            guard: 'should action be taken',
          },
          'action tool',
        ],
      },
    },

    'creating-segment': {
      invoke: {
        src: 'draft-animation-actor',
        onDone: 'create tool init',
        onError: 'create tool init',
      },
    },

    editing: {
      invoke: {
        src: 'move-edit-actor',
        onError: 'move edit tool',
        onDone: 'move edit tool',
      },
    },

    'acting on selection': {
      invoke: {
        src: 'acting-on-selection',
        onDone: 'action tool',
        onError: 'action tool',
      },
    },

    'move edit tool': {
      on: {
        'update selection': 'move edit tool',
        'move edit start': {
          target: 'editing',
          reenter: true,
        },
        'act on selection': [
          {
            target: 'acting on selection',
            reenter: true,
            guard: 'should action be taken',
          },
          {
            target: 'action tool',
            reenter: true,
          },
        ],
      },
    },
  },
  initial: 'init',
  entry: () => {
    console.log('entered new sketch mode')
  },
})
