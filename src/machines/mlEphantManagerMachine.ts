import { assign, setup, fromPromise } from 'xstate'
import type { ActorRefFrom } from 'xstate'

import { ACTOR_IDS } from '@src/machines/machineConstants'
import { S, transitions } from '@src/machines/utils'

import type { Prompt } from '@src/lib/prompt'
import { generateFakeSubmittedPrompt, PromptType } from '@src/lib/prompt'

const MLEPHANT_POLL_STATUSES_MS = 5000

export enum MlEphantManagerStates {
  NeedDependencies = 'need-dependencies',
  Setup = 'setup',
  Ready = 'ready',
  Background = 'background',
  Foreground = 'foreground',
}

export enum MlEphantManagerTransitions {
  SetApiToken = 'set-api-token',
  GetPromptsThatCreatedProjects = 'get-prompts-that-created-projects',
  GetPromptsBelongingToProject = 'get-prompts-belonging-to-project',
  GetPromptsPendingStatuses = 'get-prompts-pending-statuses',
  PromptEditModel = 'prompt-edit-model',
  PromptCreateModel = 'prompt-create-model',
  PromptRate = 'prompt-rate',
  // Note, technically hiding.
  PromptDelete = 'prompt-delete',
}

export type MlEphantManagerEvents =
  | {
      type: MlEphantManagerTransitions.SetApiToken
      token: string
    }
  | {
      type: MlEphantManagerTransitions.GetPromptsThatCreatedProjects
    }
  | {
      type: MlEphantManagerTransitions.GetPromptsBelongingToProject
      projectId: string
    }
  | {
      type: MlEphantManagerTransitions.PromptCreateModel
      projectPathForPromptOutput: string
      prompt: string
    }
  | {
      type: MlEphantManagerTransitions.PromptEditModel
      projectId: string
      prompt: string
    }
  | {
      type: MlEphantManagerTransitions.PromptRate
      promptId: string
    }
  | {
      type: MlEphantManagerTransitions.PromptDelete
      promptId: string
    }

// Used to specify a specific event in input properties
type XSEvent<T> = Extract<MlEphantManagerEvents, { type: T }>

export interface MlEphantManagerContext {
  apiTokenMlephant?: string

  // A cache of prompts
  promptsPool: Map<Prompt['id'], Prompt>

  // Essentially prompts that were used to start a "session".
  promptsToSeedProjects: Set<Prompt['id']>
  // If no project is selected: undefined.
  promptsBelongingToProject?: Set<Prompt['id']>

  // When prompts transition from in_progress to completed
  // NOTE TO SUBSCRIBERS! You must check the last event in combination with this
  // data to ensure it's from a status poll, and not some other event, that
  // update the context.
  promptsInProgressToCompleted: {
    promptsToSeedProjects: Set<Prompt['id']>
    promptsBelongingToProject: Set<Prompt['id']>
  }

  // Metadata per prompt that needs to be kept track separately.
  promptsMeta: Map<
    Prompt['id'],
    {
      // If it's a creation prompt, it'll run some SystemIO code that
      // creates a new project and other goodies.
      type: PromptType

      // Where the prompt's output should be placed on completion.
      projectPath: string
    }
  >
}

export const mlEphantDefaultContext = () => ({
  apiTokenMlephant: undefined,
  promptsPool: new Map(),
  promptsToSeedProjects: [],
  promptsBelongingToProject: undefined,
  promptsInProgressToCompleted: {
    promptsToSeedProjects: [],
    promptsBelongingToProject: [],
  },
  promptsMeta: new Map(),
})

