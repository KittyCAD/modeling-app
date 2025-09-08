import type { MlCopilotServerMessage } from '@kittycad/lib'
import { connectReasoningStream } from '@src/lib/reasoningWs'
import { assertEvent, assign, setup, fromPromise } from 'xstate'
import type { ActorRefFrom } from 'xstate'

import { S, transitions } from '@src/machines/utils'
import { err } from '@src/lib/trap'
import { getKclVersion } from '@src/lib/kclVersion'

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
} from '@src/lib/textToCadCore'
import { textToCadPromptFeedback } from '@src/lib/textToCad'
import type { IResponseMlConversations } from '@src/lib/textToCadTypes'

import {
  getPromptToEditResult,
  submitTextToCadMultiFileIterationRequest,
  constructMultiFileIterationRequestWithPromptHelpers,
} from '@src/lib/promptToEdit'
import toast from 'react-hot-toast'

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
      project: Project
      conversationId?: string
      nextPage?: string
    }
  | {
      type: MlEphantManagerTransitions.GetReasoningForPrompt
      // Causes a cyclic type dependency if I use MlEphantManagerActor,
      // so for now, it's any.
      refParent: any
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
      applicationProjectDirectory: string
      fileSelectedDuringPrompting: { entry: FileEntry; content: string }
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
      thought: MlCopilotServerMessage
    }

// Used to specify a specific event in input properties
type XSEvent<T> = Extract<MlEphantManagerEvents, { type: T }>

export interface PromptMeta {
  // If it's a creation prompt, it'll run some SystemIO code that
  // creates a new project and other goodies.
  type: PromptType

  // Where the prompt's output should be placed on completion.
  project: Project

  // The file that was the "target" during prompting.
  targetFile?: FileEntry
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

  // Thoughts for each prompt
  promptsThoughts: Map<Prompt['id'], MlCopilotServerMessage[]>
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
  promptsThoughts: new Map(),
})

export const mlEphantManagerMachine = setup({
  types: {
    context: {} as MlEphantManagerContext,
    events: {} as MlEphantManagerEvents,
  },
  actions: {
    toastError: ({ event }) => {
      console.error(event)
      if ('output' in event && event.output instanceof Error) {
        toast.error(event.output.message)
      } else if ('data' in event && event.data instanceof Error) {
        toast.error(event.data.message)
      } else if ('error' in event && event.error instanceof Error) {
        toast.error(event.error.message)
      }
    },
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

        const promptsPoolNext = new Map(context.promptsPool)

        // Clear what prompts we were tracking.
        let promptsBelongingToConversationNext: MlEphantManagerContext['promptsBelongingToConversation'] =
          []
        const promptsMetaNext = new Map<Prompt['id'], PromptMeta>()

        result.items.reverse().forEach((prompt) => {
          promptsPoolNext.set(prompt.id, {
            ...prompt,
            source_ranges: [],
          } as any)
          promptsBelongingToConversationNext?.push(prompt.id)
          promptsMetaNext.set(prompt.id, {
            // Fake Edit type, because there's no way to tell from the API
            // what type of prompt this was.
            type: PromptType.Edit,
            project: args.input.event.project,
          })
        })

        promptsBelongingToConversationNext =
          promptsBelongingToConversationNext.concat(
            context.promptsBelongingToConversation ?? []
          )

        return {
          conversationId: args.input.event.conversationId,
          promptsPool: promptsPoolNext,
          promptsBelongingToConversation: promptsBelongingToConversationNext,
          promptsMeta: promptsMetaNext,
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

                args.input.event.refParent.send({
                  type: MlEphantManagerTransitions.AppendThoughtForPrompt,
                  promptId: args.input.event.promptId,
                  thought: msg,
                })
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

        // It's possible for cached prompts to "instant return" so we need
        // to signal to the system we instantly went from in progress
        // to completed.
        const promptsInProgressToCompleted = new Set<string>(
          context.promptsInProgressToCompleted
        )

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

        promptsPool.set(result.id, { ...result, source_ranges: [] } as any)
        promptsBelongingToConversation.push(result.id)
        promptsMeta.set(result.id, {
          type: PromptType.Create,
          project: args.input.event.projectForPromptOutput,
        })

        if (result.status === 'completed') {
          promptsInProgressToCompleted.add(result.id)
        }

        return {
          promptsPool,
          conversationId: result.conversation_id,
          promptsBelongingToConversation,
          promptsMeta,
          promptsInProgressToCompleted,
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
            applicationProjectDirectory: event.applicationProjectDirectory,
            projectFiles: event.projectFiles,
            artifactGraph: event.artifactGraph,
            projectName: event.projectForPromptOutput.name,
            currentFile: event.fileSelectedDuringPrompting,
            kclVersion: getKclVersion(),
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
          targetFile: args.input.event.fileSelectedDuringPrompting.entry,
          project: args.input.event.projectForPromptOutput,
        })

        return {
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

          // The generate types for this are wrong,
          // TextToCad create and iterate both return a conversation id always
          // I believe in some circumstances (legacy prompts), conversation_id
          // will be undefined or the NIL uuid.
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
          actions: 'toastError',
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
                onError: { target: S.Await, actions: 'toastError' },
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
                onError: { target: S.Await, actions: 'toastError' },
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
                onError: { target: S.Await, actions: 'toastError' },
              },
            },
            [MlEphantManagerTransitions.GetReasoningForPrompt]: {
              invoke: {
                input: (args) => {
                  if ('output' in args.event) {
                    return {
                      event: {
                        type: MlEphantManagerTransitions.GetReasoningForPrompt,
                        refParent: args.self,
                        promptId: (
                          args.event.output as any
                        ).promptsBelongingToConversation.slice(-1)[0],
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
                onError: { target: S.Await, actions: 'toastError' },
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
                onError: { target: S.Await, actions: 'toastError' },
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
                onError: { target: S.Await, actions: 'toastError' },
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
                onError: { target: S.Await, actions: 'toastError' },
              },
            },
            [MlEphantManagerTransitions.AppendThoughtForPrompt]: {
              always: {
                target: S.Await,
                actions: [
                  assign({
                    promptsThoughts: ({ event, context }) => {
                      assertEvent(
                        event,
                        MlEphantManagerTransitions.AppendThoughtForPrompt
                      )
                      let next = new Map(context.promptsThoughts)
                      const promptThoughts = next.get(event.promptId) ?? []
                      promptThoughts.push(event.thought)
                      next.set(event.promptId, promptThoughts)
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
