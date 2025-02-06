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
      type: 'enterEditFlow'
      data: { targetSourceRange: SourceRange; currentOperation: Operation }
    }
  | {
      type: 'enterDeleteFlow'
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
    prepareDeleteCommand: fromPromise(
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
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QDMwEMAuBXATmAKnmAHQCWEANmAMRQD2+dA0gMYUDKduLYA2gAwBdRKAAOdWKQyk6AOxEgAHogCMAFn7EAbAFYAHAHYAnGoOm9OgMw6tAGhABPRBsvF+a6wYBM-A-0uWepYGAL4h9qiYuAREZJQ0sGBULBgA8qJgOJgysgLCSCDiktJyCsoIKipabmo6-Co2Wip+-DoG9k4IWpp+Ae6W-N16KpZeYRHo2HiEYCTkVNRgshiZAKIQUgBiFHQA7nkKRVI5ZapergN6el46515GVdYdiN4GbjpGXiNGV2pan+MQJEpjFZnEFvRGKscDg6DgDgUjiV5AVylU3sEjFo-P9fINRs8KpU9MRrLp+CZPkF9IDgdEZiR6KRZFBGKwOFwcDxiIlktIWdReWAUpAEWIJMdSqjVK0VMQzN1LCoTGofPwvIS-jpiJ8DFo1OoDA13GNwkDJvTYkyWWy2JxuCQIHIaGLChLkacKm15TodGoPAYlRT-O1HIg6ppDF5rvpmmZLLSLdMrXRmazmHbOdy6BlZGmAMJ0CBgAAKaFkNBYRdL5bA6SWoqEh3dJ2lXUqxDa2O8JkM+ksmt0Oq8er0-S8quCiaiybBQpSaZ5SWF-KgguXIogrqRrdA5X1JIMbSPZn9lg0KkJzVcrU+XlxDSM6unIIZS75i6dFeo25bUr3qgGIeRiNH4JhfN4aiEhO1QfHoIH6n6DyBloL6WmCSwrDgabrFsOy7O+K5puufKNvk4rFLuSjhv62hBKY1h-PRUFhggwxeJ2Pa6D4hj1KEZp0rOJCYZkOEbBg2x7MQX4uk2iJ-iiAEVFo1T6ho9S+PoXjaYSwxqMQKj+EYepNEYowfGhQnECJ2EsrhEn4cQoh4KIaB4PZhYALaeeWEDUDJZCyAAbnQADWJCCaCwnLKJdniZJBHOWArnueJXk+bIEAIMyIUsNkch5L+lH-tRCAGtqxlaFcNgqGO3YsZ0ZlGDq+ggWO7j+NYllRdZMW2VA9kJU5LluWAHl0N5vmLDCcJORQmDIHCnnEJFb42WJeFSUlKVjWlE0ZVlOV0HlyKFXJFGSoppXlTqo4WE0dUGGYhJGD8OrKhYwwgYx-ETDOPXWum0KwjgxA5ksBbVmW35VsW0N1rmZHNsVV37pYzU2DohlPYE7hWFe2kcU9Jj8Pwei6K9ah6N1b6A1CM2gzJP7nW6KOevoxB-Aa-oPBSVMBDoBPqMQ95qCBxL6ueOhhGasjVvABSrUQyOXZ6AC0disWrfjaFVpPWNc8FfAmAlJj18xgCrHptqqV5-No6htMMSqBr6NMpmmtocg6VtUeU54cTYernkxWgTvjrHWNqYvBOegbaX4v3mv9tOpjaGbe1yJDzquvsleUY6uL6Hy+uoHjwZerH+hxesgRSXwqOcbumynHvp+y9pZ9Jzp56jqjNKp6qBvUfpi38mqqnRFJ1J8lRN9LLevm36Yd1mJDg3mLKFnDta9566OaEHWgh1VYe1AOVeT7XATdFjHznu7c4brn8ls221iB9ix-+qf4cX50YdtA3HOIMEY5MqaP2zs-RcOc0x7xtqTTsX8T7kz-nbZq7ExaBifPcUmC8-pLyfh+Fk3cKzwKUjjB2tQRjBGoX6K8gYRYjkJoaYIVRIG9SwhtByexyGlUsPqYgVxmimBwU+BooYAG3FJMMCk9EqoTiTkrDCfVuFDVgSyPh5QDQcWEWYYw6pxFtF0o3EWGhPh1ANEaCyi90LRS4XFTaBEZJaOcA0Tm55Rj+isdYdwukjxuE+CYLStwY4cPWo4nhiURqpSkOlXyriECBjlIGM8A9DJkw1KxYY1RAh3gCIEbx1NbFWTpnQYGcJEkCNgr6LEAw-T3jDleSomgzI3F0AbLsHCykVNBhvSGO8yGv1VjbYWxc6mtFVCpLJnRKhvTmU+fWFhAjdLTkDBmpDLbDOtkpcmcoeKFPcGORukj+7zOVIs-wyzrgyxCEAA */
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

        enterDeleteFlow: {
          target: 'enteringDeleteFlow',
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

    enteringDeleteFlow: {
      states: {
        selecting: {
          on: {
            selected: {
              target: 'prepareDeleteCommand',
              reenter: true,
            },
          },
        },

        done: {
          always: '#featureTree.idle',
        },

        prepareDeleteCommand: {
          invoke: {
            src: 'prepareDeleteCommand',
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
