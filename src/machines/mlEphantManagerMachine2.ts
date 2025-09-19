import type {
  MlCopilotClientMessage,
  MlCopilotServerMessage,
} from '@kittycad/lib'
import { assertEvent, assign, setup, fromPromise } from 'xstate'
import { createActorContext } from '@xstate/react'
import type { ActorRefFrom } from 'xstate'

import { S, transitions } from '@src/machines/utils'
import { getKclVersion } from '@src/lib/kclVersion'

import { Socket } from '@src/lib/utils'
import { MockSocket } from '@src/mocks/copilot'

import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/lib/selections'
import type { FileEntry, Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'

import { constructMultiFileIterationRequestWithPromptHelpers } from '@src/lib/promptToEdit'

import toast from 'react-hot-toast'

export enum MlEphantManagerStates2 {
  Setup = 'setup',
  Ready = 'ready',
  Response = 'response',
  Request = 'request',
}

export enum MlEphantManagerTransitions2 {
  MessageSend = 'message-send',
  ResponseReceive = 'response-receive',
  ConversationClose = 'conversation-close',
}

export type MlEphantManagerEvents2 =
  | {
      type: MlEphantManagerStates2.Setup
      refParentSend: (event: MlEphantManagerEvents2) => void
      // If not present, a new conversation is created.
      conversationId?: string
    }
  | {
      type: MlEphantManagerTransitions2.MessageSend
      projectForPromptOutput: Project
      prompt: string
      applicationProjectDirectory: string
      fileSelectedDuringPrompting: { entry: FileEntry; content: string }
      projectFiles: FileMeta[]
      selections: Selections
      artifactGraph: ArtifactGraph
    }
  | {
      type: MlEphantManagerTransitions2.ResponseReceive
      response: MlCopilotServerMessage
    }
  | {
      type: MlEphantManagerTransitions2.ConversationClose
    }

export interface Exchange {
  // Technically the WebSocket could send us a response at any time, without
  // ever having requested anything - such as on WebSocket 'open'.
  request?: MlCopilotClientMessage

  // A response may not necessarily ever come back! (Thus list remains empty.)
  // It's possible a request triggers multiple responses, such as reasoning,
  // deltas, tool_outputs.
  // The end of a response is signaled by 'end_of_stream'.
  responses: MlCopilotServerMessage[]
}

export type Conversation = {
  exchanges: Exchange[]
}

export interface MlEphantManagerContext2 {
  apiToken: string
  ws?: WebSocket
  conversation?: Conversation
  lastMessageId?: number
  fileFocusedOnInEditor?: FileEntry
  projectNameCurrentlyOpened?: string
}

export const mlEphantDefaultContext2 = (args: {
  input?: {
    apiToken?: string
  } | null
}): MlEphantManagerContext2 => ({
  apiToken: args.input?.apiToken ?? '',
  ws: undefined,
  conversation: undefined,
  lastMessageId: undefined,
  fileFocusedOnInEditor: undefined,
  projectNameCurrentlyOpened: undefined,
})

function isString(x: unknown): x is string {
  return typeof x === 'string'
}

function isPresent<T>(x: undefined | T): x is T {
  return x !== null && x !== undefined
}

function xor(a: boolean, b: boolean): boolean {
  return (a && !b) || (!a && b)
}

function isMlCopilotServerMessage(
  response: unknown
): response is MlCopilotServerMessage {
  if (
    typeof response === 'object' &&
    response !== null &&
    'body' in response &&
    typeof response.body === 'object' &&
    response.body !== null &&
    xor(
      'error' in response.body,
      xor(
        'info' in response.body,
        xor(
          'conversation_id' in response.body,
          xor(
            'delta' in response.body,
            xor(
              'tool_output' in response.body,
              xor(
                'reasoning' in response.body,
                'end_of_stream' in response.body
              )
            )
          )
        )
      )
    )
  ) {
    return false
  }
  return true
}

type XSInput<T> = {
  input: { event: Extract<MlEphantManagerEvents2, { type: T }> } & {
    context: MlEphantManagerContext2
  }
}

export const mlEphantManagerMachine2 = setup({
  types: {
    context: {} as MlEphantManagerContext2,
    input: {} as Pick<MlEphantManagerContext2, 'apiToken'>,
    events: {} as MlEphantManagerEvents2,
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
    [MlEphantManagerStates2.Setup]: fromPromise(async function (
      args: XSInput<MlEphantManagerStates2.Setup>
    ): Promise<Partial<MlEphantManagerContext2>> {
      assertEvent(args.input.event, [MlEphantManagerStates2.Setup])

      const ws = await Socket(
        MockSocket,
        '/ws/ml/copilot',
        args.input.context.apiToken
      )

      ws.addEventListener('message', function (event: MessageEvent<any>) {
        if (!isString(event.data))
          return console.error(new Error('Expected payload to be a string'))

        let response: unknown
        try {
          response = JSON.parse(event.data)
        } catch (e: unknown) {
          return console.error(e)
        }

        if (!isMlCopilotServerMessage(response))
          return new Error('Not a MlCopilotServerMessage')

        // Ignore the authorization bug
        if (
          'error' in response &&
          response.error.detail ===
            'Please send `{ headers: { Authorization: "Bearer <token>" } }` over this websocket.'
        )
          return

        // Ignore the dang 'ML-Ephant Copilot' banner
        if ('info' in response && response.info.text === '🤖 ML-ephant Copilot')
          return

        args.input.event.refParentSend({
          type: MlEphantManagerTransitions2.ResponseReceive,
          response,
        })
      })

      ws.addEventListener('close', function (event: Event) {
        console.log(event)
      })

      return {
        conversation: {
          exchanges: [],
        },
        ws,
      }
    }),
    [MlEphantManagerTransitions2.MessageSend]: fromPromise(async function (
      args: XSInput<MlEphantManagerTransitions2.MessageSend>
    ): Promise<Partial<MlEphantManagerContext2>> {
      const { context, event } = args.input
      if (!isPresent<WebSocket>(context.ws))
        return Promise.reject(new Error('WebSocket not present'))
      if (!isPresent<Conversation>(context.conversation))
        return Promise.reject(new Error('Conversation not present'))

      const requestData = constructMultiFileIterationRequestWithPromptHelpers({
        // TODO: NEED CONVO ID AGAIN
        conversationId: '',
        prompt: event.prompt,
        selections: event.selections,
        applicationProjectDirectory: event.applicationProjectDirectory,
        projectFiles: event.projectFiles,
        artifactGraph: event.artifactGraph,
        projectName: event.projectForPromptOutput.name,
        currentFile: event.fileSelectedDuringPrompting,
        kclVersion: getKclVersion(),
      })

      const filesAsByteArrays: Record<string, number[]> = {}

      for (let file of requestData.files) {
        filesAsByteArrays[file.name] = Array.from(
          new Uint8Array(await file.data.arrayBuffer())
        )
      }

      const request: Extract<MlCopilotClientMessage, { type: 'user' }> = {
        type: 'user',
        content: requestData.body.prompt ?? '',
        project_name: requestData.body.project_name,
        source_ranges: requestData.body.source_ranges,
        current_files: filesAsByteArrays,
      }

      context.ws.send(JSON.stringify(request))

      const conversation: Conversation = {
        exchanges: Array.from(context.conversation.exchanges),
      }

      conversation.exchanges.push({
        request,
        responses: [],
      })

      return {
        conversation,
        fileFocusedOnInEditor: event.fileSelectedDuringPrompting.entry,
        projectNameCurrentlyOpened: requestData.body.project_name,
      }
    }),
  },
}).createMachine({
  initial: S.Await,
  context: mlEphantDefaultContext2,
  states: {
    [S.Await]: {
      on: transitions([MlEphantManagerStates2.Setup]),
    },
    [MlEphantManagerStates2.Setup]: {
      invoke: {
        input: (args) => {
          return {
            event: {
              type: MlEphantManagerStates2.Setup,
              refParentSend: args.self.send,
            },
            context: args.context,
          }
        },
        src: MlEphantManagerStates2.Setup,
        onDone: {
          target: MlEphantManagerStates2.Ready,
          actions: [assign(({ event }) => event.output)],
        },
        onError: {
          actions: ['toastError'],
        },
      },
    },
    [MlEphantManagerStates2.Ready]: {
      type: 'parallel',
      states: {
        [MlEphantManagerStates2.Response]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              on: transitions([
                MlEphantManagerTransitions2.ConversationClose,
                MlEphantManagerTransitions2.ResponseReceive,
              ]),
            },
            [MlEphantManagerTransitions2.ConversationClose]: {
              type: 'final',
            },
            // Triggered by the WebSocket 'message' event.
            [MlEphantManagerTransitions2.ResponseReceive]: {
              always: {
                target: S.Await,
                actions: [
                  assign(({ event, context }) => {
                    assertEvent(event, [
                      MlEphantManagerTransitions2.ResponseReceive,
                    ])

                    const lastMessageId = (context.lastMessageId ?? -1) + 1

                    const conversation: Conversation = {
                      exchanges: Array.from(
                        context.conversation?.exchanges ?? []
                      ),
                    }

                    let lastExchange: Exchange | undefined =
                      conversation.exchanges[conversation.exchanges.length - 1]

                    if (lastExchange === undefined) {
                      lastExchange = {
                        responses: [event.response],
                      }
                      conversation.exchanges.push(lastExchange)
                    } else {
                      lastExchange.responses.push(event.response)
                    }

                    return {
                      conversation,
                      lastMessageId,
                    }
                  }),
                ],
              },
            },
          },
        },
        [MlEphantManagerStates2.Request]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              on: transitions([
                MlEphantManagerTransitions2.ConversationClose,
                MlEphantManagerTransitions2.MessageSend,
              ]),
            },
            [MlEphantManagerTransitions2.ConversationClose]: {
              type: 'final',
            },
            [MlEphantManagerTransitions2.MessageSend]: {
              invoke: {
                input: (args) => {
                  assertEvent(args.event, [
                    MlEphantManagerTransitions2.MessageSend,
                  ])
                  return {
                    event: args.event,
                    context: args.context,
                  }
                },
                src: MlEphantManagerTransitions2.MessageSend,
                onDone: {
                  target: S.Await,
                  actions: [assign(({ event }) => event.output)],
                },
                onError: { target: S.Await, actions: ['toastError'] },
              },
            },
          },
        },
      },
      onDone: {
        target: S.Await,
      },
    },
  },
})

export type MlEphantManagerActor2 = ActorRefFrom<typeof mlEphantManagerMachine2>
export const MlEphantManagerReactContext = createActorContext(
  mlEphantManagerMachine2
)
