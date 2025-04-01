import { Artifact, getArtifactFromRange } from 'lang/std/artifactGraph'
import { SourceRange } from 'lang/wasm'
import {
  enterAppearanceFlow,
  enterEditFlow,
  EnterEditFlowProps,
} from 'lib/operations'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import toast from 'react-hot-toast'
import { Operation } from '@rust/kcl-lib/bindings/Operation'
import { assign, fromPromise, setup } from 'xstate'
import { commandBarActor } from './commandBarMachine'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import {
  deleteSelectionPromise,
  deletionErrorMessage,
} from 'lang/modifyAst/deleteSelection'

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
      type: 'deleteOperation'
      data: { targetSourceRange: SourceRange }
    }
  | {
      type: 'enterEditFlow'
      data: { targetSourceRange: SourceRange; currentOperation: Operation }
    }
  | {
      type: 'enterAppearanceFlow'
      data: { targetSourceRange: SourceRange; currentOperation: Operation }
    }
  | { type: 'goToError' }
  | { type: 'codePaneOpened' }
  | { type: 'selected' }
  | { type: 'done' }
  | { type: 'xstate.error.actor.prepareEditCommand'; error: Error }
  | { type: 'xstate.error.actor.prepareDeleteCommand'; error: Error }

type FeatureTreeContext = {
  targetSourceRange?: SourceRange
  currentOperation?: Operation
}

