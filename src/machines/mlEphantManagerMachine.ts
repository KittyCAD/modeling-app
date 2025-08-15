import { assign, setup, fromPromise } from 'xstate'
import type { ActorRefFrom } from 'xstate'

import { ACTOR_IDS } from '@src/machines/machineConstants'
import { S, transitions } from '@src/machines/utils'
import { err } from '@src/lib/trap'

import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import type { FileEntry, Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'

import type { Prompt } from '@src/lib/prompt'
import { PromptType } from '@src/lib/prompt'

import {
  textToCadMlConversations,
  textToCadMlPromptsBelongingToConversation,
  getTextToCadCreateResult,
  submitTextToCadCreateRequest,
  IResponseMlConversations,
} from '@src/lib/textToCad'

import {
  getPromptToEditResult,
  submitTextToCadMultiFileIterationRequest,
  constructMultiFileIterationRequestWithPromptHelpers,
} from '@src/lib/promptToEdit'

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
  GetPromptsBelongingToConversation = 'get-prompts-belonging-to-conversation',
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
      type: MlEphantManagerTransitions.GetPromptsBelongingToConversation
      conversationId?: string
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
      fileSelectedDuringPrompting?: FileEntry
      projectFiles: FileMeta[]
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

  // The full prompt information that ids map to.
  promptsPool: Map<Prompt['id'], Prompt>

  // Project related data is reset on project changes.
  // If no project is selected: undefined.
  promptsBelongingToConversation?: Set<Prompt['id']>
  pageTokenPromptsBelongingToConversation?: string

  // When prompts transition from in_progress to completed
  // NOTE TO SUBSCRIBERS! You must check the last event in combination with this
  // data to ensure it's from a status poll, and not some other event, that
  // update the context.
  promptsInProgressToCompleted: Set<Prompt['id']>

  // The current conversation being interacted with.
  conversationId?: string

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
      targetFile?: FileEntry
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
  promptsBelongingToConversation: undefined,
  promptsInProgressToCompleted: new Set<string>(),
  conversationId: undefined,
  promptsMeta: new Map(),
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

        const conversations: IResponseMlConversations | Error =
          await textToCadMlConversations(context.apiTokenMlephant, {
            pageToken: context.conversations.next_page,
            limit: 20,
            sortBy: 'created_at_descending',
          })

        if (err(conversations)) {
          return Promise.reject(conversations)
        }

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
    [MlEphantManagerTransitions.GetPromptsBelongingToConversation]: fromPromise(
      async function (args: {
        input: {
          event: XSEvent<MlEphantManagerTransitions.GetPromptsBelongingToConversation>
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context
        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        // If no conversation id, simply initialize context.
        if (args.input.event.conversationId === undefined) {
          return {
            promptsPool: new Map(),
            promptsBelongingToConversation: new Set(),
            pageTokenPromptsBelongingToConversation: undefined,
          }
        }

        const result = await textToCadMlPromptsBelongingToConversation(
          context.apiTokenMlephant,
          {
            conversationId: args.input.event.conversationId,
            pageToken: undefined,
            limit: 20,
            sortBy: 'created_at_ascending',
          }
        )

        if (err(result)) {
          return Promise.reject(result)
        }

        // Clear the prompts pool and what prompts we were tracking.
        const promptsPoolNext = new Map()
        const promptsBelongingToConversationNext = new Set<string>()
        result.items.forEach((prompt) => {
          promptsPoolNext.set(prompt.id, prompt)
          promptsBelongingToConversationNext.add(prompt.id)
        })

        return {
          promptsPool: promptsPoolNext,
          promptsBelongingToConversation: promptsBelongingToConversationNext,
          pageTokenPromptsBelongingToConversation: result.next_page,
        }
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

        const result = await submitTextToCadCreateRequest(
          args.input.event.prompt,
          args.input.event.projectForPromptOutput.path,
          context.apiTokenMlephant
        )

        if (err(result)) {
          return Promise.reject(result)
        }

        const promptsPool = context.promptsPool
        const promptsBelongingToConversation = new Set(
          context.promptsBelongingToConversation
        )
        const promptsMeta = new Map(context.promptsMeta)

        promptsPool.set(result.id, { ...result, source_ranges: [] })
        promptsBelongingToConversation.add(result.id)
        promptsMeta.set(result.id, {
          type: PromptType.Create,
          project: args.input.event.projectForPromptOutput,
        })

        return {
          // When we release new types this'll be fixed and error
          // @ts-expect-error
          conversationId: result.conversation_id,
          promptsBelongingToConversation,
          promptsMeta,
        }
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
        const event = args.input.event

        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        const requestData = constructMultiFileIterationRequestWithPromptHelpers(
          {
            conversationId: context.conversationId,
            prompt: event.prompt,
            selections: event.selections,
            projectFiles: event.projectFiles,
            artifactGraph: event.artifactGraph,
            projectName: event.projectForPromptOutput.name,
          }
        )
        const result = await submitTextToCadMultiFileIterationRequest(
          requestData,
          context.apiTokenMlephant
        )

        if (err(result)) {
          return Promise.reject(result)
        }

        const promptsPool = context.promptsPool
        const promptsBelongingToConversation = new Set(
          context.promptsBelongingToConversation
        )
        const promptsMeta = new Map(context.promptsMeta)

        promptsPool.set(result.id, {
          ...result,
          prompt: result.prompt ?? '',
          output_format: 'glb', // it's a lie. we have no 'none' type...
        })
        promptsBelongingToConversation.add(result.id)
        promptsMeta.set(result.id, {
          type: PromptType.Edit,
          targetFile: args.input.event.fileSelectedDuringPrompting,
          project: args.input.event.projectForPromptOutput,
        })

        return {
          // Same deal here
          // @ts-expect-error
          conversationId: result.conversation_id,
          promptsBelongingToConversation,
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

        const promptsPool = context.promptsPool
        const promptsInProgressToCompleted = new Set<string>()

        for (let prompt of promptsPool.values()) {
          const promptMeta = context.promptsMeta.get(prompt.id)

          if (promptMeta === undefined) {
            continue
          }

          // This shit'll be nuked when we have pure websocket API and no diff.
          // between creation and iteration.
          let result
          if (promptMeta.type === PromptType.Create) {
            result = await getTextToCadCreateResult(
              prompt.id,
              context.apiTokenMlephant
            )
          } /* PromptType.Edit */ else {
            result = await getPromptToEditResult(
              prompt.id,
              context.apiTokenMlephant
            )
          }

          if (err(result)) {
            return Promise.reject(result)
          }

          promptsInProgressToCompleted.add(prompt.id)
          promptsPool.set(prompt.id, {
            ...result,
            prompt: result.prompt ?? '',
            source_ranges: [],
            output_format: 'glb', // it's a lie we don't give a shit what this is
          })
        }

        return {
          promptsInProgressToCompleted,
        }
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
        onError: {
          target: MlEphantManagerStates.NeedDependencies,
          actions: console.error,
        },
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
                onError: { target: S.Await, actions: console.error },
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
                MlEphantManagerTransitions.GetPromptsBelongingToConversation,
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
                onError: { target: S.Await, actions: console.error },
              },
            },
            [MlEphantManagerTransitions.GetPromptsBelongingToConversation]: {
              invoke: {
                input: (args) => ({
                  event:
                    args.event as XSEvent<MlEphantManagerTransitions.GetPromptsBelongingToConversation>,
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.GetPromptsBelongingToConversation,
                onDone: {
                  target: S.Await,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await, actions: console.error },
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
                onError: { target: S.Await, actions: console.error },
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
                onError: { target: S.Await, actions: console.error },
              },
            },
          },
        },
      },
    },
  },
})

export type MlEphantManagerActor = ActorRefFrom<typeof mlEphantManagerMachine>
