import { fromPromise, setup } from 'xstate'

type PointEvent =
  | { type: 'unequip' }
  | { type: 'add point'; data: [x: number, y: number] }
  | { type: 'update selection' }

export const machine = setup({
  types: {
    context: {} as Record<string, unknown>,
    events: {} as PointEvent,
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
    modAndSolve: fromPromise(async () => {}),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QAUD2BLAdgFwATdVQBsBiAV0zAEcz0AHAbQAYBdRUO1WdbdVTdiAAeiAIwAmcaIB0AZgCcANlniAHAHZZAVkXilAGhABPRABZp61VvWnFW8Uy0KdogL6vDaLHgLFydCABDbDBcWDAiMABjXn5mNiQQTm5YgUSRBAVxaUVRJlU1JwL5UWtDEwQAWkLpJiZxbVN1ayY7VUV3TwwcfEIiaQAnMECII1wAM1QB3DJw6aiidCiAaxIRiFxOb3jBZJ4+NNAMxVNzeW1xHVNRRXl5dXKxVXNmurzTe3Vb006QLx7fP0AML8cboAYAWywUFwEHQELAmG4-FgJAg-DA0iwADdUMtMf8fH1pCDMGDIdDYfDEcikQgcagosEDvEdok9qlBBkdPJamolPI6g5lKZHghBdI1M1tCdVHKFLJfoTesQSaDwVDMDC4QikQdUWABgMptI6ERgpNIdJlYC1WSNZSdTT9fTMLimalWaxdlx9vwuWJHKppO1FF8vrIPoo5WLRO1JaY7vJVEwlKpRPItO4PCBMKgIHBBDa+j6UgcA5lROoLMLTCn7KIq+IHsZEJUJNWpKZxKYmM0q+p1Eold0iaqhiMxpaZnNcAslstS37DsJELI7DXWnXHFImy2KjcZJchS067JRN2R94VcD1RStVTdbT4OzfZz0ogCkfTJGq1pBVoqaiLGuSSoB9RDrIqhJsmV4AsSFDULQdB0NCS7vkcYjNryDSSCcTDXKmXyxqcYF1EwHbFB84jZq4QA */
  context: {},
  id: 'Point tool',
  initial: 'ready for user click',
  on: {
    unequip: {
      target: '#Point tool.unequipping',
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
    'update selection': {
      description: 'Handle selection updates from the sketch solve machine.',
    },
  },
  description: 'Creates a point',
  states: {
    'ready for user click': {
      entry: 'add point listener',
    },

    'Confirming dimensions': {
      invoke: {
        input: {},
        onDone: {
          target: 'ready for user click',
          reenter: true,
        },
        onError: {
          target: 'unequipping',
        },
        src: 'modAndSolve',
      },
    },

    unequipping: {
      type: 'final',
      entry: 'remove point listener',
      description: 'Any teardown logic should go here.',
    },
  },
})