export const featureTreeMachine = setup({
  types: {
    input: {} as FeatureTreeContext,
    context: {} as FeatureTreeContext,
    events: {} as FeatureTreeEvent,
  },
  guards: {
    codePaneIsOpen: () => false,
  },
  actors: {
    prepareEditCommand: fromPromise(
      ({
        input,
      }: {
        input: EnterEditFlowProps & {
          commandBarSend: (typeof commandBarActor)['send']
        }
      }) => {
        return new Promise((resolve, reject) => {
          const { commandBarSend, ...editFlowProps } = input
          enterEditFlow(editFlowProps)
            .then((result) => {
              if (err(result)) {
                reject(result)
                return
              }
              input.commandBarSend(result)
              resolve(result)
            })
            .catch(reject)
        })
      }
    ),
    prepareAppearanceCommand: fromPromise(
      ({
        input,
      }: {
        input: EnterEditFlowProps & {
          commandBarSend: (typeof commandBarActor)['send']
        }
      }) => {
        return new Promise((resolve, reject) => {
          const { commandBarSend, ...editFlowProps } = input
          enterAppearanceFlow(editFlowProps)
            .then((result) => {
              if (err(result)) {
                reject(result)
                return
              }
              input.commandBarSend(result)
              resolve(result)
            })
            .catch(reject)
        })
      }
    ),
    sendDeleteCommand: fromPromise(
      ({
        input,
      }: {
        input: {
          artifact: Artifact | undefined
          targetSourceRange: SourceRange | undefined
        }
      }) => {
        return new Promise((resolve, reject) => {
          const { targetSourceRange, artifact } = input
          if (!targetSourceRange) {
            reject(new Error(deletionErrorMessage))
            return
          }

          const pathToNode = getNodePathFromSourceRange(
            kclManager.ast,
            targetSourceRange
          )
          const selection = {
            codeRef: {
              range: targetSourceRange,
              pathToNode,
            },
            artifact,
          }
          deleteSelectionPromise(selection)
            .then((result) => {
              if (err(result)) {
                reject(result)
                return
              }
              resolve(result)
            })
            .catch(reject)
        })
      }
    ),
  },
  actions: {
    saveTargetSourceRange: assign({
      targetSourceRange: ({ event }) =>
        'data' in event && !err(event.data)
          ? event.data.targetSourceRange
          : undefined,
    }),
    saveCurrentOperation: assign({
      currentOperation: ({ event }) =>
        'data' in event && 'currentOperation' in event.data
          ? event.data.currentOperation
          : undefined,
    }),
    clearContext: assign({
      targetSourceRange: undefined,
    }),
    sendSelectionEvent: () => {},
    openCodePane: () => {},
    sendEditFlowStart: () => {},
    scrollToError: () => {},
    sendDeleteSelection: () => {},
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QDMwEMAuBXATmAKnmAHQCWEANmAMRQD2+dA0gMYUDKduLYA2gAwBdRKAAOdWKQyk6AOxEgAHogCMAFhXF+27QDYArAGZ9AJhWGAHIYA0IAJ6q1ATkPELFkxf1qL-NQHYLNX0AXxDbVExcAiIyShpYMCoWDAB5UTAcTBlZAWEkEHFJaTkFZQQVJ00dPSNTcytbBwRnXWJ-fR0Op3cXJzUwiPRsPEIwEnIqajBZDEyAUQgpADEKOgB3PIUiqRyy1V1qmoNjM0sbe1V1TSd-XV1+XUM-EyeB8JBIkZjxuKmIJJgObpTLZORbAo7EryArlFQWI46E71c5NRD+fxqdqdfivDQmfx+QyDT7DaJjCbxWgMOjzHA4Og4CFiCS7UqwxBmRG1U4NC7NFSBYgmHH8O5VfgeR4kr7k2L0UiyKCMVgcLg4HjERLJaRK6jasApSDMwqs6H7Cr8IzEfQqby6NS4-ROK1ONEVfT6Npefr8FTmZyGXQysmjeV0RXK5hsTjcEgQOQ0E1QvYciqGbmPOpnCy6d0qe5OYjGFyBEVVExOENRMO-BVKlUx9WaugZWSRgDCdABAAU0LIaCxu2A+wOQQOIMmzanQOVDiZiA7XfwXK8MxZ857vc7Hf7DIHgx9ZbWSAaUpGtYDz3qz3NJ0JttP2bPELoLEWESK1CYTK6TBn3U9It-FeT1DCcSs-FMatvgpS8dQvBMB2oKdihnJRVH8TNkRzPNLgQJwnH0YhBScAxBQsEC7mJI9Qx+EgZjmHBI0WFY1nWeDDV1KB9SvO9ULZGEXwQIwF0MTwVDxPEN3wyTnkXL1nl0SsnmMUJaJrejiEYzIWKWDBVg2YgkKTB9ISfISMI9bDswaPCBUMDpF3En13CscSqw02DYh05ilVYgz2OIUQ8FENA8ACrsAFsov7CBqBMshZAANzoABrEhjy03y9LYoyQrAMKIv06LYtkCAEEVVKWDBXIhAE800wg1wvRFZ1XjI55-HzTwLBIlzCStbxKxooZNLgnL-P0wyOIKoqwEiugYri6Z6UZYKKEwZBGSi4gsom2ZdKmvLZtC8KFpKpayoqqq6Bq6E8ga9Dymam1lKAjqnjFfNKmI0j-EMSwfwxMUYLlX4ASobiQSyaFOOvHjb2NMyWTQ58rM9MSJO0NQHXcNR+UQLx+GFfgMw0XHcatFQwZPYzAWhjJYZyYzExQlHTTRyzyl-GzeVRfDHL65xCNXf0TGCfdaa0yGgUjGHavpqHI3YPicgSxMktSjK9rouDZcZ0E4YNlW1bkSqUru2rHo5lN0Ze79SeeXxnluKp9HdF1-EXfwyMOIiCZAw8xu8iGGflpnFZNpVVYQuRVoZHANq2nbdfG2Jo6gBXjfDmOzdkC3qut+rbYsi1+gXX9nbJldfbtd0ESxIP9AxB1nCtd4Q-Bkh6yjOlE+IVsZk7YdR0HUf+zAcdkfyVHBItZ02lFN9yy6kx3TMPrRXMAlAc6dSu7p3vGH79aTPZ2fOfntMuS0Y5bIF5pAczQHAn3Aswg+WRh3gAp9qIR8XMLQAFp7KIGARLaWcFJhgEAdfYS358xkXaFRDMmJ-TKXuFA8MkZGxqjjHAxqwl9yuAeC4ZS-QAZmAdPmNQuNiw7kopUbQv1sF1gjA2aM+CNSnjVkqQhz0iZWmLJJCmLdTCNFkkYVwPoCaVB6PoBEwdSTp3YbgrhsYeGswHAI+2VxfZaGUnvDEPRvpSMBm4HcGZCJeCUWwnuHCoyqk0S2NsI9eyT10dzRA4FNBkKDJWAI4kCxqE3BY2R1iFF2K8t3eG3EvEWnAqQlclh3ySiqADbq+E6FFh-AYZSK4XAaH8PYuJF5byRgSWmOhfiUm9HSYKRygEgztFAooqwKgVzQRiXTCpSptGwPMkAtMCJiIlg0OBZ0HhEH4SMG0Zu7SMxdJMKUyaUAAozSqcQp4i46lpPfI0rJAoyZYl0L7B0BZeYWFWYdPy6zppBT6VALZVkNC1JcPUg5mSeoZhIopR4Kk94HxUaHBitzcqBSMiZF5cICze03i7PwZFtDr1kj+LEdoKEQTuD4EpPTsrguOpC06hVzqLWWuVGFr4W5uExDY+EZMEQqB6mKBSykvD-jOZ5Q+Mtc5Z0jkQq+gryjnF2eQwJVCQnugMFiPJnpCTqCsN+Upmds4syeVSlovz-EUKCdQ0J+FibtDJv6T0NcVydxBbE1VAqWbQqGfAqy-ogjEBFkwlcdpBQGuaEEVwhIMyCnMISV4NN8X6z5WquQSs5Z5zjpZO23iEBnO9pRZwIFN6BG8A3AkTtJJ+CtK6S1-81GcNPjgTV4lva40ou4YwkohretUJKO+OggjsucKGnlcFj60jWknIe7YlRdg8Toh1wqfFOWrYEKwnRfCekbRUIiNoai2n6A8EU1yw04NLX2gZmrAhFkDQcl0v0ghIOIqKama6nSbrCEAA */
  id: 'featureTree',
  description: 'Workflows for interacting with the feature tree pane',
  context: ({ input }) => input,
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
          actions: ['saveTargetSourceRange', 'saveCurrentOperation'],
        },

        enterAppearanceFlow: {
          target: 'enteringAppearanceFlow',
          actions: ['saveTargetSourceRange', 'saveCurrentOperation'],
        },

        deleteOperation: {
          target: 'deletingOperation',
          actions: ['saveTargetSourceRange'],
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
          entry: ['clearContext'],
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
          entry: 'clearContext',
        },
      },

      initial: 'selecting',
    },

    enteringEditFlow: {
      states: {
        selecting: {
          on: {
            selected: {
              target: 'prepareEditCommand',
              reenter: true,
            },
          },
        },

        done: {
          always: '#featureTree.idle',
        },

        prepareEditCommand: {
          invoke: {
            src: 'prepareEditCommand',
            input: ({ context }) => {
              const artifact = context.targetSourceRange
                ? getArtifactFromRange(
                    context.targetSourceRange,
                    kclManager.artifactGraph
                  ) ?? undefined
                : undefined
              return {
                // currentOperation is guaranteed to be defined here
                operation: context.currentOperation!,
                artifact,
                commandBarSend: commandBarActor.send,
              }
            },
            onDone: {
              target: 'done',
              reenter: true,
            },
            onError: {
              target: 'done',
              reenter: true,
              actions: ({ event }) => {
                if ('error' in event && err(event.error)) {
                  toast.error(event.error.message)
                }
              },
            },
          },
        },
      },

      initial: 'selecting',
      entry: 'sendSelectionEvent',
      exit: ['clearContext'],
    },

    enteringAppearanceFlow: {
      states: {
        selecting: {
          on: {
            selected: {
              target: 'prepareAppearanceCommand',
              reenter: true,
            },
          },
        },

        done: {
          always: '#featureTree.idle',
        },

        prepareAppearanceCommand: {
          invoke: {
            src: 'prepareAppearanceCommand',
            input: ({ context }) => {
              const artifact = context.targetSourceRange
                ? getArtifactFromRange(
                    context.targetSourceRange,
                    kclManager.artifactGraph
                  ) ?? undefined
                : undefined
              return {
                // currentOperation is guaranteed to be defined here
                operation: context.currentOperation!,
                artifact,
                commandBarSend: commandBarActor.send,
              }
            },
            onDone: {
              target: 'done',
              reenter: true,
            },
            onError: {
              target: 'done',
              reenter: true,
              actions: ({ event }) => {
                if ('error' in event && err(event.error)) {
                  toast.error(event.error.message)
                }
              },
            },
          },
        },
      },

      initial: 'selecting',
      entry: 'sendSelectionEvent',
      exit: ['clearContext'],
    },

    deletingOperation: {
      states: {
        selecting: {
          on: {
            selected: {
              target: 'deletingSelection',
              reenter: true,
            },
          },
        },

        done: {
          always: '#featureTree.idle',
        },

        deletingSelection: {
          invoke: {
            src: 'sendDeleteCommand',
            input: ({ context }) => {
              const artifact = context.targetSourceRange
                ? getArtifactFromRange(
                    context.targetSourceRange,
                    kclManager.artifactGraph
                  ) ?? undefined
                : undefined
              return {
                artifact,
                targetSourceRange: context.targetSourceRange,
              }
            },
            onDone: {
              target: 'done',
              reenter: true,
            },
            onError: {
              target: 'done',
              reenter: true,
              actions: ({ event }) => {
                if ('error' in event && err(event.error)) {
                  toast.error(event.error.message)
                }
              },
            },
          },
        },
      },

      initial: 'selecting',
      entry: 'sendSelectionEvent',
      exit: ['clearContext'],
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
