import { createMachine, setup } from 'xstate'
import type { BaseToolEvent } from '@src/machines/sketchSolve/tools/sharedToolTypes'

type DimensionToolEvent = BaseToolEvent

export const machine = setup({
  types: {
    context: {} as Record<string, unknown>,
    events: {} as DimensionToolEvent,
  },
  actions: {
    'add point listener': () => {
      console.log('tool successfully equipped')
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
  /** @xstate-layout N4IgpgJg5mDOIC5QBECWBbMA7WqD2WABAC554A2AxAK5ZgCO1qADgNoAMAuoqM3rsXxYeIAB6J2AGhABPCQF950tJhxCSZcgDoAhgHcdqQViiEAZqgBOsYoT6osxSjogQ7eB8Q7ckIPgKERcQQANgAWMK0AZgB2AFYYgE4ADhD2AEYQqIzpOQQo9PStGOT00rCQxMqAJijkuMVlDGxcAg0KXQMjQlgwAGMCN3tHZ1d3T28RfyNA32DwyNiElLTM7PTcxDC45K1qkLKQ5OqYqLj09iiwxpAVFvVSDoBhAgtLdAdTCGa1AlhKCAEMBaBwANzwAGtgXdfkRHtoXlg3h8TIRvqpWjgEGC8H0dIICN5Jr5pgThHNEHF2DE9ok4md9tUIuFkmFNghkjFqtFUiztmV9jcYZj2gjXlYUV8fpj-mBLJY8JYtMxyPizIr0FphQ9NFpEcjPmjpUJYNisOC8WSiVwpvwZgQglt2OwtCF6TFnYkomd0tU4uzStyyhF0lFEtVEuxqqzFEoQFg8BA4CJtW14baAg6KQgALRhZLsnOhorpL0xLKJeLh-NC41p3X6QzGUxvGzjRwZ+3k0DBKIHLThj0FCJxMIxMKxdm1bkxX1pEpxJnjhpx1NwhtdWy9AZYIYeDsku1kx35EI0kfsKkT9Ie8MhdkRGnHN3bdiRirR66ruvr57i96Gui9x-J2x7Zt6NJemEzp+icfr3rIiAHJEYTVDeo6ltUfqJIktYYjqHS0AwTDMMwnygbMPYSAGZwDr6VLjuElaLrG8hAA */
  context: {},
  id: 'Dimension tool',
  initial: 'awaiting first point',
  on: {
    unequip: {
      target: '#Dimension tool.unequipping',
      description:
        "can be requested from the outside, but we want this tool to have the final say on when it's done.",
    },
    escape: {
      target: '#Dimension tool.unequipping',
      description: 'ESC unequips the tool',
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
