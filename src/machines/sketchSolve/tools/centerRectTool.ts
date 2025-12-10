import { createMachine, setup } from 'xstate'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { KclManager } from '@src/lang/KclManager'

type CenterRectToolEvent = BaseToolEvent

export const machine = setup({
  types: {
    context: {} as Record<string, unknown>,
    events: {} as CenterRectToolEvent,
    input: {} as {
      sceneInfra: SceneInfra
      rustContext: RustContext
      kclManager: KclManager
      sketchId: number
      sceneGraphDelta?: SceneGraphDelta
    },
  },
  actions: {
    'add point listener': () => {
      // Add your action code here
      // ...
    },
    'show draft geometry': () => {
      // Add your action code here
      // ...
    },
    'remove point listener': () => {
      // Add your action code here
      // ...
    },
  },
  actors: {
    askUserForDimensionValues: createMachine({
      /* ... */
    }),
  },
}).createMachine({
  context: {},
  id: 'Center Rectangle tool',
  initial: 'awaiting first point',
  on: {
    unequip: {
      target: '#Center Rectangle tool.unequipping',
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
    escape: {
      target: '#Center Rectangle tool.unequipping',
      description: 'ESC unequips the tool',
    },
  },
  description:
    'Creates a rectangle based on two points from the user: the center point followed by a corner point.',
  states: {
    'awaiting first point': {
      on: {
        'add point': {
          target: 'await second point',
        },
      },
      entry: 'add point listener',
    },
    'await second point': {
      on: {
        'add point': {
          target: 'Confirming dimensions',
        },
      },
      entry: 'show draft geometry',
    },
    'Confirming dimensions': {
      invoke: {
        input: {},
        onDone: {
          target: 'unequipping',
        },
        onError: {
          target: 'unequipping',
        },
        src: 'askUserForDimensionValues',
      },
      description:
        'Show the user form fields for the width and height of the rectangle, allowing them to input values directly. This will add dimension-type constraints for either of the fields that are filled out.',
    },
    unequipping: {
      type: 'final',
      entry: 'remove point listener',
      description: 'Any teardown logic should go here.',
    },
  },
})
