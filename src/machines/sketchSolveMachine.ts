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
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiAYRwEMA7GPAFUJIG0AGALqJQAB0KwAlhkmFWIkAA9EARgCsAdgB0ANgCcAJgDMatXqN6AHGp0AaEAE9EAWiNHLWozst6N-fpY6ACy+BjoAvuH2aJi4BCTkVDT0YIrSeLDo2PgAtskCwkgg4lIycgrKCM5h-Fr8akFqgfwq-CYW9k5VKkG1am7BKkYGavw6TUGR0VlxRGQU1LRakqzSdIqwGMwYYFrMAGY7AE4AFDr+AJR0Mdnx80lLK9IFCiXSsvJFlc7afhpemiMKkCQMslk6LgMQW0BnUBj0bT0QQMPksUxAN1mCQWyS0YAAjgBXSSiFZQPAYHjEOgvIpvMqfUCVNwGLQaUZGfgadkqWENCFVEa1DQhbl6fr8PQ9bzozH4OaJRa7AnE0nsClUmkqQpiCTvcpfRBGIIqXRWXo9YxBMFBAVuLTA2GBYwaME6DQjWUzeXYh7Kokkskakg0gw64p6hkVI1mNk6HQjKzigwaHQqO1A3RQ0wqJHiuFe2I++5KrRYI5gbYUSkkDJbKBkujlys7DJgKA5MCsDB15hHDC03WlD7RhBgjwiyxBCyNHRuXMC6pNOp6JHnXzudzswu3BU4pawMDEMBYBl4Zin3sN9h0QmiCBVtvH08fQcR4cGpmqALaKW9V1TryAq8nodSmAYsIhGEYTcjuWIlrih7PmeF49pszDXlAt73o+SEngyvDaq8kYjoaCCtEEOhaE6KaaKY-i+AKBj+FojTioYaYBJK-CTFEGLenciq4s22xks4h4dl2GB0BAci7CspCEOgWhyoJ+67CJMjsOJ7adt2CAKYQWCiXIBRvvSpFfgga4OsiqbqGYYKLgMWjWOxEEASKlFwcWQlLJpYkSXp0lgEcRyEEcWiiMQ2z7BFOQqQJe5+mWFaidpQVSQZrCKcZBFCOZJGfkoqgqK6rl+P0Rg8mE0LOV4rlmGYHlgl5ER8apyWlpA7w3rJrDyTlSm7J1vrdRAvVQNluUmawZlCMRH6MiV5FjB4PTspYIymP0tqOIgagQVohihJRhipgYPlqSlPVaVhoXhZF0WxfFiVFtd42TdNRmzfN4YWcVlTWKaphglKljGlOegCodrInR6Z0pgmV1dbiqFBnIT74R8MlycsQ3KaNCFLOj6qY3hL5yN9eWvgVC10kVy2VK0wyudaXk9MasKLta1EqMEfjGGmejuioKNjWjL5k6wWOU6wdAPRFUUxRgcVHAlRN+bspPkuTR7Y1Thk06ZdP-Yzo68sibJTuc-MigMPMeLCAv8ELuai+LxO7HkiS3VejZ3g+rYU-lZtLaOwTCvGIScn+PjQ-tCBOmyGjmGm6huGDl0dUlEtLD7FB++hmF0AXeBF1s-aFeHZGBKBoM+CiHrAodAomqaQSUdYjQUSM2fTO9qP54QvsTWh9aNqheB68htNh-qTOqI0QS6CEUP1Oc7jAfCYGwz0HEwRonta1oZcVxhk+XjPBtzURDM11ZQy85Y6jmB6a6UUxLFsWY-ip67Is0TolYMkeARRNbqUWgvUcrgAhgUaM0Fm-QE5dGcNCIwfMfB+C5FyXwwRj7qXxtIKBUYyLOBUGVTwSIAijHFNYTkRhFxQnrrHEY8c2j4JzoPPOyo0h3RIZZFaS5ajAhNP8HiAQIYGEdnGJEKJhh0QugQm6AY1TkhrMQARgNVCaDqMEMIFhzhmHcGoJhIQtASkME0VcHDeID13Dw1KLZqxUn9uwLRi8EDulZFCNwqcbBlXBkw5cCJNDSkRO4MWXCHFey0CHD455LzFzJB4iO-wHTDFdrCMITR2R2hEYmRoFhgTjFXEfaJ8ET4BQyrpKSqSyIUJRJ4ChFhaIx2tEwrarFzBOk7moV+-d+LcNibdFJ99oENLGGoOonIkZun5q3ROW4wKcg9GMOhyjSw62njLeJxUAaeJAiI0YDQfDQlaK6AUVF+hThGK6duKJvIVN8oQs+Y83FQHqVZd00z+mHRCLbVMJg7RNJsBDNwSJjEv0iJEIAA */
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
          target: 'create tool staging',
          guard: 'is create tool',
        },
        {
          target: 'selection act staging',
          guard: 'is action tool',
          reenter: true,
        },
        {
          target: 'move edit staging',
          reenter: true,
        },
      ],
    },

    'create tool staging': {
      on: {
        'create segment start': {
          target: 'creating-segment',
          reenter: true,
        },
      },
    },

    'selection act staging': {
      on: {
        'update selection': [
          {
            target: 'acting on selection',
            guard: 'should action be taken',
          },
          'selection act staging',
        ],
      },
    },

    'creating-segment': {
      invoke: {
        src: 'draft-animation-actor',
        onDone: 'create tool staging',
        onError: 'create tool staging',
      },
    },

    editing: {
      invoke: {
        src: 'move-edit-actor',
        onError: 'move edit staging',
        onDone: 'move edit staging',
      },
    },

    'acting on selection': {
      invoke: {
        src: 'acting-on-selection',
        onDone: 'selection act staging',
        onError: 'selection act staging',
      },
    },

    'move edit staging': {
      on: {
        'update selection': 'move edit staging',
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
            target: 'selection act staging',
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
