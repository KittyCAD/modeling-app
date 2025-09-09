import type {
  MlCopilotClientMessage_type,
  MlCopilotServerMessage_type,
} from '@kittycad/lib/dist/types/src/models'
import { assertEvent, assign, setup, fromPromise } from 'xstate'
import type { ActorRefFrom } from 'xstate'

import { S, transitions } from '@src/machines/utils'
import { err } from '@src/lib/trap'
import { getKclVersion } from '@src/lib/kclVersion'

import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import type { FileEntry, Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'

import { constructMultiFileIterationRequestWithPromptHelpers } from '@src/lib/promptToEdit'

import toast from 'react-hot-toast'

export enum MlEphantManagerTransitions2 {
  PromptEditModel = 'prompt-edit-model',
  PromptCreateModel = 'prompt-create-model',
  ContextNew = 'context-new',
  ResponseAppend = 'response-append',
}

export type MlEphantManagerEvents2 =
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
      type: MlEphantManagerTransitions.ContextNew
    }
  | {
      type: MlEphantManagerTransitions.ResponseAppend
      response: Models['MlCopilotServerMessage_type']
    }

// Used to specify a specific event in input properties
type XSEvent<T> = Extract<MlEphantManagerEvents2, { type: T }>

interface Exchange {
  request: MlCopilotClientMessage_type

  // A response may not necessarily ever come back!
  // It's possible a request triggers multiple responses, such as reasoning,
  // deltas, tool_outputs.
  response?: (MlCopilotServerMessage_type | Error_type)[]
}

type Conversation = Exchange[]

export interface MlEphantManagerContext2 {
  ws: WebSocket
  conversation: {
    exchanges: Conversation
    pageToken?: string
  }
}

export const mlEphantDefaultContext2 = (input: { ws: WebSocket }) => ({
  ws: input.ws,
  conversation: {
    exchanges: [],
    pageToken: undefined,
  },
})

export const mlEphantManagerMachine2 = setup({
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

        promptsPool.set(result.id, { ...result, source_ranges: [] })
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
  },
}).createMachine({
  initial: S.Await,
  context: mlEphantDefaultContext2,
  states: {
    [S.Await]: {
      // Reduces boilerplate. Lets you specify many transitions with
      // states of the same name.
      on: transitions([
        MlEphantManagerTransitions.PromptCreateModel,
        MlEphantManagerTransitions.PromptEditModel,
        MlEphantManagerTransitions.ContextNew,
        MlEphantManagerTransitions.ResponseAppend,
      ]),
    },
    [MlEphantManagerTransitions.ContextNew]: {
      always: {
        target: S.Await,
        actions: [
          assign({
            conversation: {
              exchanges: [],
              pageToken: undefined,
            },
          }),
        ],
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
    [MlEphantManagerTransitions.ResponseAppend]: {
      always: {
        target: S.Await,
        actions: [
          assign({
            promptsThoughts: ({ event, context }) => {
              assertEvent(event, MlEphantManagerTransitions2.ResponseAppend)
              const next = Array.from(context.conversation.exchanges)
              next.push(event.response)
              return next
            },
          }),
        ],
      },
    },
  },
})

export type MlEphantManagerActor2 = ActorRefFrom<typeof mlEphantManagerMachine2>
export const MlEphantMachineContext = createActorContext<MlEphantManagerActor2>(
  mlEphantManagerMachine2
)
