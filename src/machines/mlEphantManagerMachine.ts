import { connectReasoningStream } from '@src/lib/reasoningWs'
import { assertEvent, assign, setup, fromPromise, sendTo } from 'xstate'
import type { ActorRefFrom } from 'xstate'

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
  textToCadPromptFeedback,
  getTextToCadCreateResult,
  submitTextToCadCreateRequest,
  type IResponseMlConversations,
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
  GetReasoningForPrompt = 'get-reasoning-for-prompt',
  PromptEditModel = 'prompt-edit-model',
  PromptCreateModel = 'prompt-create-model',
  PromptFeedback = 'prompt-feedback',
  ClearProjectSpecificState = 'clear-project-specific-state',
  AppendThoughtForPrompt = 'append-thought-for-prompt',
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
      nextPage?: string
    }
  | {
      type: MlEphantManagerTransitions.GetReasoningForPrompt
      promptId: string
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
      type: MlEphantManagerTransitions.PromptFeedback
      promptId: string
      feedback: Prompt['feedback']
    }
  | {
      type: MlEphantManagerTransitions.ClearProjectSpecificState
    }
  | {
      type: MlEphantManagerTransitions.AppendThoughtForPrompt
      promptId: string
      thought: Thought
    }

// Used to specify a specific event in input properties
type XSEvent<T> = Extract<MlEphantManagerEvents, { type: T }>

export interface Thought {
  reasoning?:
    | { type: 'text'; content: string }
    | { type: 'kcl_code_examples'; content: string }
    | { type: 'kcl_docs'; content: string }
    | { type: 'generated_kcl_code'; code: string }
    | { type: 'feature_tree_outline'; content: string }
    | { type: 'error'; content: string }
  tool_output?: {
    result: {
      type: 'text_to_cad'
      outputs: Record<string, string>
      status_code: number
    }
  }
}

export interface PromptMeta {
  // If it's a creation prompt, it'll run some SystemIO code that
  // creates a new project and other goodies.
  type: PromptType

  // Where the prompt's output should be placed on completion.
  project: Project

  // The file that was the "target" during prompting.
  targetFile?: FileEntry

  // The reasoning occurring on the prompt
  thoughts: Thought[]
}

export interface MlEphantManagerContext {
  apiTokenMlephant?: string

  conversations: IResponseMlConversations

  // The full prompt information that ids map to.
  promptsPool: Map<Prompt['id'], Prompt>

  // Project related data is reset on project changes.
  // If no project is selected: undefined.
  promptsBelongingToConversation?: Prompt['id'][]
  pageTokenPromptsBelongingToConversation?: string

  // When prompts transition from in_progress to completed
  // NOTE TO SUBSCRIBERS! You must check the last event in combination with this
  // data to ensure it's from a status poll, and not some other event, that
  // update the context.
  promptsInProgressToCompleted: Set<Prompt['id']>

  // The current conversation being interacted with.
  conversationId?: string