export const mlEphantManagerMachine = setup({
  types: {
    context: {} as MlEphantManagerContext,
    events: {} as MlEphantManagerEvents,
  },
  actors: {
    [MlEphantManagerTransitions.GetPromptsThatCreatedProjects]: fromPromise(
      async function (args: {
        input: {
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context
        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        return new Promise((resolve) => {
          setTimeout(() => {
            const results = new Array(13)
              .fill(undefined)
              .map(generateFakeSubmittedPrompt)

            const promptsPool = context.promptsPool
            const promptsToSeedProjects = new Set(context.promptsToSeedProjects)

            results.forEach((result) => {
              promptsPool.set(result.id, result)
              promptsToSeedProjects.add(result.id)
            })

            resolve({
              promptsToSeedProjects,
            })
          }, 2000)
        })
      }
    ),
    [MlEphantManagerTransitions.PromptCreateModel]: fromPromise(
      async function (args: {
        system: any
        input: {
          event: XSEvent<MlEphantManagerTransitions.PromptCreateModel>
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context
        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        return new Promise((resolve) => {
          setTimeout(() => {
            const result = generateFakeSubmittedPrompt()
            result.status = 'in_progress'

            const promptsPool = context.promptsPool
            const promptsToSeedProjects = new Set(context.promptsToSeedProjects)
            const promptsBelongingToProject = new Set(
              context.promptsBelongingToProject
            )
            const promptsMeta = new Map(context.promptsMeta)

            promptsPool.set(result.id, result)
            promptsToSeedProjects.add(result.id)
            promptsBelongingToProject.add(result.id)
            promptsMeta.set(result.id, {
              type: PromptType.Create,
              projectPath: args.input.event.projectPathForPromptOutput,
            })

            resolve({
              promptsToSeedProjects,
              promptsBelongingToProject,
              promptsMeta,
            })
          }, 1000)
        })
      },
    [MlEphantManagerTransitions.PromptEditModel]: fromPromise(
      async function (args: {
        system: any
        input: {
          event: XSEvent<MlEphantManagerTransitions.PromptEditModel>
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context
        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

          const result = generateFakeSubmittedPrompt()
          result.status = 'in_progress'

          const promptsPool = context.promptsPool
          const promptsBelongingToProject = new Set(
            context.promptsBelongingToProject
          )
          const promptsMeta = new Map(context.promptsMeta)

          promptsPool.set(result.id, result)
          promptsBelongingToProject.add(result.id)
          promptsMeta.set(result.id, {
            type: PromptType.Edit,
            projectPath: args.input.event.projectPathForPromptOutput,
          })

          resolve({
            promptsBelongingToProject,
            promptsMeta,
          })
      }
    ),
    [MlEphantManagerTransitions.GetPromptsPendingStatuses]: fromPromise(
      async function (args: {
        input: {
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context

        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        return new Promise((resolve) => {
          setTimeout(() => {
            const promptsPool = context.promptsPool
            const promptsInProgressToCompleted = {
              promptsToSeedProjects: new Set(),
              promptsBelongingToProject: new Set(),
            }
            const promptsToSeedProjects = context.promptsToSeedProjects
            const promptsBelongingToProject = context.promptsBelongingToProject

            promptsPool.values().forEach((prompt) => {
              // Replace this with the actual request call.
              if (prompt.status !== ('in_progress' as any)) return
              prompt.status = 'completed'

              if (promptsToSeedProjects.has(prompt.id)) {
                promptsInProgressToCompleted.promptsToSeedProjects.add(
                  prompt.id
                )
              }
              if (promptsBelongingToProject?.has(prompt.id)) {
                promptsInProgressToCompleted.promptsBelongingToProject.add(
                  prompt.id
                )
              }
            })

            resolve({
              promptsInProgressToCompleted,
            })
          }, 3000)
        })
      }
    ),
  },
}).createMachine({
  initial: MlEphantManagerStates.NeedDependencies,
  context: mlEphantDefaultContext(),
  states: {
    [MlEphantManagerStates.NeedDependencies]: {
      on: {
        [MlEphantManagerTransitions.SetApiToken]: {
          actions: [
            assign({
              apiTokenMlephant: ({ event }) => event.token,
            }),
          ],
          target: MlEphantManagerStates.Setup,
        },
      },
    },
    [MlEphantManagerStates.Setup]: {
      invoke: {
        input: (args: { context: MlEphantManagerContext }) => args,
        src: MlEphantManagerTransitions.GetPromptsThatCreatedProjects,
        onDone: {
          target: MlEphantManagerStates.Ready,
          actions: assign(({ event }) => event.output),
        },
        // On failure we need correct dependencies still.
        onError: { target: MlEphantManagerStates.NeedDependencies },
      },
    },
    [MlEphantManagerStates.Ready]: {
      type: 'parallel',
      states: {
        [MlEphantManagerStates.Background]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              after: {
                [MLEPHANT_POLL_STATUSES_MS]: {
                  target: MlEphantManagerTransitions.GetPromptsPendingStatuses,
                },
              },
            },
            [MlEphantManagerTransitions.GetPromptsPendingStatuses]: {
              invoke: {
                input: (args) => ({
                  event:
                    args.event as XSEvent<MlEphantManagerTransitions.GetPromptsPendingStatuses>,
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.GetPromptsPendingStatuses,
                onDone: {
                  target: S.Await,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await },
              },
            },
          },
        },
        [MlEphantManagerStates.Foreground]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              // Reduces boilerplate. Lets you specify many transitions with
              // states of the same name.
              on: transitions([
                MlEphantManagerTransitions.GetPromptsThatCreatedProjects,
                MlEphantManagerTransitions.PromptCreateModel,
              ]),
            },
            [MlEphantManagerTransitions.GetPromptsThatCreatedProjects]: {
              invoke: {
                input: (args) => ({
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.GetPromptsThatCreatedProjects,
                onDone: {
                  target: S.Await,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await },
              },
            },
            [MlEphantManagerTransitions.PromptCreateModel]: {
              invoke: {
                input: (args) => ({
                  event:
                    args.event as XSEvent<MlEphantManagerTransitions.PromptCreateModel>,
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.PromptCreateModel,
                onDone: {
                  target: S.Await,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await },
              },
            },
          },
        },
      },
    },
  },
})

export type MlEphantManagerActor = ActorRefFrom<typeof mlEphantManagerMachine>
