import { assign, setup, fromPromise } from 'xstate'
import type { ActorRefFrom } from 'xstate'

import { ACTOR_IDS } from '@src/machines/machineConstants'
import { S, transitions } from '@src/machines/utils'

import type { Selections } from '@src/lib/selections'
import type { Project } from '@src/lib/project'
import type { Prompt } from '@src/lib/prompt'
import { generateFakeSubmittedPrompt, PromptType } from '@src/lib/prompt'
import {
  textToCadMlConversations,
  IResponseMlConversations,
} from '@src/lib/textToCad'

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
  GetConversationsThatCreatedProjects = 'get-conversations-that-created-projects',
  GetConversationBelongingToProject = 'get-prompts-belonging-to-project',
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
      type: MlEphantManagerTransitions.GetConversationsThatCreatedProjects
    }
  | {
      type: MlEphantManagerTransitions.GetConversationBelongingToProject
      conversationId: string
    }
  | {
      type: MlEphantManagerTransitions.PromptCreateModel
      projectForPromptOutput: Project
      prompt: string
    }
  | {
      type: MlEphantManagerTransitions.PromptEditModel
      projectForPromptOutput: Project
      prompt: string
      fileSelectedDuringPrompting: string
      projectFiles: Project[]
      selections: Selections
      artifactGraph: ArtifactGraph
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

  conversations: IResponseMlConversations

  // A cache of prompts
  promptsPool: Map<Prompt['id'], Prompt>

  // Project related data is reset on project changes.
  // If no project is selected: undefined.
  promptsBelongingToProject?: Set<Prompt['id']>
  pageTokenPromptsBelongingToProject?: string

  // When prompts transition from in_progress to completed
  // NOTE TO SUBSCRIBERS! You must check the last event in combination with this
  // data to ensure it's from a status poll, and not some other event, that
  // update the context.
  promptsInProgressToCompleted: {
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
      project: Project

      // The file that was the "target" during prompting.
      targetFile: string
    }
  >
}

export const mlEphantDefaultContext = () => ({
  apiTokenMlephant: undefined,
  conversations: {
    items: [],
    next_page: undefined,
  },
  promptsPool: new Map(),
  promptsBelongingToProject: undefined,
  promptsInProgressToCompleted: {
    promptsBelongingToProject: [],
  },
  promptsMeta: new Map(),
  conversationsMeta: new Map(),
})

export const mlEphantManagerMachine = setup({
  types: {
    context: {} as MlEphantManagerContext,
    events: {} as MlEphantManagerEvents,
  },
  actors: {
    [MlEphantManagerTransitions.GetConversationsThatCreatedProjects]:
      fromPromise(async function (args: {
        input: {
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context
        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        const conversations: IResponseMlConversations =
          await textToCadMlConversations(context.apiTokenMlephant, {
            pageToken: context.conversations.next_page,
            limit: 20,
            sortBy: 'created_at',
          })

        const nextItems = context.conversations.items.concat(
          conversations.items
        )

        return {
          conversations: {
            items: nextItems,
            next_page: conversations.next_page,
          },
        }
      }),
    [MlEphantManagerTransitions.GetConversationBelongingToProject]:
      fromPromise(async function (args: {
        input: {
          event: XSEvent<MlEphantManagerTransitions.GetConversationBelongingToProject>
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context
        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        // fetch(somes hit here) and we're almost there
        console.log("HI", args)

        return { }
      }),
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
            // const response = await submitTextToCadCreateRequest(
            // prompt,
            // projectName,
            // token
            // )
            // project.conversationId = response.conversationId
            // writeToFile(project)

            const result = generateFakeSubmittedPrompt({
              prompt: args.input.event.prompt,
            })
            result.status = 'in_progress'

            const promptsPool = context.promptsPool
            const promptsBelongingToProject = new Set(
              context.promptsBelongingToProject
            )
            const promptsMeta = new Map(context.promptsMeta)

            promptsPool.set(result.id, result)
            promptsBelongingToProject.add(result.id)
            promptsMeta.set(result.id, {
              type: PromptType.Create,
              project: args.input.event.projectForPromptOutput,
            })

            resolve({
              promptsBelongingToProject,
              promptsMeta,
            })
          }, 1000)
        })
      }
    ),
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

        // const requestData = constructMultiFileIterationRequestWithPromptHelpers({
        //  // Need to implement, could be undefined if not created with text to cad.
        //   conversationId: project.conversationId,
        //   prompt,
        //   selections,
        //   projectFiles,
        //   token,
        //   artifactGraph,
        //   projectName,
        // })
        // const response = await submitTextToCadMultiFileIterationRequest(requestData, token)
        // if no conversation id:
        // project.conversationId = response.conversation_id
        // writeTofile(project)

        const result = generateFakeSubmittedPrompt({
          prompt: args.input.event.prompt,
        })
        result.status = 'in_progress'
        result.outputs = {}

        const promptsPool = context.promptsPool
        const promptsBelongingToProject = new Set(
          context.promptsBelongingToProject
        )
        const promptsMeta = new Map(context.promptsMeta)

        promptsPool.set(result.id, result)
        promptsBelongingToProject.add(result.id)
        promptsMeta.set(result.id, {
          type: PromptType.Edit,
          targetFile: args.input.event.fileSelectedDuringPrompting,
          project: args.input.event.projectForPromptOutput,
        })

        return {
          promptsBelongingToProject,
          promptsMeta,
        }
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
              promptsBelongingToProject: new Set(),
            }
            const promptsBelongingToProject = context.promptsBelongingToProject

            promptsPool.values().forEach((prompt) => {
              // Replace this with the actual request call.
              if (prompt.status !== ('in_progress' as any)) return
              prompt.status = 'completed'

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
        src: MlEphantManagerTransitions.GetConversationsThatCreatedProjects,
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
                MlEphantManagerTransitions.GetConversationsThatCreatedProjects,
                MlEphantManagerTransitions.GetConversationBelongingToProject,
                MlEphantManagerTransitions.PromptCreateModel,
                MlEphantManagerTransitions.PromptEditModel,
              ]),
            },
            [MlEphantManagerTransitions.GetConversationsThatCreatedProjects]: {
              invoke: {
                input: (args) => ({
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.GetConversationsThatCreatedProjects,
                onDone: {
                  target: S.Await,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await },
              },
            },
            [MlEphantManagerTransitions.GetConversationBelongingToProject]: {
              invoke: {
                input: (args) => ({
                  event:
                    args.event as XSEvent<MlEphantManagerTransitions.GetConversationBelongingToProject>,
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.GetConversationBelongingToProject,
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
            [MlEphantManagerTransitions.PromptEditModel]: {
              invoke: {
                input: (args) => ({
                  event:
                    args.event as XSEvent<MlEphantManagerTransitions.PromptEditModel>,
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.PromptEditModel,
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
