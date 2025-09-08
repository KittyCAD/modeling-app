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
  | { type: 'drag-end' }
  | { type: 'exit sketch mode' }
  | { type: 'take action' }
  | { type: 'update selection' }
  | { type: 'create-segment-start' }
  | { type: 'move-edit-start' }

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
    'move-edit-actor': fromPromise(async () => {
      // Move edit logic
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
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiAYRwEMA7GPAFUJIG0AGALqJQAB0KwAlhkmFWIkAA9EARgCsAdgB0ANgCcAJgDMatXqN6AHGp0AaEAE9EAWiNHLWozst6N-fpY6ACy+BjoAvuH2aJi4BCTkVDT0YIrSeLDo2PgAtskCwkgg4lIycgrKCM5h-Fr8akFqgfwq-CYW9k5VKkG1am7BKkYGavw6TUGR0VlxRGQU1LRakqzSdIqwGMwYYFrMAGY7AE4AFDr+AJR0Mdnx80lLK9IFCiXSsvJFlc7afhpemiMKkCQMslk6LgMQW0BnUBj0bT0QQMPksUxAN1mCQWyS0YAAjgBXSSiFZQPAYHjEOgvIpvMqfUCVNwGLQaUZGfgadkqWENCFVEa1DQhbl6fr8PQ9bzozH4OaJRa7AnE0nsClUmkqQpiCTvcpfRBGIIqXRWXo9YxBMFBAVuLTA2GBYwaME6DQjWUzeXYh7Kokkskakg0gw64p6hkVI3BTwhFQIqH8ILIzR2oG6KGmE0egwogxe2I++5KrRYI5gbYUSkkPBPDB0cuVnbOWBgKA5MCsDCtrZHDC03WlD7RhCoh0enTuqeWE3ugXVNSs91ef46dxjHqTKIY713RW45hYBnB6mE0QQKsZMDEMDHj6DiPDg1MxBgjwqblcyXwvz9O21OYTp-sEQTjEYGiFrcCo4ksR4njWZ4Xleba3veci8NqryRiOhoIOcehaLCGjqF4U76CEAoqAmWjmOuaitA0KbJhEO5yvusG7E22xkq27adt2dAQHIuwrKQhDoFo7EwX6ZYVjx7B8R2XYYAgYmEFgPEYUIj70rhr4IEiai0VY3jIpy1q+AuwzLm0KhTv0nLeJBbF7jJpbcTIiltspglgEcRyEEcWiiMQ2z7EFORSW5voefJXlQEpAmqepmkMgUuk4S+SiqI6WiWPCwxNIVZjWXmuh2Q5bhjJYLnTEWHGyZA7zsEJInLKw4mSdJsW4s1CVqZ1GlaawGVCNhz6MjlCCtN4DrQsVpimMaApLqyhihGBhgaDoBauQ17l9RALVQHQ-mBcFoXhZF0UHb1Sz9WSg3iWlD46eNdJZVNlTWKaphglKljGrOeireVG0eltBg7Xt9XQfduz7JIRxBvBHxtawolDd1MUlriSMo+qaNyM9w3pe94Z6dllStOK+U+PZxpgdYdiOC41pEfZ0L8MYOgJu6KhQVieNLATqPoawZ0BUFIVhRgEVHFFPUi4jyPiwypOvdpgiZZNo68n4nhWKi1pBJyyYLhzsLBH4vP8yRQvFgeSx5IkiF0Oel47NeaHk5TX2jucOi0caPTGq6ejurabMIBYQREfoYSjFtQOO41pau9WmpbOgeDE6NH1Dvq32qMYrJCjYWY8xoVG+A64rumE3KzpoaL7fDKtaJnp50DnFD55h-t63hu2EX46jBCM1HWKDMcJtoCY2JOzeNK6aeHS7hBu5qmfOP1vbMP2uvF6OgTB8iO0puyoyR+CMcmqaKZmdK8IBG3O6sMk8BFMrztgBNJ88KuACHUBoTRzitHaLPLozhoRGE5j4QwrReRL3XgjDq0gAFRiAdRbQccAg3yaBKIwC4oSEQlIYJoegEReG3HDYWf88RpASlg-S01Fy1GBDmCyb9hiWw8DtJEKIirshhmgzuKpAzqkQqw6mqhNB1EnuuSO9RzDWFISELQFCRiILaMEcRjDPJZ1rPWWRJcEAkW0AxYIyYCrmH8NAyE-QtDQmoRYDQRkCIGM4nsCWp4zGjkhlooY1DeiznGP8ACDoRhShCFPawDFYa7jup3TyvEfLJQCXhai0MtH9G5K0DxPJSEkXyhyS0W5kyC3bgwnxj12BZIMrNYybRq7eECPZJcdpaqgM5B6MY4o270Kdj4sWRMJaNOmryBEDpRgNB8NCQpd8ujB36LOEYroH4ojAt42S3cZGfWHgZIJ9RkxjAGO4ZEdoURaO8ECHaHJRjjEiJEIAA */
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
      always: [{
        target: 'create tool init',
        guard: 'is create tool',
      }, {
        target: 'action tool',
        guard: 'is action tool',
        reenter: true,
      }, {
        target: "move tool",
        reenter: true,
      }],
    },

    'create tool init': {
      on: {
        "create-segment-start": {
          target: "creating-segment",
          reenter: true
        }
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

    "creating-segment": {
      invoke: {
        src: 'draft-animation-actor',
        onDone: "create tool init",
        onError: "create tool init"
      }
    },

    editing: {
      invoke: {
        src: "move-edit-actor",
        onError: "move tool",
        onDone: "move tool"
      },
    },

    'firing action': {
      invoke: {
        src: 'firing-action',
        onDone: 'action tool',
        onError: 'action tool',
      },
    },

    "move tool": {
      on: {
        "update selection": "move tool",
        "take action": [{
          target: "firing action",
          reenter: true,
          guard: "should action be taken"
        }, {
          target: "action tool",
          reenter: true
        }],
        "move-edit-start": {
          target: "editing",
          reenter: true
        }
      },
    }
  },
  initial: 'init',
  entry: () => {
    console.log('entered new sketch mode')
  },
})
