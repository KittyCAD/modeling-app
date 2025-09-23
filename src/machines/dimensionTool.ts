import { createMachine, setup } from 'xstate'

type DimensionToolEvent =
  | { type: 'unequip' }
  | { type: 'add point'; data: [x: number, y: number] }

export const machine = setup({
  types: {
    context: {} as Record<string, unknown>,
    events: {} as DimensionToolEvent,
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
  id: 'Dimension tool',
  initial: 'awaiting first point',
  on: {
    unequip: {
      target: '#Dimension tool.unequipping',
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
  },
  description:
    'Creates dimension constraints based on two points from the user.',
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
        'Show the user form fields for dimension values, allowing them to input values directly. This will add dimension-type constraints.',
    },
    unequipping: {
      type: 'final',
      entry: 'remove point listener',
      description: 'Any teardown logic should go here.',
    },
  },
})
