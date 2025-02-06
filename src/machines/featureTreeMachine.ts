import { getArtifactFromRange } from 'lang/std/artifactGraph'
import { SourceRange } from 'lang/wasm'
import { enterEditFlow, EnterEditFlowProps } from 'lib/operations'
import { engineCommandManager } from 'lib/singletons'
import { err } from 'lib/trap'
import toast from 'react-hot-toast'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'
import { assign, fromPromise, setup } from 'xstate'
import { commandBarActor } from './commandBarMachine'

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
  /** @xstate-layout N4IgpgJg5mDOIC5QDMwEMAuBXATmAKnmAHQCWEANmAMRQD2+dA0gMYUDKduLYA2gAwBdRKAAOdWKQyk6AOxEgAHogCMAFn7EAnDq0AOFXq0AmYwHYNagDQgAnqrVaAzMT17jBgKz8VJvWoBfAJtUTFwCIjJKGlgwKhYMAHlRMBxMGVkBYSQQcUlpOQVlBF9NXX1DE3NLG3sERwA2Ygt9NTUzY08tFXUnIJD0bDxCMBJyKmowWQxUgFEIKQAxCjoAdyyFPKkMotUGst0DI1MLfms7VXUVbTMGsyc1J1v9Jwb+kFChiNGoiamZnAAETiYBmyzWGxyWwK8hyxUMBx0Ryqp3OdVu108xgeZhUDVeWjMuPen3CIzG0VoDDosxwODoOEhYgk20KcMQxhUiIqx2qZ1qqjMemIxkcWn2bSc7iMZhJgzJkXopFkUEYrA4XBwPGIsXi0hV1F1YASkCZuRZMN2JX4nhcnhUnnaj1tThUTwFJU8niaei6r1uTh8-kCwQ+8uGiroytVzDYnG4JAgchoZuhO3ZJUD2kOlRONQuJQaDS0xCcXXMWn4919nj0crCEZ+SpVarjmu1dBSsmjAGE6BAwAAFNCyGgsftDkdgZJTU1CTYW9OgYoNFTGYgNDT7fjGIveXweh3e1x+u74oNtetfck6kEJaO3vXRw13mYQVOLtnLxANIyuNdtDaahuuKHpeiWHQNPa-BaF04oeFeCo-Ea94qsQSajtQH75EuSiCtyyJ5vyBY6J4xAqGYhKmBoSKuohjYkP8qTRvMSwrKsj7GvqUAvnqc7ZMyOFfnhCC2uuTgeDBeirt4TxmIe2KaFB+LATa3jGFW9HfIx0zMSqrEYOCHEYSm85Qp+sLfp6BG5nyaKqE8ZH4h4TivFiahesYWk3kxOAsQshnscQoh4KIaB4AZfYALZRSOEDUCZZCyAAbnQADWJCkgxxC+f5bFrMFoXhWAkV0DFcUIMqqUsOkchZNhrKWSJJh2g02IGPs0mVloCluOREl6GYMGGJRQreZEuX6QFRmFWAYURQF0WxbI8WpPSODBRQmDIAyUXEFl2k5bpflTflHEhXNxWleVK2VSldA1TC9VmYJjVWi1xDeu1eL8F1MGHr4ZEUfoEpON0bh1qGB0+cd0bAlQYJBSh3G8Vx-ELkJTXFJ5paSSDDr8HJHq+poGkSWcX2wVoIYDA2h2TVA8OgmAM0mVhL3mpjVoaTZvKoh6TzCmK0muV0v27uNPwM0ziMFRd81gDLYBLXFCXJklqUZft4b07DKpKzN8vFUrKu3VVD21ZkQgNZaGZU80hMOquUFfSoHqVmYG6jV0Z4SZ4spQzrMMAnDIKy+dRV4CbZXLatdIMpt227drdPB3pjNhyzQVG1HmemxAd3VZbz0CZzb1210Duut6eJem1bsFgYajNLuXTPODpiSyQzYxrS63EJ2Uy9hOw6YeOA6j9OXbo+ZXMZj7n38EvXWbg6boepyQuHODFG2r+XfED3jB9wnbM27hxScrzKL5nUrnckvbWOqKhJBKGsgTvAOTQ0QGPl1ZABaBoHoAGigPuMMAf9bZWTUMYQ84pmgdA6J0QarpCYHyPrGDUCYoEX0QA8Fw+xqbk3uLBPQh42hNDLM4DynIHiUIwVGFsWD4xahIMjaMuDhLFD0DaUsa5XSPDcA8deBYHSuRPM4e4MEvRbkYdGVs2C2HoWTFwrGlxKLEH4G1XcxZgJFndGIl0kiniBlgo6bR8jmHqlYR2Lsw8J5TjUVaMG1wiGPA0qQ2sh5jG+ikWY2RljA6p0iBwlUziMxg0ITBMszl7QeycB6NoJZTCrwrG0L0RID5hKgJxVCUAIkwOAhuGJ3o-alHuGBV4LdNxCi9KUvowTryhNfA+EyhSRJeFLOWVya5CQeXkgWPeNTAJni9IYA+DMDJGQ6cUV40TnBlM6KUchYjCbNzuISTqJgNBjSaUhHSIdTqBQKjk2ZiBgJuNKXElZClXTkTKapepnjJl6ygNMoK7TZ7-xEj0O4IpDDFlxDoMwWIG51DXKKB5+JnCOVaF5fZ2UpnTWzpHEqi0Y5xXOQgKCntBpqCMGuQmUpQUKSrBuR5UEya3ADrTZpUs3kG3YtiqUCzYnlMrKsuoUFm6pMcF4UUPgEV0oOUdI5GcEZZ1Oa08J3zoEiUeFcxZNzOXE28FXNcbgrgtVeeKplBUvmvXlfCTkJZvBL1KHcXwxgeqN0eFXDS+J-AWAJbq9O+qI6XVzpK-O2K7h4tBWccwS8TCGGJuYEUhMr47j0NXWlYYQlNiYb3eOOAWURrUL+GlfJKlrOFEvJesD7SCxkVYlN-dB7dhVH2Rxo4WWguIJmwadwc2JLEbBRt5RM3tC5PoYVCb6Xd2TcfVNKi61yrwQgIUJYKKAxQWWZZ8CyJih0N23EUkEVBCAA */
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
        deletingSelection: {
          entry: 'sendDeleteSelection',
        },
        done: {
          always: '#featureTree.idle',
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
