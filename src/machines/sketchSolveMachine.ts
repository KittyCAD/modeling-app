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
  /** @xstate-layout N4IgpgJg5mDOIC5QGUDWYAuBjAFgAmQHsAbANzDwFlCIwBiAYRwEMA7GPAFUJIG0AGALqJQAB0KwAlhkmFWIkAA9EARgCsAdgB0ANgCcAJgDMatXqN6AHGp0AaEAE9EAWiNHLWozst6N-fpY6ACy+BjoAvuH2aJi4BCTkVDT0YIrSeLDo2PgAtskCwkgg4lIycgrKCM5h-Fr8akFqgfwq-CYW9k5VKkG1am7BKkYGavw6TUGR0VlxRGQU1LRakqzSdIqwGMwYYFrMAGY7AE4AFDr+AJR0Mdnx80lLK9IFCiXSsvJFlc7afhpemiMKkCQMslk6LgMQW0BnUBj0bT0QQMPksUxAN1mCQWyS0YAAjgBXSSiFZQPAYHjEOgvIpvMqfUCVEzaYbjYYcqH8JEQqojNRaSwhaEBIFWdQRKIYmb4OaJRa7AnE0nsClUmkqQpiCTvcpfRBGIIqXRWXo9YxBMFBXluLTA2GBYwaME6DQjdGY2XYh6Kokkslqkg0gxa4o6hkVA3jOrnMEaUyGHQGMI2oG6KGmFRIvRqOEemV3eW4rBHMDbCiUkgZLZQMl0EtlnYZMBQHJgVgYavMI4YWna0ofSMIMEeDSWoIWRo6NxZ3nVJp1PRI86+dzueP52Je+4KrSwMDEMBYBl4ZjHru19h0QmiCDl5uH48fPthgd6pmqALaPQ9fjOoUqAYvKAXodSmMmPSJmEGgaJutxyjiSz7o+J5np2mzMJeUDXre97IUeDK8JqrzhoO+oIK0QQ6FoDoGPG8ajNyGi8gY-haI0OaJq0ljcvwkxSp6haIbsDbbGSzj7q27YYHQEByLsKykIQ6BaIJCE+lookyOwEktm2HYIIphBYGJcgFC+9JkR+CDLnayIaDo6hmGCc4DIKZhmMm-5jlRcFYjuxalmJOmSfpMlgEcRyEEcWiiMQ2z7NFOSqQW6m7lp4mhdJhmsEpJmEUIFmke+SiqCozqCn4-RGPGgHBMxjguG51icV5cZBL5Ampd6u6QO8V5yawCm5cpuxqT1uJ9dpUA5XlpmsOZQgkW+jKlRRYweD08aWPypiGryajJlohihFRhgOQYfnbkWSxTXWEVRTFcUJUlKVbkJGl3ews3GfNi2hpZJWVNYxqmGCP6WIaQp6AdR0nW6Z10UmV0fbuaEBnID4ER8snycsI0qeNAVLOjqqY-hT5yD9+XPoVS10sVq2VK0wyCpaPk9IasJzpaNEqPV-DGI5eiuioKNpbipPkuTB7Y3IdAPdFsXxRgiVHMlRM3bsUt4DLKEfNTf10wDjNDoByJaM6VEtK6E5eDzHiwgLQtZqL4sTUseSJFNF51jed5NhTBUmytQ7TqBfhQyo5X6NOagsVmNF0eVPSp9bRju8TuxexQPsYVhdA53gedbD2RWh+RgSgWDPgom6wKHbyRrGh13gNLmfEjJdXXvRLnuEN7EDpPndZobrrBY5TC30-2upM6ojRBLoITQ-U5zuMB8JgYdsIhGE0GwT38Ee9nA+50P6E1qP5563LC3EQzFfWUMvOWOo5husuVEsWxHFmP4GgETwm8JEKUrBkjwCKJrYSy055DlcAEMCjRmgs36DDRqVRoRGD5j4Pwf4-y+GCJnLW+NpCwIjORZw0dWRIgCKMHM1gjBtDnFCauTDDBNCXG0IhR9-IkNSP1KA5CrJrXnLUYERp-h8QCJDICGDnC8wckiFEwxNCaGRrw66wk8R+hVOSSsxBhFA1UJoGMyJw7nDMO4eO8jWFaH6NyEYPgEReH4tMXuJ9NJBSbAY327AjHzwQK6AwNE7aAJsOVCGLCFwIk0D0de5g37EO0UHD4p5zwj38Y-OB5FXTYKGKxCCYQmjxhtOIkYSI0HAnGEuQ+7jj5Zy8Y2TKelpIBLNoBDwQIhjnQaOYS0LCdrsXMA6DquZPLJM+hfMk7TyKtGnMdJMn9-htzojaSw2h6hMLdGMBhky0ZPjJhPVJJVAaBJAuI0YDQfDQlaM6Xk1F+hChGFbaOKJOr1L4doouJdMIzOyRQ6yroBTjNYecGOJgbQonsd4Nwk4rFJNAUAA */
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
