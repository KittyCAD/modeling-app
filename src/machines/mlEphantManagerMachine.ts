import { decode as msgpackDecode } from '@msgpack/msgpack'
import { withMlephantWebSocketURL } from '@src/lib/withBaseURL'
import type {
  MlCopilotClientMessage,
  MlCopilotServerMessage,
  MlCopilotMode,
} from '@kittycad/lib'
import { assertEvent, assign, setup, fromPromise } from 'xstate'
import { createActorContext } from '@xstate/react'
import type { ActorRefFrom } from 'xstate'

import { S, transitions } from '@src/machines/utils'
import { getKclVersion } from '@src/lib/kclVersion'

import { Socket } from '@src/lib/socket'

// Uncomment and switch WebSocket below with this MockSocket for development.
// import { MockSocket } from '@src/mocks/copilot'

import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { FileEntry, Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'

import { constructMultiFileIterationRequestWithPromptHelpers } from '@src/lib/promptToEdit'

import toast from 'react-hot-toast'

export enum MlEphantSetupErrors {
  ConversationNotFound = 'conversation not found',
  InvalidConversationId = 'Invalid conversation_id',
  NoRefParentSend = 'no ref parent send',
}

type TypeVariant<T, U = T> = U extends T ? keyof U : never

type MlCopilotClientMessageUser<T = MlCopilotClientMessage> = T extends {
  type: 'user'
}
  ? T
  : never

export function isMlCopilotUserRequest(
  x: unknown
): x is MlCopilotClientMessageUser {
  return typeof x === 'object' && x !== null && 'type' in x && x.type === 'user'
}

export enum MlEphantManagerStates {
  Setup = 'setup',
  Ready = 'ready',
  Response = 'response',
  Request = 'request',
}

export enum MlEphantManagerTransitions {
  MessageSend = 'message-send',
  ResponseReceive = 'response-receive',
  ConversationClose = 'conversation-close',
  Interrupt = 'interrupt',
  AbruptClose = 'abrupt-close',
  CacheSetupAndConnect = 'cache-setup-and-connect',
}

export type MlEphantManagerEvents =
  | {
      type: 'xstate.done.state.(machine).ready'
      conversationId: undefined
    }
  | {
      type: 'xstate.error.actor.0.(machine).setup'
      conversationId: undefined
    }
  | {
      type: MlEphantManagerTransitions.CacheSetupAndConnect
      refParentSend: (event: MlEphantManagerEvents) => void
      // If not present, a new conversation is created.
      conversationId?: string
    }
  | {
      type: MlEphantManagerStates.Setup
      refParentSend: (event: MlEphantManagerEvents) => void
      // If not present, a new conversation is created.
      conversationId?: string
    }
  | {
      type: MlEphantManagerTransitions.MessageSend
      projectForPromptOutput: Project
      prompt: string
      applicationProjectDirectory: string
      fileSelectedDuringPrompting: { entry: FileEntry; content: string }
      projectFiles: FileMeta[]
      selections: Selections
      artifactGraph: ArtifactGraph
      mode: MlCopilotMode
    }
  | {
      type: MlEphantManagerTransitions.ResponseReceive
      response: MlCopilotServerMessage
    }
  | {
      type: MlEphantManagerTransitions.ConversationClose
    }
  | {
      type: MlEphantManagerTransitions.Interrupt
    }
  | {
      type: MlEphantManagerTransitions.AbruptClose
    }

export interface Exchange {
  // Technically the WebSocket could send us a response at any time, without
  // ever having requested anything - such as on WebSocket 'open'.
  request?: MlCopilotClientMessage

  // A response may not necessarily ever come back! (Thus list remains empty.)
  // It's possible a request triggers multiple responses, such as reasoning,
  // deltas, tool_outputs.
  // The end of a response is signaled by 'end_of_stream'.
  // NOTE: THIS WILL *NOT* INCLUDE `delta` RESPONSES! SEE BELOW.
  responses: MlCopilotServerMessage[]

  // BELOW:
  // An optimization. `delta` messages will be appended here.
  deltasAggregated: string
}

export type Conversation = {
  exchanges: Exchange[]
}

export interface MlEphantManagerContext {
  apiToken: string
  ws?: WebSocket
  abruptlyClosed: boolean
  conversation?: Conversation
  conversationId?: string
  lastMessageId?: number
  lastMessageType?: TypeVariant<MlCopilotServerMessage>
  fileFocusedOnInEditor?: FileEntry
  projectNameCurrentlyOpened?: string
  cachedSetup?: {
    refParentSend?: (event: MlEphantManagerEvents) => void
    conversationId?: string
  }
}

export const mlEphantDefaultContext = (args: {
  input?: {
    apiToken?: string
  } | null
}): MlEphantManagerContext => ({
  apiToken: args.input?.apiToken ?? '',
  ws: undefined,
  abruptlyClosed: false,
  conversation: undefined,
  cachedSetup: undefined,
  lastMessageId: undefined,
  lastMessageType: undefined,
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
  input: { event: Extract<MlEphantManagerEvents, { type: T }> } & {
    context: MlEphantManagerContext
  }
}

export const mlEphantManagerMachine = setup({
  types: {
    context: {} as MlEphantManagerContext,
    input: {} as Pick<MlEphantManagerContext, 'apiToken'>,
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
    cacheSetup: assign({
      conversationId: ({ event }) => {
        assertEvent(event, MlEphantManagerTransitions.CacheSetupAndConnect)

        if (event.conversationId) {
          return event.conversationId
        }

        return undefined
      },
      cachedSetup: ({ event }) => {
        assertEvent(event, MlEphantManagerTransitions.CacheSetupAndConnect)
        return {
          refParentSend: event.refParentSend,
          conversationId: event.conversationId,
        }
      },
    }),
    clearCacheSetup: assign({
      cachedSetup: undefined,
    }),
  },
  actors: {
    [MlEphantManagerStates.Setup]: fromPromise(async function (
      args: XSInput<MlEphantManagerStates.Setup>
    ): Promise<Partial<MlEphantManagerContext>> {
      assertEvent(args.input.event, MlEphantManagerStates.Setup)

      // On future reenters of this actor it will not have args.input.event
      // You must read from the context for the cached conversationId
      const maybeConversationId =
        args.input.context?.cachedSetup?.conversationId ??
        args.input.context?.conversationId
      const theRefParentSend = args.input.context?.cachedSetup?.refParentSend

      const querystring = maybeConversationId
        ? `?conversation_id=${maybeConversationId}&replay=true`
        : ''
      const url = withMlephantWebSocketURL(querystring)
      const ws = await Socket(WebSocket, url, args.input.context.apiToken)
      ws.binaryType = 'arraybuffer'

      // TODO: Get the server side to instead insert "interrupt"...
      const addErrorIfInterrupted = (exchanges: Exchange[]) => {
        const lastExchange = exchanges.slice(-1)[0]
        const lastResponse = lastExchange?.responses.slice(-1)[0]
        if (
          (lastExchange?.responses?.length > 0 &&
            lastResponse !== undefined &&
            !('end_of_stream' in lastResponse)) ||
          lastExchange?.responses?.length === 0
        ) {
          lastExchange.responses.push({
            error: {
              detail: 'Interrupted',
            },
          })
        }
      }

      let maybeReplayedExchanges: Exchange[] = []

      return await new Promise<Partial<MlEphantManagerContext>>(
        (onFulfilled, onRejected) => {
          let devCalledClose = false

          ws.addEventListener('message', function (event: MessageEvent<any>) {
            let response: unknown
            if (!isString(event.data)) {
              const binaryData = new Uint8Array(event.data)
              try {
                response = msgpackDecode(binaryData)
              } catch (msgpackError) {
                return console.error(
                  'failed to deserialize binary websocket message',
                  { msgpackError }
                )
              }
            } else {
              try {
                response = JSON.parse(event.data)
              } catch (e: unknown) {
                return console.error(e)
              }
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

            // Ignore the session data
            if ('session_data' in response) {
              return
            }

            if (
              'error' in response &&
              (response.error.detail.includes(
                MlEphantSetupErrors.ConversationNotFound
              ) ||
                response.error.detail.includes(
                  MlEphantSetupErrors.InvalidConversationId
                ))
            ) {
              devCalledClose = true
              ws.close()
              // Pass that the conversation is not found to the onError handler which will set the conversationId
              // to undefined to get us a new id.
              onRejected(MlEphantSetupErrors.ConversationNotFound)
              return
            }

            // If it's a replay, we'll unravel it and process as if they are real
            // messages being sent from the server.
            if ('replay' in response) {
              for (let byteMessage of response.replay.messages) {
                const data: Uint8Array = Uint8Array.from(
                  Object.values(byteMessage)
                )
                const responseReplay: unknown = Object.freeze(
                  JSON.parse(new TextDecoder().decode(data))
                )
                if (!isMlCopilotServerMessage(responseReplay)) continue

                // Don't show deltas because they are aggregated in the end_of_stream
                if ('delta' in responseReplay) continue

                if (
                  'type' in responseReplay &&
                  responseReplay.type === 'user'
                ) {
                  addErrorIfInterrupted(maybeReplayedExchanges)

                  if (isMlCopilotUserRequest(responseReplay)) {
                    maybeReplayedExchanges.push({
                      request: responseReplay,
                      responses: [],
                      deltasAggregated: '',
                    })
                  }
                  continue
                }

                if ('error' in responseReplay || 'info' in responseReplay) {
                  maybeReplayedExchanges.push({
                    responses: [responseReplay],
                    deltasAggregated: '',
                  })
                  continue
                }

                const lastExchange = maybeReplayedExchanges.slice(-1)[0] ?? {
                  responses: [],
                }

                // Instead we transform a end_of_stream into a delta!
                if ('end_of_stream' in responseReplay) {
                  lastExchange.deltasAggregated =
                    responseReplay.end_of_stream.whole_response ?? ''
                }
                lastExchange.responses.push(responseReplay)
              }

              addErrorIfInterrupted(maybeReplayedExchanges)
            }

            // We're only considered setup when a conversation_id is assigned
            // to us. That means data is being stored and the system is ready.
            if ('conversation_id' in response) {
              onFulfilled({
                abruptlyClosed: false,
                lastMessageId: undefined,
                lastMessageType: undefined,
                cachedSetup: undefined,
                conversation: {
                  exchanges: maybeReplayedExchanges,
                },
                conversationId: response.conversation_id.conversation_id,
                ws,
              })
              return
            }

            if (theRefParentSend) {
              theRefParentSend({
                type: MlEphantManagerTransitions.ResponseReceive,
                response,
              })
            } else {
              onRejected(MlEphantSetupErrors.NoRefParentSend)
            }
          })

          ws.addEventListener('close', function (event: Event) {
            if (theRefParentSend !== undefined && devCalledClose === false) {
              theRefParentSend({
                type: MlEphantManagerTransitions.AbruptClose,
              })
            }
          })
        }
      )
    }),
    [MlEphantManagerTransitions.MessageSend]: fromPromise(async function (
      args: XSInput<MlEphantManagerTransitions.MessageSend>
    ): Promise<Partial<MlEphantManagerContext>> {
      const { context, event } = args.input
      if (!isPresent<WebSocket>(context.ws))
        return Promise.reject(new Error('WebSocket not present'))
      if (!isPresent<Conversation>(context.conversation))
        return Promise.reject(new Error('Conversation not present'))

      const requestData = constructMultiFileIterationRequestWithPromptHelpers({
        conversationId: context.conversationId ?? '',
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
        mode: event.mode,
      }

      context.ws.send(JSON.stringify(request))

      const conversation: Conversation = {
        exchanges: Array.from(context.conversation.exchanges),
      }

      conversation.exchanges.push({
        request,
        responses: [],
        deltasAggregated: '',
      })

      return {
        conversation,
        fileFocusedOnInEditor: event.fileSelectedDuringPrompting.entry,
        projectNameCurrentlyOpened: requestData.body.project_name,
      }
    }),
    [MlEphantManagerTransitions.Interrupt]: fromPromise(async function (
      args: XSInput<MlEphantManagerTransitions.Interrupt>
    ): Promise<Partial<MlEphantManagerContext>> {
      const { context } = args.input
      if (!isPresent<WebSocket>(context.ws))
        return Promise.reject(new Error('WebSocket not present'))
      if (!isPresent<Conversation>(context.conversation))
        return Promise.reject(new Error('Conversation not present'))

      const request: Extract<MlCopilotClientMessage, { type: 'system' }> = {
        type: 'system',
        command: 'interrupt',
      }
      context.ws.send(JSON.stringify(request))

      return {}
    }),
  },
}).createMachine({
  initial: S.Await,
  context: mlEphantDefaultContext,
  states: {
    [S.Await]: {
      on: {
        [MlEphantManagerTransitions.CacheSetupAndConnect]: {
          target: MlEphantManagerStates.Setup,
          actions: [
            assign({
              abruptlyClosed: false,
              lastMessageId: undefined,
              lastMessageType: undefined,
              conversation: undefined,
              conversationId: undefined,
            }),
            'cacheSetup',
          ],
        },
        ...transitions([MlEphantManagerStates.Setup]),
      },
    },
    [MlEphantManagerStates.Setup]: {
      invoke: {
        input: (args) => {
          assertEvent(args.event, [
            MlEphantManagerStates.Setup,
            'xstate.done.state.(machine).ready',
            'xstate.error.actor.0.(machine).setup',
            MlEphantManagerTransitions.CacheSetupAndConnect,
          ])

          return {
            event: {
              type: MlEphantManagerStates.Setup,
              conversationId: args.event.conversationId,
              refParentSend: args.self.send,
            },
            context: args.context,
          }
        },
        src: MlEphantManagerStates.Setup,
        onDone: {
          target: MlEphantManagerStates.Ready,
          actions: [assign(({ event }) => event.output), 'clearCacheSetup'],
        },
        onError: {
          target: MlEphantManagerStates.Setup,
          actions: [
            assign(({ event, context }) => {
              if (event.error === MlEphantSetupErrors.ConversationNotFound) {
                // set the conversation Id to undefined to have the reenter make a new conversation id
                return {
                  abruptlyClosed: false,
                  conversation: undefined,
                  conversationId: undefined,
                  lastMessageId: undefined,
                  lastMessageType: undefined,
                  cachedSetup: {
                    refParentSend: context.cachedSetup?.refParentSend,
                    conversationId: undefined,
                  },
                }
              }

              // otherwise keep the same one
              return {
                cachedSetup: {
                  refParentSend: context.cachedSetup?.refParentSend,
                  conversationId: context.cachedSetup?.conversationId,
                },
              }
            }),
          ],
          reenter: true,
        },
      },
      on: {
        ...transitions([MlEphantManagerTransitions.ConversationClose]),
        [MlEphantManagerTransitions.AbruptClose]: {
          target: MlEphantManagerTransitions.AbruptClose,
          actions: [assign({ abruptlyClosed: true })],
        },
      },
    },
    [MlEphantManagerStates.Ready]: {
      type: 'parallel',
      states: {
        [MlEphantManagerStates.Response]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              on: {
                ...transitions([
                  MlEphantManagerTransitions.ResponseReceive,
                  MlEphantManagerTransitions.ConversationClose,
                ]),
                [MlEphantManagerTransitions.AbruptClose]: {
                  target: MlEphantManagerTransitions.AbruptClose,
                  actions: [assign({ abruptlyClosed: true })],
                },
              },
            },
            [MlEphantManagerTransitions.ConversationClose]: {
              type: 'final',
            },
            [MlEphantManagerTransitions.AbruptClose]: {
              type: 'final',
            },
            // Triggered by the WebSocket 'message' event.
            [MlEphantManagerTransitions.ResponseReceive]: {
              always: {
                target: S.Await,
                actions: [
                  assign(({ event, context }) => {
                    assertEvent(event, [
                      MlEphantManagerTransitions.ResponseReceive,
                    ])

                    const lastMessageId = (context.lastMessageId ?? -1) + 1

                    const conversation: Conversation = {
                      exchanges: Array.from(
                        context.conversation?.exchanges ?? []
                      ),
                    }

                    // Errors are considered their own
                    // exchanges because they have no end_of_stream signal.
                    // It is assumed `info` messages are followed up
                    // with an end_of_stream signal.
                    if ('error' in event.response) {
                      conversation.exchanges.push({
                        responses: [event.response],
                        deltasAggregated: '',
                      })
                      return {
                        conversation,
                        lastMessageId,
                      }
                    }

                    let lastExchange: Exchange | undefined =
                      conversation.exchanges[conversation.exchanges.length - 1]

                    if (lastExchange === undefined) {
                      lastExchange = {
                        responses: [event.response],
                        deltasAggregated: '',
                      }
                      conversation.exchanges.push(lastExchange)

                      // OPTIMIZATION: `delta` responses are aggregated instead
                      // of being included in the responses list.
                    } else if ('delta' in event.response) {
                      lastExchange.deltasAggregated +=
                        event.response.delta.delta
                    } else {
                      lastExchange.responses.push(event.response)
                    }

                    // This sucks but must be done because we can't
                    // enumerate the message types.
                    const r = event.response
                    const ts: TypeVariant<MlCopilotServerMessage>[] = [
                      'info',
                      'error',
                      'end_of_stream',
                      'session_data',
                      'conversation_id',
                      'delta',
                      'tool_output',
                      'reasoning',
                      'replay',
                    ]
                    const lastMessageType:
                      | TypeVariant<MlCopilotServerMessage>
                      | undefined = ts.find((t) => t in r)

                    return {
                      conversation,
                      lastMessageId,
                      lastMessageType,
                    }
                  }),
                ],
              },
            },
          },
        },
        [MlEphantManagerStates.Request]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              on: transitions([
                MlEphantManagerTransitions.MessageSend,
                MlEphantManagerTransitions.Interrupt,
                MlEphantManagerTransitions.ConversationClose,
                MlEphantManagerTransitions.AbruptClose,
              ]),
            },
            [MlEphantManagerTransitions.ConversationClose]: {
              type: 'final',
            },
            [MlEphantManagerTransitions.AbruptClose]: {
              type: 'final',
            },
            [MlEphantManagerTransitions.MessageSend]: {
              invoke: {
                input: (args) => {
                  assertEvent(args.event, [
                    MlEphantManagerTransitions.MessageSend,
                  ])
                  return {
                    event: args.event,
                    context: args.context,
                  }
                },
                src: MlEphantManagerTransitions.MessageSend,
                onDone: {
                  target: S.Await,
                  actions: [assign(({ event }) => event.output)],
                },
                onError: { target: S.Await, actions: ['toastError'] },
              },
            },
            [MlEphantManagerTransitions.Interrupt]: {
              invoke: {
                input: (args) => {
                  assertEvent(args.event, [
                    MlEphantManagerTransitions.Interrupt,
                  ])
                  return {
                    event: args.event,
                    context: args.context,
                  }
                },
                src: MlEphantManagerTransitions.Interrupt,
                onDone: {
                  target: S.Await,
                  actions: [],
                },
                onError: { target: S.Await, actions: ['toastError'] },
              },
            },
          },
        },
      },
      onDone: {
        target: MlEphantManagerTransitions.ConversationClose,
      },
    },
    [MlEphantManagerTransitions.AbruptClose]: {
      always: {
        target: MlEphantManagerTransitions.ConversationClose,
      },
    },
    [MlEphantManagerTransitions.ConversationClose]: {
      always: {
        target: S.Await,
        actions: [
          (args) => {
            // We want to keep the context around to recover.
            if (args.context.abruptlyClosed) {
              return assign({})
            }
            return assign({
              abruptlyClosed: false,
              conversation: undefined,
              conversationId: undefined,
              cachedSetup: undefined,
              lastMessageId: undefined,
              lastMessageType: undefined,
            })
          },
          (args) => {
            if (args.context.ws?.readyState === WebSocket.OPEN) {
              args.context.ws?.close()
            }
          },
        ],
      },
    },
  },
})

export type MlEphantManagerActor = ActorRefFrom<typeof mlEphantManagerMachine>
export const MlEphantManagerReactContext = createActorContext(
  mlEphantManagerMachine
)
