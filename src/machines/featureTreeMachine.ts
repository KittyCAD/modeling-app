import { SourceRange } from 'lang/wasm'
import { assign, setup } from 'xstate'

type FeatureTreeEvent =
  | {
      type: 'goToKclSource'
      data: { targetSourceRange: SourceRange }
    }
  | {
      type: 'selectOperation'
      data: { targetSourceRange: SourceRange }
    }
  | {
      type: 'enterEditFlow'
      data: { targetSourceRange: SourceRange }
    }
  | { type: 'goToError' }
  | { type: 'codePaneOpened' }
  | { type: 'selected' }
  | { type: 'done' }

export const featureTreeMachine = setup({
  types: {
    context: {} as { targetSourceRange?: SourceRange },
    events: {} as FeatureTreeEvent,
  },
  guards: {
    codePaneIsOpen: () => false,
  },
  actions: {
    saveTargetSourceRange: assign({
      targetSourceRange: ({ event }) =>
        'data' in event ? event.data.targetSourceRange : undefined,
    }),
    clearTargetSourceRange: assign({
      targetSourceRange: undefined,
    }),
    sendSelectionEvent: () => {},
    openCodePane: () => {},
    sendEditFlowStart: () => {},
    scrollToError: () => {},
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QDMwEMAuBXATmAKnmAHQCWEANmAMRQD2+dA0gMYUDKduLYA2gAwBdRKAAOdWKQyk6AOxEgAHogCMAFn7EAbAFYAHAHYAnGoOm9OgMw6tAGhABPRBsvF+a6wYBM-A-0uWepYGAL4h9qiYuAREZJQ0sGBULBgA8qJgOJgysgLCSCDiktJyCsoIKipabmo6-Co2Wip+-DoG9k4IWpp+Ae6W-N16KpZeYRHo2HiEYCTkVNRgshiZAKIQUgBiFHQA7nkKRVI5ZapergN6el46515GVdYdiN4GbjpGXiNGV2pan+MQJEpjFZsR6KRZFBGKwOFwcDxiIlktIodRkWAUpADgUjiV5AVyipWipiGZupYVCY1D5+F5ngg-jpiJ8DFo1OoDA13GNwkDJtEZiQIVCYWxONwSBA5DQcWIJMdSoTVG0yTodGoPAZKfwjP52o5EHVNIYvNd9M0zJZAcDBbERdDmOL4Yi6BlZJCoABhOgQMAABTQshoLF9AaDYHSS2xQkOCvxpy6lWIbS0Bm8JkM+ksDKZLK8bL0-S8NOCNoF01iGJSnqRSUxqKg6PrWIgcsK8ZOyq6aj0avTbU1Hg0KgZzVcrU+Xn+9Q+dPLUUrYOrjeI0uD1HbeK7oCJBj7xkafhMX28agZJeqHz0RhstTUD21WgXIKFxCWKxwnvWWx2uzrKKes2KIxvk8rFDuShGpY1RaKMRiHr4va9gyegPsQQRmiYVK+GYL52mCH6ZN+GwYNsexrjKm6xrinZKruqhaLBmr8PUvj6F4nGoeoxDEpYCFMVSowfPhS7CnQnqMKsOA4HQODEG6Syej6fqBhuoaqRGUbBm2NHgYqBIMV0-EproxLpoE7hWGOnFeGSxgaPwei6EYmaiaCczxLQDB0NJsk4FudGGVBFRpsQwRGGmgx6n4cH0oaFSVH21i6LqD5mtYejuW+DpSTJcmURugUQfRIX6MQfwcpqDxpUETwJSoXxqMQ04PjoSXspYtRhHyshhvABS2mJcYlcF5QALR2Al43TtoVJDD46ZfJS1p8kNHlxFQI0GYmNJjn8c21PuIzjuq2X2hJopOnCkrbQm3ZdXZNhsl1fzOSW1kJdYzKeK5VQqJh+7nWCuXXRKCIkCunp3ZB5RFq46ofOq6geDeo4JZqdlaEWt66l8jXfcD4mSWDLpSjKMOlUSzSwXS2qztVfy5jS2g43UnyVOcZ1rRWG2g7C4Ouu6ylhmpYCU2NiD8Zoz1wZq2NaB9OYYyz2O6gE3TtR8XVEwBDbQ7Ro2JtYT1pnLb2K7UyudIrFU3h8ZoamafhZTzi4bVDUJ6zWUIS7trGmS98vvVb+1GBhjUPtqer3KxOi657UCFeLhs7d2FmHe1ARmFr54NdqLUFrZnLBFUutEV+UI-mRf5+w9NgYZSNyBHB6rxTbcHhTY5wmDVMGrRM7tvhXJG-hRid10ZGjNUEjVWM533t4gaHh8aFgaOc+7XOXyzEVXpHkf+64p-p91T744VBEE7h0oEGpTZ0Dx2Sbhi9r4ozNLroN+XJk8hTBV51SRQGE7JiS9ErJjgnSRWC0bCu0Hq+C6JMf7yUUh6KEKlwzBj-uUKqKYgFQNAYrMcVI+yVFcqxfwFhAhf0uo6FByccHLyaC1JygRp5FkagaTo5CyFUj1KxO+gReRhCAA */
  id: 'featureTree',
  description: 'Workflows for interacting with the feature tree pane',
  states: {
    idle: {
      on: {
        goToKclSource: {
          target: 'goingToKclSource',
          actions: 'saveTargetSourceRange',
        },

        selectOperation: {
          target: 'selecting',
          actions: 'saveTargetSourceRange',
        },

        enterEditFlow: {
          target: 'enteringEditFlow',
          actions: 'saveTargetSourceRange',
        },

        goToError: 'goingToError',
      },
    },

    goingToKclSource: {
      states: {
        selecting: {
          on: {
            selected: {
              target: 'done',
            },
          },

          entry: ['sendSelectionEvent'],
        },

        done: {
          entry: ['clearTargetSourceRange'],
          always: '#featureTree.idle',
        },

        openingCodePane: {
          on: {
            codePaneOpened: 'selecting',
          },

          entry: 'openCodePane',
        },
      },

      initial: 'openingCodePane',
    },

    selecting: {
      states: {
        selecting: {
          on: {
            selected: 'done',
          },

          entry: 'sendSelectionEvent',
        },

        done: {
          always: '#featureTree.idle',
          entry: 'clearTargetSourceRange',
        },
      },

      initial: 'selecting',
    },

    enteringEditFlow: {
      states: {
        selecting: {
          on: {
            selected: 'done',
          },
        },

        done: {
          always: '#featureTree.idle',
        },
      },

      initial: 'selecting',
      entry: 'sendSelectionEvent',
      exit: ['clearTargetSourceRange', 'sendEditFlowStart'],
    },

    goingToError: {
      states: {
        openingCodePane: {
          entry: 'openCodePane',

          on: {
            codePaneOpened: 'done',
          },
        },

        done: {
          entry: 'scrollToError',

          always: '#featureTree.idle',
        },
      },

      initial: 'openingCodePane',
    },
  },

  initial: 'idle',
})
