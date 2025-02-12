import { Artifact, getArtifactFromRange } from 'lang/std/artifactGraph'
import { SourceRange } from 'lang/wasm'
import { enterEditFlow, EnterEditFlowProps } from 'lib/operations'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import toast from 'react-hot-toast'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'
import { assign, fromPromise, setup } from 'xstate'
import { commandBarActor } from './commandBarMachine'
import { getNodePathFromSourceRange } from 'lang/queryAstNodePathUtils'
import { deleteSelectionPromise, deletionErrorMessage } from 'lang/modifyAst/deleteSelection'

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
      data: { targetSourceRange: SourceRange; currentOperation: Operation }
    }
  | {
      type: 'enterEditFlow'
      data: { targetSourceRange: SourceRange; currentOperation: Operation }
    }
  | { type: 'goToError' }
  | { type: 'codePaneOpened' }
  | { type: 'selected' }
  | { type: 'operationsChanged' }
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
  /** @xstate-layout N4IgpgJg5mDOIC5QDMwEMAuBXATmAKnmAHQCWEANmAMRQD2+dA0gMYUDKduLYA2gAwBdRKAAOdWKQyk6AOxEgAHogCMAFn7EAnDq0AOAEwqAzCq0A2Ffz0AaEAE9VagOxrtBiwFYVe88dd6AL6BdqiYuAREZJQ0sGBULBgA8qJgOJgysgLCSCDiktJyCsoIKuaauvpGphZWtg6IahbErjpq5WqeanoqBmrBoejYeIRgJORU1GCyGGkAohBSAGIUdADu2Qr5UpnFquXauoYmZpbWdo6lvcbE-AbGpp5aRlrGHgMgYcORY9GTEPEwLMUmkMnJNrltoV5LkSipnBUjtVTnULohnJZiJ57m8tBi-J49FoPl8IqNxjFaAw6HMcDg6DgIWIJDsirDVMZETpjjUzvVLvC9MQ+tznMZPJ5-NiSUMyVF6KRZFBGKwOFwcDxiHEEtIldRtWBEpAmXkWdC9qV+JKsSous4DIYDNjjGo0aVJc5tPxzC8NOYmsYgiFPrKRvK6Irlcw2JxuCQIHIaCaobt2aVOYducjaucGqVzJ5NH6fDoJZ5nK8ZeEw78FUqVTH1Zq6KlZJGAMJ0AEABTQshoLC7YF7-ZB-YgybNqdAJUsBmI-u9Jh0KisZjdtv8Xp9Zj9AaDg2rPxIBsSka1gLPetPswnQi2U7ZM8QBa0xB6fQ-en43OMbolb72gWJiEo6zhVt85IXjq54Jv21CTgU05KKoCKZlUJw5vyiB4uYwoGP6FimJ0zi2hBcq-NMsw4JGCzLKsazQYaupQPql63ohrIws+CCSvObzfnopgeE8eIbkYKgtPwnLGG01zWORNYkFRaS0YsGArOsxBwUm96Qo+3Eoe6XIYbyqJ5iBeHmBW5j+norhPN6inHsQKk0UqdEaQxxCiHgohoHgnmdgAtsFfYQNQOlkLIABudAANYkKSSmuTMqkeepmmMb5YD+YF6khWFsgQAgipxSwYJZEInHmmmzw3J4PqyQY-BioSxjmOJ5hvvCWjliBZRqA8zlQW5an0VpOV5WAQV0KF4VTHSDI+RQmDIAywXEMlLljRlE3ZX5AUzQVc1FSVZV0BV0LZDVyElPVWJNc8rXikJnUWfCeEGARnTmL4BFlMYI1RACVAsSC6TQkxV6sTexp6cySFPkZXT8Q66gePwZi2s4bp6IWLQEdi3jPGY-D9MG21QaDQKRhDlXaYCLHsOxmTUC2oLQrA7YABZ9jAd45IjXEWqTwo+D0VjOOWdx4wTQGFgYzjK-1B4hke1NM3TqSQ5k2mJghCOmkjhlwgTlQ8iiuaXP4QpNKWWhWn49x+MDtYRvWNJLTgxAc22Sqdj2fYDkOI5gGO8NC8bItpt4eH21oTR6O0LXk26Rh25UfX48najqG7JB1lGtL0j7OmG1HKbI3CGjoZbWFug8Jn46137WF0wTBrIQ7wLkVNEA+JsWgAtO9lzD30tz8NPM+z9PQOU6GLkTGAg8xzxagGG6eJuHOyfit6rXkwXxBFw2apxmvtU8S6NzlK8snlM49l9Rum+esWgbtGoeeuCfZ-RgvhqE8rMlRXzuogb8nhiDCU3tYVuz9PAbm8G4R2lg+qBlaqWf+HsoyqljMA-W-ZwHV1UL1W4PohpH2VqRLeFkUHbjMJKb8FY+o4MjOfAhzZWwdlDsHEhptECyUkvfB4FgEGv3oeoRhGCWHYMXhrKIN5IwCItB1O+P4OqJ0TtJaWro8w-zfN9As31OQp26CfZRSpoYsVUWmPOIjNHdSaBoKU+jLiSjwgrXc3Ruo-ksaAqARDV76SHmmRBMCnhDS0GUShlh-wdUJsBROvjHbEgUZBKIu0oCeSynYm+fgFyaMfhIpBFksbQKAi4O4zw9C+E8CfbJuTvJWKgPkoyDiikP3Ec-CsZSBRGHnC1Dw34yhEnUGrfulE0ruRyZlbyOl2lwjKJ6DO98MTeh6GPVQLVoEtRkmYN4tlzCNJmeNLyk1Dr5SkIVcKSyXzlnfK0Iw1SjDYg3BLKSnJbQxIlB1BpGSKLxi1kqem19o7gpKP4DR3Sn4v36Q8twxiUF3BdAicCgKUo03BjrBmrT7kIE3o42FpS5aSWMe0LoZh7KbxPti7WnM9b0qVCzGCyMq6CIQLZT0NL9C9E3pKW0eNpEK2nk8N408KaHkyb8ZlUAwVMsTAS1cSttB-QrLaaSTxvpkvwv6Ased9CuAMOwz2JcGQEr6B-dV4p7jYkTmUDcrV0IPyeGUJWGLpVAtPrgxg5qfZ+14UHYhoT15GREsQdo9lbW2odds0ofVI2VCtNJb6dSTWYpcgA-1wSCUIh6qRLZQ17VvA3ImhOjtCxvAdIYTugQgA */
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

        deleteOperation: {
          target: 'deletingOperation',
          actions: ['saveTargetSourceRange', 'saveCurrentOperation'],
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
                    engineCommandManager.artifactGraph
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
                    engineCommandManager.artifactGraph
                  ) ?? undefined
                : undefined
              return {
                // currentOperation is guaranteed to be defined here
                operation: context.currentOperation!,
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