  // Metadata per prompt that needs to be kept track separately.
  promptsMeta: Map<Prompt['id'], PromptMeta>
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
            promptsBelongingToConversation: [],
          }
        }

        const result = await textToCadMlPromptsBelongingToConversation(
          context.apiTokenMlephant,
          {
            conversationId: args.input.event.conversationId,
            pageToken: args.input.event.nextPage,
            limit: 20,
            sortBy: 'created_at_descending',
          }
        )

        if (err(result)) {
          return Promise.reject(result)
        }

        // Clear the prompts pool and what prompts we were tracking.
        const promptsPoolNext = new Map(context.promptsPool)
        let promptsBelongingToConversationNext: MlEphantManagerContext['promptsBelongingToConversation'] =
          []

        result.items.reverse().forEach((prompt) => {
          promptsPoolNext.set(prompt.id, { ...prompt, source_ranges: [] })
          promptsBelongingToConversationNext?.push(prompt.id)
        })

        promptsBelongingToConversationNext =
          promptsBelongingToConversationNext.concat(
            context.promptsBelongingToConversation ?? []
          )

        return {
          conversationId: args.input.event.conversationId,
          promptsPool: promptsPoolNext,
          promptsBelongingToConversation: promptsBelongingToConversationNext,
          pageTokenPromptsBelongingToConversation: result.next_page,
        }
      }
    ),
    // This is a kind of special transition.
    // We spawn the websocket, and then go back to the idling state.
    // That socket then can send more messages to the machine.
    // In a sense, it's an action.
    [MlEphantManagerTransitions.GetReasoningForPrompt]: fromPromise(
      async function (args: {
        input: {
          event: XSEvent<MlEphantManagerTransitions.GetReasoningForPrompt>
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        if (args.input.context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        connectReasoningStream(
          args.input.context.apiTokenMlephant,
          args.input.event.promptId,
          {
            on: {
              message(msg: any) {
                if (!msg) return

                if ((msg as Thought).reasoning) {
                  sendTo(args.input.event.refParent, {
                    type: MlEphantManagerTransitions.AppendThoughtForPrompt,
                    promptId: args.input.event.promptId,
                    thought: msg,
                  })
                }
              },
            },
          }
        )

        return {}
      }
    ),
    [MlEphantManagerTransitions.PromptCreateModel]: fromPromise(
      async function (args: {
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

        const promptsPool = new Map()
        // We're going to create a new project so it'll be the first
        const promptsBelongingToConversation = []
        const promptsMeta = new Map()

        promptsPool.set(result.id, { ...result, source_ranges: [] })
        promptsBelongingToConversation.push(result.id)
        promptsMeta.set(result.id, {
          type: PromptType.Create,
          project: args.input.event.projectForPromptOutput,
          thoughts: [],
        })

        return {
          promptsPool,
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
        const promptsBelongingToConversation = Array.from(
          context.promptsBelongingToConversation ?? []
        )
        const promptsMeta = new Map(context.promptsMeta)

        promptsPool.set(result.id, {
          ...result,
          prompt: result.prompt ?? '',
          output_format: 'glb', // it's a lie. we have no 'none' type...
        })
        promptsBelongingToConversation.push(result.id)
        promptsMeta.set(result.id, {
          type: PromptType.Edit,
          targetFile: args.input.event.fileSelectedDuringPrompting,
          project: args.input.event.projectForPromptOutput,
          thoughts: [],
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
    [MlEphantManagerTransitions.PromptFeedback]: fromPromise(
      async function (args: {
        input: {
          event: XSEvent<MlEphantManagerTransitions.PromptFeedback>
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        const context = args.input.context

        if (context.apiTokenMlephant === undefined)
          return Promise.reject('missing api token')

        const promptsPoolNext = new Map(args.input.context.promptsPool)
        const prompt = promptsPoolNext.get(args.input.event.promptId)
        if (!prompt) {
          return Promise.reject(new Error('Cant find prompt'))
        }
        prompt.feedback = args.input.event.feedback

        await textToCadPromptFeedback(context.apiTokenMlephant, {
          id: args.input.event.promptId,
          feedback: args.input.event.feedback,
        })

        return {
          promptsPool: promptsPoolNext,
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

          // Only check on prompts that need checking lol
          if (
            ['in_progress', 'queued', 'uploaded'].includes(prompt.status) ===
            false
          ) {
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

          // It's not done still.
          if (
            ['in_progress', 'queued', 'uploaded'].includes(result.status) ===
            true
          ) {
            continue
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
                MlEphantManagerTransitions.GetReasoningForPrompt,
                MlEphantManagerTransitions.PromptCreateModel,
                MlEphantManagerTransitions.PromptEditModel,
                MlEphantManagerTransitions.PromptFeedback,
                MlEphantManagerTransitions.ClearProjectSpecificState,
                MlEphantManagerTransitions.AppendThoughtForPrompt,
              ]),
            },
            [MlEphantManagerTransitions.ClearProjectSpecificState]: {
              always: {
                target: S.Await,
                actions: [
                  assign({
                    promptsBelongingToConversation: undefined,
                    conversationId: undefined,
                  }),
                ],
              },
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
            [MlEphantManagerTransitions.GetReasoningForPrompt]: {
              invoke: {
                input: (args) => {
                  if (args.event.output) {
                    return {
                      event: {
                        refParent: args.self.ref,
                        promptId:
                          args.event.output.promptsBelongingToConversation.slice(
                            -1
                          )[0],
                      },
                      context: args.context,
                    }
                  }

                  return {
                    event:
                      args.event as XSEvent<MlEphantManagerTransitions.GetReasoningForPrompt>,
                    context: args.context,
                  }
                },
                src: MlEphantManagerTransitions.GetReasoningForPrompt,
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
                  target: MlEphantManagerTransitions.GetReasoningForPrompt,
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
                  target: MlEphantManagerTransitions.GetReasoningForPrompt,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await, actions: console.error },
              },
            },
            [MlEphantManagerTransitions.PromptFeedback]: {
              invoke: {
                input: (args) => ({
                  event:
                    args.event as XSEvent<MlEphantManagerTransitions.PromptFeedback>,
                  context: args.context,
                }),
                src: MlEphantManagerTransitions.PromptFeedback,
                onDone: {
                  target: S.Await,
                  actions: assign(({ event }) => event.output),
                },
                onError: { target: S.Await, actions: console.error },
              },
            },
            [MlEphantManagerTransitions.AppendThoughtForPrompt]: {
              always: {
                target: S.Await,
                actions: [
                  assign({
                    promptsMeta: ({ event, context }) => {
                      assertEvent(
                        event,
                        MlEphantManagerTransitions.AppendThoughtForPrompt
                      )
                      let next = new Map(context.promptsMeta)
                      next.get(event.promptId)?.thoughts.push(event.thought)
                      return next
                    },
                  }),
                ],
              },
            },
          },
        },
      },
    },
  },
})

export type MlEphantManagerActor = ActorRefFrom<typeof mlEphantManagerMachine>
