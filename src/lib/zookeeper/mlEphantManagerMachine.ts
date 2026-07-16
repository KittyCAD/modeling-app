import type {
  MlCopilotClientMessage,
  MlCopilotFile,
  MlCopilotServerMessage,
} from '@kittycad/lib'
import { decode as msgpackDecode } from '@msgpack/msgpack'
import type { KittyCadLibFile } from '@src/lib/promptToEditTypes'
import { withMlephantWebSocketURL } from '@src/lib/withBaseURL'
import { createActorContext } from '@xstate/react'
import ms from 'ms'
import { assertEvent, assign, fromPromise, setup } from 'xstate'
import type { ActorRefFrom } from 'xstate'

import {
  type CustomIconName,
  isCustomIconName,
} from '@src/components/CustomIcon'

import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { isErr } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'

import { getKclVersion } from '@src/lib/kclVersion'
import { S, transitions, xstateEventError } from '@src/machines/utils'

import { Socket } from '@src/lib/socket'

// Uncomment and switch WebSocket below with this MockSocket for development.
// import { MockSocket } from '@src/mocks/copilot'

import type { ArtifactGraph } from '@src/lang/wasm'
import type { FileEntry, Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'
import type { Selections } from '@src/machines/modelingSharedTypes'

import { constructMultiFileIterationRequestWithPromptHelpers } from '@src/lib/promptToEdit'

import toast from 'react-hot-toast'

export enum MlEphantSetupErrors {
  ConversationNotFound = 'conversation not found',
  InvalidConversationId = 'Invalid conversation_id',
  NoRefParentSend = 'no ref parent send',
}

type TypeVariant<T, U = T> = U extends T ? keyof U : never

type MlCopilotListModesRequest = { type: 'list_modes' }
export type MlCopilotModeId = string

type MlCopilotUserRequest = Omit<
  Extract<MlCopilotClientMessage, { type: 'user' }>,
  'mode'
> & {
  // The generated client still narrows this to the initially-known mode ids,
  // but mode discovery intentionally treats the backend-provided id as opaque.
  mode?: MlCopilotModeId
  active_file?: string
}

type MlCopilotProjectContextRequest = Extract<
  MlCopilotClientMessage,
  { type: 'project_context' }
> & {
  active_file?: string
}

type MlCopilotClientMessageWithDiscoveredMode =
  | Exclude<MlCopilotClientMessage, { type: 'user' }>
  | MlCopilotUserRequest

type MlCopilotClientMessageUser<T = MlCopilotClientMessageWithDiscoveredMode> =
  T extends {
    type: 'user'
  }
    ? T
    : never

export interface MlCopilotModeOption {
  id: MlCopilotModeId
  label: string
  description: string
  icon: CustomIconName
  disabled: boolean
}

type MlCopilotModesResult = {
  defaultMode?: MlCopilotModeId
  modeOptions: MlCopilotModeOption[]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function toMlCopilotModeOption(value: unknown): MlCopilotModeOption | null {
  if (typeof value !== 'object' || value === null) return null

  const candidate = value as {
    id?: unknown
    label?: unknown
    description?: unknown
    icon?: unknown
    disabled?: unknown
  }

  if (
    !isNonEmptyString(candidate.id) ||
    typeof candidate.label !== 'string' ||
    typeof candidate.description !== 'string'
  )
    return null

  if (!isCustomIconName(candidate.icon)) {
    console.warn(
      `Discarding ml copilot mode option with unrecognized icon: ${String(candidate.icon)}`
    )
    return null
  }

  return {
    id: candidate.id,
    label: candidate.label,
    description: candidate.description,
    icon: candidate.icon,
    disabled: candidate.disabled === true,
  }
}

export function parseMlCopilotModesResult(
  response: unknown
): MlCopilotModesResult | null {
  if (typeof response !== 'object' || response === null) return null

  const envelope = response as { modes_response?: unknown }
  const modesResponse = envelope.modes_response
  if (typeof modesResponse !== 'object' || modesResponse === null) return null

  const candidate = modesResponse as {
    default_mode?: unknown
    modes?: unknown
  }
  if (!isArray(candidate.modes)) return null

  const modeOptions = candidate.modes
    .map(toMlCopilotModeOption)
    .filter((option): option is MlCopilotModeOption => option !== null)

  if (modeOptions.length === 0) {
    console.warn(
      'modes_response contained no usable mode options; no mode selector will be shown'
    )
  }

  return {
    defaultMode: isNonEmptyString(candidate.default_mode)
      ? candidate.default_mode
      : undefined,
    modeOptions,
  }
}

export function isMlCopilotUserRequest(
  x: unknown
): x is MlCopilotClientMessageUser {
  return typeof x === 'object' && x !== null && 'type' in x && x.type === 'user'
}

export enum MlEphantManagerStates {
  Setup = 'setup',
  WaitForContinueCheck = 'wait-for-continue-check',
  ContinueCheck = 'continue-check',
  Ready = 'ready',
  Response = 'response',
  Request = 'request',
}

export enum MlEphantManagerTransitions {
  MessageSend = 'message-send',
  ResponseReceive = 'response-receive',
  ModesReceive = 'modes-receive',
  ConversationClose = 'conversation-close',
  Cancel = 'cancel',
  Interrupt = 'interrupt',
  AbruptClose = 'abrupt-close',
  CacheSetupAndConnect = 'cache-setup-and-connect',
  BackendShutdown = 'backend-shutdown',
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
      mode?: MlCopilotModeId
      additionalFiles?: File[]
    }
  | {
      type: MlEphantManagerStates.ContinueCheck
      projectName: string
      projectFiles: FileMeta[]
      activeFile?: string
    }
  | {
      type: MlEphantManagerTransitions.ResponseReceive
      response: MlCopilotServerMessage
    }
  | {
      type: MlEphantManagerTransitions.ModesReceive
      defaultMode?: MlCopilotModeId
      modeOptions: MlCopilotModeOption[]
    }
  | {
      type: MlEphantManagerTransitions.ConversationClose
    }
  | {
      type: MlEphantManagerTransitions.Cancel
    }
  | {
      type: MlEphantManagerTransitions.Interrupt
    }
  | {
      type: MlEphantManagerTransitions.AbruptClose
      closeReason?: string
    }
  | {
      type: MlEphantManagerTransitions.BackendShutdown
    }

export interface Exchange {
  // Technically the WebSocket could send us a response at any time, without
  // ever having requested anything - such as on WebSocket 'open'.
  request?: MlCopilotClientMessageWithDiscoveredMode

  // A response may not necessarily ever come back! (Thus list remains empty.)
  // It's possible a request triggers multiple responses, such as reasoning,
  // deltas, tool_outputs.
  // The end of a response is signaled by 'end_of_stream'.
  // NOTE: THIS WILL *NOT* INCLUDE `delta` RESPONSES! SEE BELOW.
  responses: MlCopilotServerMessage[]

  // BELOW:
  // An optimization. `delta` messages will be appended here.
  deltasAggregated: string

  // Client-side wall-clock time for an in-progress response. The server only
  // provides its authoritative start time with `end_of_stream`, so this must
  // survive reconnect replay while a response is still running.
  startedAt?: Date
}

export type Conversation = {
  exchanges: Exchange[]
}

export interface MlEphantManagerContext {
  apiToken: string
  ws?: WebSocket
  abruptlyClosed: boolean
  closeReason?: string
  conversation?: Conversation
  conversationId?: string
  lastMessageId?: number
  lastMessageType?: TypeVariant<MlCopilotServerMessage>
  fileFocusedOnInEditor?: FileEntry
  projectNameCurrentlyOpened?: string
  awaitingResponse: boolean
  attachmentsLoadedForCurrentPrompt: boolean
  pendingBackendShutdown: boolean
  defaultMode?: MlCopilotModeId
  modeOptions?: MlCopilotModeOption[]
  cachedSetup?: {
    refParentSend?: (event: MlEphantManagerEvents) => void
    conversationId?: string
    exchangeStartedAts?: Array<Date | undefined>
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
  closeReason: undefined,
  conversation: undefined,
  cachedSetup: undefined,
  lastMessageId: undefined,
  lastMessageType: undefined,
  fileFocusedOnInEditor: undefined,
  projectNameCurrentlyOpened: undefined,
  awaitingResponse: false,
  attachmentsLoadedForCurrentPrompt: true,
  pendingBackendShutdown: false,
  defaultMode: undefined,
  modeOptions: undefined,
})

const ZOOKEEPER_DISCONNECT_LOG_PREFIX = '[zookeeper-disconnect]'

function logZookeeperDisconnect(message: string, metadata?: unknown) {
  console.warn(ZOOKEEPER_DISCONNECT_LOG_PREFIX, message, metadata)
}

type ZookeeperErrorContext = Pick<
  MlEphantManagerContext,
  | 'conversationId'
  | 'awaitingResponse'
  | 'pendingBackendShutdown'
  | 'lastMessageId'
  | 'lastMessageType'
> & {
  exchangeCount: Conversation['exchanges']['length'] | undefined
  readyState: ReturnType<typeof getWebSocketReadyStateLabel>
}

function zookeeperErrorContext(
  context: MlEphantManagerContext
): ZookeeperErrorContext {
  return {
    conversationId: context.conversationId,
    awaitingResponse: context.awaitingResponse,
    pendingBackendShutdown: context.pendingBackendShutdown,
    lastMessageId: context.lastMessageId,
    lastMessageType: context.lastMessageType,
    exchangeCount: context.conversation?.exchanges.length,
    readyState: getWebSocketReadyStateLabel(context.ws?.readyState),
  }
}

function reportZookeeperClientError(args: {
  code: ClientErrorCode
  error: Error
  dedupeKey?: string
  extra?: Record<string, unknown>
}) {
  // Keep this scoped to exceptions raised while the client handles the pane.
  // Backend error responses and normal websocket lifecycle events are not
  // client bugs, even when they produce user-visible Zookeeper errors.
  void reportClientError({
    code: args.code,
    message: args.error.message,
    error: args.error,
    dedupeKey: args.dedupeKey,
    extra: {
      source: 'MlEphantManagerMachine',
      ...args.extra,
    },
  })
}

function getWebSocketReadyStateLabel(
  readyState: number | undefined
): string | undefined {
  switch (readyState) {
    case WebSocket.CONNECTING:
      return 'CONNECTING'
    case WebSocket.OPEN:
      return 'OPEN'
    case WebSocket.CLOSING:
      return 'CLOSING'
    case WebSocket.CLOSED:
      return 'CLOSED'
    default:
      return undefined
  }
}

function isString(x: unknown): x is string {
  return typeof x === 'string'
}

function isPresent<T>(x: undefined | T): x is T {
  return x !== null && x !== undefined
}

const intentionalMlEphantCloses = new WeakSet<WebSocket>()

function closeMlEphantWebSocket(ws: WebSocket | undefined) {
  if (ws?.readyState !== WebSocket.OPEN) return
  intentionalMlEphantCloses.add(ws)
  ws.close()
}

type BackendShutdownMessage = Extract<
  MlCopilotServerMessage,
  { backend_shutdown: { reason?: string } }
>

function isBackendShutdownMessage(
  response: unknown
): response is BackendShutdownMessage {
  if (typeof response !== 'object' || response === null) return false
  const candidate = response as { backend_shutdown?: { reason?: string } }
  return typeof candidate.backend_shutdown === 'object'
}

function isResponseComplete(response: MlCopilotServerMessage): boolean {
  return 'end_of_stream' in response || 'error' in response
}

function isAttachmentsLoadedMessage(
  response: unknown
): response is { attachments_loaded: object } {
  return (
    typeof response === 'object' &&
    response !== null &&
    'attachments_loaded' in response
  )
}

async function toMlCopilotFile(file: File): Promise<MlCopilotFile> {
  return {
    name: file.name,
    mimetype: file.type || 'application/octet-stream',
    data: Array.from(new Uint8Array(await file.arrayBuffer())),
  }
}

export const MlEphantConversationToMarkdown = (
  conversation?: Conversation
): string => {
  if (conversation === undefined) return ''

  let agg = ''
  let meta = ''

  for (const exchange of conversation.exchanges) {
    let entry = ''
    let reason = ''
    if (exchange.request) {
      if ('content' in exchange.request) {
        entry += '## You:\n\n'
        entry += exchange.request.content + '\n\n'
      }
    }
    for (const response of exchange.responses) {
      if ('reasoning' in response) {
        if ('content' in response.reasoning) {
          if (
            [
              'created_kcl_file',
              'updated_kcl_file',
              'deleted_kcl_file',
              'created_project_file',
              'updated_project_file',
              'deleted_project_file',
            ].includes(response.reasoning.type) === false
          ) {
            const contentWithoutCode = response.reasoning.content.replace(
              /```[\s\S]*?```/gm,
              '~~Code redacted~~'
            )
            reason += `${contentWithoutCode}\n\n`
          }
        } else if ('error' in response.reasoning) {
          reason += `**${response.reasoning.error}**\n\n`

          // We will ignore code. It adds a lot of noise. We can look at honeycomb
          // with the api call id if we really want it.
        } else if ('code' in response.reasoning) {
          reason += '~~Code redacted~~\n\n'
        } else if ('steps' in response.reasoning) {
          for (const step of response.reasoning.steps) {
            reason += `* ${step.filepath_to_edit}: ${step.edit_instructions}\n\n`
          }
        }
      }
      if ('error' in response) {
        reason += `**${response.error.detail}**\n\n`
      }

      // An error signals end of stream as well.
      if ('error' in response || 'end_of_stream' in response) {
        let time = 0
        if ('end_of_stream' in response) {
          time =
            new Date(response.end_of_stream.completed_at ?? 0).getTime() -
            new Date(response.end_of_stream.started_at ?? 0).getTime()
        }

        entry += `## Zookeeper (${time === 0 ? 'unknown' : ms(time, { long: true })}):\n\n`
        entry += reason + '\n'
        entry += new Array(80).fill('-').join('') + '\n\n'

        if ('end_of_stream' in response) {
          entry += response.end_of_stream.whole_response ?? '' + '\n'
          meta = `#### Conversation Id: ${response.end_of_stream.conversation_id}\n`
        }
      }
    }
    agg += entry + '\n\n'
  }

  return meta + '\n' + agg + '\n\n'
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

const hasBeenInterruptedOnLast = (exchanges: Exchange[]) => {
  const lastExchange = exchanges.slice(-1)[0]
  const lastResponse = lastExchange?.responses.slice(-1)[0]
  return (
    (lastExchange?.responses?.length > 0 &&
      lastResponse !== undefined &&
      !('end_of_stream' in lastResponse)) ||
    lastExchange?.responses?.length === 0
  )
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
    toastError: ({ event, context }) => {
      console.error(event)
      const error = xstateEventError(event)
      if (!isErr(error)) return

      reportZookeeperClientError({
        code: ClientErrorCode.ZookeeperActorError,
        error,
        dedupeKey: `MlEphantManagerMachine:actor-error:${event.type}:${error.message}`,
        extra: {
          eventType: event.type,
          ...zookeeperErrorContext(context),
        },
      })
      toast.error(error.message)
    },
    reportSetupError: ({ event, context }) => {
      if (!('error' in event)) return
      if (event.error === MlEphantSetupErrors.ConversationNotFound) return
      if (!isErr(event.error)) return

      reportZookeeperClientError({
        code: ClientErrorCode.ZookeeperSetupError,
        error: event.error,
        dedupeKey: `MlEphantManagerMachine:setup-error:${event.error.message}`,
        extra: {
          eventType: event.type,
          ...zookeeperErrorContext(context),
        },
      })
    },
    handleAbruptClose: assign(({ event, context }) => {
      assertEvent(event, MlEphantManagerTransitions.AbruptClose)
      logZookeeperDisconnect('machine handling abrupt websocket close', {
        closeReason: event.closeReason,
        ...zookeeperErrorContext(context),
      })
      if (event.closeReason) {
        toast.error(event.closeReason)
      }
      return {
        abruptlyClosed: true,
        closeReason: event.closeReason,
      }
    }),
    handleBackendShutdown: assign(({ context }) => {
      logZookeeperDisconnect('received backend shutdown message', {
        awaitingResponse: context.awaitingResponse,
        pendingBackendShutdown: context.pendingBackendShutdown,
        conversationId: context.conversationId,
        lastMessageType: context.lastMessageType,
      })
      if (context.awaitingResponse) {
        return { pendingBackendShutdown: true }
      }
      return {}
    }),
    assignModeOptions: assign(({ context, event }) => {
      assertEvent(event, MlEphantManagerTransitions.ModesReceive)
      return {
        defaultMode: event.defaultMode ?? context.defaultMode,
        modeOptions: event.modeOptions,
      }
    }),
    disconnectIfIdle: ({ context }) => {
      if (!context.awaitingResponse) {
        logZookeeperDisconnect(
          'closing websocket because backend shutdown arrived while idle',
          {
            conversationId: context.conversationId,
            lastMessageType: context.lastMessageType,
            readyState: getWebSocketReadyStateLabel(context.ws?.readyState),
          }
        )
        context.ws?.close()
      }
    },
    disconnectIfPendingBackendShutdown: ({ context, event }) => {
      assertEvent(event, MlEphantManagerTransitions.ResponseReceive)
      if (
        context.pendingBackendShutdown &&
        isResponseComplete(event.response)
      ) {
        logZookeeperDisconnect(
          'closing websocket because backend shutdown was pending and response stream completed',
          {
            conversationId: context.conversationId,
            lastMessageType: context.lastMessageType,
            responseType: Object.keys(event.response),
            readyState: getWebSocketReadyStateLabel(context.ws?.readyState),
          }
        )
        context.ws?.close()
      }
    },
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
      // Always read refParentSend from the input event — the parent's invoke
      // input function sets it to `args.self.send` on every (re)entry, so it
      // is reliable. cachedSetup.refParentSend is cleared after the first
      // successful setup (clearCacheSetup), which would otherwise leave the
      // message handler unable to dispatch on reconnects.
      const theRefParentSend = args.input.event.refParentSend

      const queryParams = new URLSearchParams()
      if (maybeConversationId) {
        queryParams.set('conversation_id', maybeConversationId)
        queryParams.set('replay', 'true')
      }
      const querystring = queryParams.toString()
        ? `?${queryParams.toString()}`
        : ''
      const url = withMlephantWebSocketURL(querystring)
      const conversationId =
        args.input.context.conversationId ?? args.input.event.conversationId

      // Defensive: if there's already an open connection, close it.
      closeMlEphantWebSocket(args.input.context.ws)

      const ws = await Socket(WebSocket, url, args.input.context.apiToken)
      ws.binaryType = 'arraybuffer'

      logZookeeperDisconnect('websocket opened and authenticated', {
        conversationId,
        url,
        readyState: getWebSocketReadyStateLabel(ws.readyState),
      })

      let maybeReplayedExchanges: Exchange[] = []
      let replayedRequestIndex = 0
      let maybeModeOptions: MlCopilotModeOption[] | undefined
      let maybeDefaultMode: MlCopilotModeId | undefined
      let setupResolved = false

      return await new Promise<Partial<MlEphantManagerContext>>(
        (onFulfilled, onRejected) => {
          let devCalledClose = false

          // Any WS protocol messages will trigger the `api` heartbeat update.
          const pingIntervalId = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) return
            ws.send(JSON.stringify({ type: 'ping' }))
          }, 4_000)

          ws.addEventListener('error', function (event: Event) {
            logZookeeperDisconnect('websocket error event received', {
              conversationId,
              readyState: getWebSocketReadyStateLabel(ws.readyState),
              eventType: event.type,
            })
          })

          ws.addEventListener('message', function (event: MessageEvent<any>) {
            let response: unknown
            if (!isString(event.data)) {
              const binaryData = new Uint8Array(event.data)
              try {
                response = msgpackDecode(binaryData)
              } catch (msgpackError) {
                console.error(
                  'failed to deserialize binary websocket message',
                  {
                    msgpackError,
                  }
                )
                if (!isErr(msgpackError)) return

                reportZookeeperClientError({
                  code: ClientErrorCode.ZookeeperWebsocketBinaryDecodeError,
                  error: msgpackError,
                  dedupeKey: `MlEphantManagerMachine:binary-decode:${String(conversationId)}:${msgpackError.message}`,
                  extra: {
                    ...zookeeperErrorContext(args.input.context),
                    conversationId,
                    byteLength: binaryData.byteLength,
                    readyState: getWebSocketReadyStateLabel(ws.readyState),
                  },
                })
                return
              }
            } else {
              try {
                response = JSON.parse(event.data)
              } catch (e: unknown) {
                console.error(e)
                if (!isErr(e)) return

                reportZookeeperClientError({
                  code: ClientErrorCode.ZookeeperWebsocketJsonParseError,
                  error: e,
                  dedupeKey: `MlEphantManagerMachine:json-parse:${String(conversationId)}:${e.message}`,
                  extra: {
                    ...zookeeperErrorContext(args.input.context),
                    conversationId,
                    dataLength: event.data.length,
                    readyState: getWebSocketReadyStateLabel(ws.readyState),
                  },
                })
                return
              }
            }

            const modesResult = parseMlCopilotModesResult(response)
            if (modesResult !== null) {
              maybeModeOptions = modesResult.modeOptions
              maybeDefaultMode = modesResult.defaultMode
              if (setupResolved && theRefParentSend) {
                theRefParentSend({
                  type: MlEphantManagerTransitions.ModesReceive,
                  defaultMode: maybeDefaultMode,
                  modeOptions: maybeModeOptions,
                })
              }
              return
            }

            if (isBackendShutdownMessage(response)) {
              logZookeeperDisconnect('server sent backend_shutdown', {
                backendShutdownReason: response.backend_shutdown.reason,
                conversationId,
                lastMessageType: args.input.context.lastMessageType,
                readyState: getWebSocketReadyStateLabel(ws.readyState),
              })
              if (theRefParentSend) {
                theRefParentSend({
                  type: MlEphantManagerTransitions.BackendShutdown,
                })
              }
              return
            }

            if (!isMlCopilotServerMessage(response)) return

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

            // Ignore pong
            if ('pong' in response) {
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
              logZookeeperDisconnect(
                'closing websocket because conversation replay/setup is invalid',
                {
                  errorDetail: response.error.detail,
                  conversationId,
                  readyState: getWebSocketReadyStateLabel(ws.readyState),
                }
              )
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
                  if (isMlCopilotUserRequest(responseReplay)) {
                    const startedAt =
                      args.input.context.cachedSetup?.exchangeStartedAts?.[
                        replayedRequestIndex
                      ]
                    maybeReplayedExchanges.push({
                      request: responseReplay,
                      responses: [],
                      deltasAggregated: '',
                      startedAt,
                    })
                    replayedRequestIndex += 1
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
            }

            // We're only considered setup when a conversation_id is assigned
            // to us. That means data is being stored and the system is ready.
            if ('conversation_id' in response) {
              setupResolved = true
              onFulfilled({
                abruptlyClosed: false,
                lastMessageId: undefined,
                lastMessageType: undefined,
                cachedSetup: undefined,
                conversation: {
                  exchanges: maybeReplayedExchanges,
                },
                conversationId: response.conversation_id.conversation_id,
                defaultMode: maybeDefaultMode,
                modeOptions: maybeModeOptions,
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

          const listModesRequest: MlCopilotListModesRequest = {
            type: 'list_modes',
          }
          ws.send(JSON.stringify(listModesRequest))

          ws.addEventListener('close', function (event: CloseEvent) {
            clearInterval(pingIntervalId)
            const intentionallyClosed = intentionalMlEphantCloses.has(ws)
            if (intentionallyClosed) {
              intentionalMlEphantCloses.delete(ws)
            }

            logZookeeperDisconnect('websocket close event received', {
              code: event.code,
              reason: event.reason,
              wasClean: event.wasClean,
              devCalledClose,
              intentionallyClosed,
              conversationId,
              lastMessageType: args.input.context.lastMessageType,
              readyState: getWebSocketReadyStateLabel(ws.readyState),
            })

            if (intentionallyClosed) {
              return
            }

            if (theRefParentSend !== undefined && devCalledClose === false) {
              let closeReason: string | undefined
              if (event.code === 1009) {
                closeReason =
                  'Your project files are too large to send to Zookeeper. Try removing large STL/STEP files or splitting your project.'
              }
              theRefParentSend({
                type: MlEphantManagerTransitions.AbruptClose,
                closeReason,
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

      const additionalFiles =
        event.additionalFiles && event.additionalFiles.length > 0
          ? await Promise.all(event.additionalFiles.map(toMlCopilotFile))
          : undefined

      const request: MlCopilotUserRequest = {
        type: 'user',
        content: requestData.body.prompt ?? '',
        project_name: requestData.body.project_name,
        source_ranges: requestData.body.source_ranges,
        current_files: filesAsByteArrays,
        ...(requestData.activeFile
          ? { active_file: requestData.activeFile }
          : {}),
        ...(event.mode ? { mode: event.mode } : {}),
        ...(additionalFiles ? { additional_files: additionalFiles } : {}),
      }

      context.ws.send(JSON.stringify(request))

      const conversation: Conversation = {
        exchanges: Array.from(context.conversation.exchanges),
      }

      conversation.exchanges.push({
        request,
        responses: [],
        deltasAggregated: '',
        startedAt: new Date(),
      })

      return {
        conversation,
        fileFocusedOnInEditor: event.fileSelectedDuringPrompting.entry,
        projectNameCurrentlyOpened: requestData.body.project_name,
        attachmentsLoadedForCurrentPrompt:
          !event.additionalFiles || event.additionalFiles.length === 0,
      }
    }),
    [MlEphantManagerStates.ContinueCheck]: fromPromise(async function (
      args: XSInput<MlEphantManagerStates.ContinueCheck>
    ): Promise<Partial<MlEphantManagerContext>> {
      const { context, event } = args.input
      if (!isPresent<WebSocket>(context.ws))
        return Promise.reject(new Error('WebSocket not present'))
      if (!isPresent<Conversation>(context.conversation))
        return Promise.reject(new Error('Conversation not present'))

      // If nothing was interrupted move onto the next phase
      if (!hasBeenInterruptedOnLast(context.conversation?.exchanges)) {
        return {
          awaitingResponse: false,
        }
      }

      const filesAsByteArrays: Record<string, number[]> = {}
      const files: KittyCadLibFile[] = []

      event.projectFiles.forEach((file) => {
        let data: Blob
        if (file.type === 'other') {
          data = file.data
        } else {
          // file.type === 'kcl'
          data = new Blob([file.fileContents], { type: 'text/kcl' })
        }
        files.push({
          name: file.relPath,
          data,
        })
      })

      for (let file of files) {
        filesAsByteArrays[file.name] = Array.from(
          new Uint8Array(await file.data.arrayBuffer())
        )
      }

      const requestProjectContext: MlCopilotProjectContextRequest = {
        type: 'project_context',
        project_name: event.projectName,
        current_files: filesAsByteArrays,
        ...(event.activeFile ? { active_file: event.activeFile } : {}),
      }

      const requestContinue: Extract<
        MlCopilotClientMessage,
        { type: 'system' }
      > = {
        type: 'system',
        command: 'continue',
      }

      context.ws.send(JSON.stringify(requestContinue))
      context.ws.send(JSON.stringify(requestProjectContext))

      return {
        awaitingResponse: true,
      }
    }),
    [MlEphantManagerTransitions.Cancel]: fromPromise(async function (
      args: XSInput<MlEphantManagerTransitions.Cancel>
    ): Promise<Partial<MlEphantManagerContext>> {
      const { context } = args.input
      if (!isPresent<WebSocket>(context.ws))
        return Promise.reject(new Error('WebSocket not present'))
      if (!isPresent<Conversation>(context.conversation))
        return Promise.reject(new Error('Conversation not present'))

      const request: Extract<MlCopilotClientMessage, { type: 'system' }> = {
        type: 'system',
        command: 'cancel',
      }
      context.ws.send(JSON.stringify(request))

      return {}
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
  exit: (args) => {
    // Make sure the connection is closed.
    closeMlEphantWebSocket(args.context?.ws)
  },
  on: {
    [MlEphantManagerTransitions.ModesReceive]: {
      actions: ['assignModeOptions'],
    },
  },
  states: {
    [S.Await]: {
      on: {
        [MlEphantManagerTransitions.CacheSetupAndConnect]: {
          target: MlEphantManagerStates.Setup,
          actions: [
            assign(({ context, event }) => {
              assertEvent(
                event,
                MlEphantManagerTransitions.CacheSetupAndConnect
              )

              const exchangeStartedAts = context.abruptlyClosed
                ? context.conversation?.exchanges.flatMap((exchange) =>
                    exchange.request ? [exchange.startedAt] : []
                  )
                : undefined

              return {
                abruptlyClosed: false,
                lastMessageId: undefined,
                lastMessageType: undefined,
                conversation: undefined,
                conversationId: event.conversationId,
                defaultMode: undefined,
                modeOptions: undefined,
                awaitingResponse: false,
                attachmentsLoadedForCurrentPrompt: true,
                pendingBackendShutdown: false,
                cachedSetup: {
                  refParentSend: event.refParentSend,
                  conversationId: event.conversationId,
                  exchangeStartedAts,
                },
              }
            }),
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
          target: MlEphantManagerStates.WaitForContinueCheck,
          actions: [
            assign(({ event, context }) => ({
              ...event.output,
              defaultMode: event.output.defaultMode ?? context.defaultMode,
              modeOptions: event.output.modeOptions ?? context.modeOptions,
              awaitingResponse: false,
              attachmentsLoadedForCurrentPrompt: true,
              pendingBackendShutdown: false,
            })),
            'clearCacheSetup',
          ],
        },
        onError: {
          target: MlEphantManagerStates.Setup,
          actions: [
            'reportSetupError',
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
                    exchangeStartedAts: context.cachedSetup?.exchangeStartedAts,
                  },
                }
              }

              // otherwise keep the same one
              return {
                cachedSetup: {
                  refParentSend: context.cachedSetup?.refParentSend,
                  conversationId: context.cachedSetup?.conversationId,
                  exchangeStartedAts: context.cachedSetup?.exchangeStartedAts,
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
          actions: ['handleAbruptClose'],
        },
        [MlEphantManagerTransitions.BackendShutdown]: {
          actions: ['handleBackendShutdown', 'disconnectIfIdle'],
        },
      },
    },
    // Must wait because other systems have the data we need for the check.
    [MlEphantManagerStates.WaitForContinueCheck]: {
      on: {
        ...transitions([MlEphantManagerStates.ContinueCheck]),
      },
    },
    [MlEphantManagerStates.ContinueCheck]: {
      invoke: {
        input: (args) => {
          assertEvent(args.event, [MlEphantManagerStates.ContinueCheck])

          return {
            event: args.event,
            context: args.context,
          }
        },
        src: MlEphantManagerStates.ContinueCheck,
        onDone: {
          target: MlEphantManagerStates.Ready,
          actions: [
            assign({
              awaitingResponse({ event }) {
                return event.output.awaitingResponse ?? false
              },
            }),
          ],
        },
        onError: { target: S.Await, actions: ['toastError'] },
      },
    },
    [MlEphantManagerStates.Ready]: {
      type: 'parallel',
      on: {
        [MlEphantManagerTransitions.BackendShutdown]: {
          actions: ['handleBackendShutdown', 'disconnectIfIdle'],
        },
      },
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
                  actions: ['handleAbruptClose'],
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
                  'disconnectIfPendingBackendShutdown',
                  assign(({ event, context }) => {
                    assertEvent(event, [
                      MlEphantManagerTransitions.ResponseReceive,
                    ])

                    const lastMessageId = (context.lastMessageId ?? -1) + 1
                    const responseComplete = isResponseComplete(event.response)

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
                        awaitingResponse: false,
                        attachmentsLoadedForCurrentPrompt: true,
                        pendingBackendShutdown: responseComplete
                          ? false
                          : context.pendingBackendShutdown,
                      }
                    }

                    if (isAttachmentsLoadedMessage(event.response)) {
                      return {
                        lastMessageId,
                        attachmentsLoadedForCurrentPrompt: true,
                        awaitingResponse: context.awaitingResponse,
                        pendingBackendShutdown: responseComplete
                          ? false
                          : context.pendingBackendShutdown,
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

                    // Defensive: possible we hit messages we don't handle -
                    // don't add to context!
                    if (lastMessageType === undefined) {
                      return context
                    }

                    return {
                      conversation,
                      lastMessageId,
                      lastMessageType,
                      awaitingResponse: responseComplete
                        ? false
                        : context.awaitingResponse,
                      pendingBackendShutdown: responseComplete
                        ? false
                        : context.pendingBackendShutdown,
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
                MlEphantManagerTransitions.Cancel,
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
                  actions: [
                    assign(({ event, context }) => ({
                      ...event.output,
                      awaitingResponse: true,
                      attachmentsLoadedForCurrentPrompt:
                        event.output.attachmentsLoadedForCurrentPrompt ??
                        context.attachmentsLoadedForCurrentPrompt,
                      pendingBackendShutdown: context.pendingBackendShutdown,
                    })),
                  ],
                },
                onError: { target: S.Await, actions: ['toastError'] },
              },
            },
            [MlEphantManagerTransitions.Cancel]: {
              invoke: {
                input: (args) => {
                  assertEvent(args.event, [MlEphantManagerTransitions.Cancel])
                  return {
                    event: args.event,
                    context: args.context,
                  }
                },
                src: MlEphantManagerTransitions.Cancel,
                onDone: {
                  target: S.Await,
                  actions: [],
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
          ({ context }) => {
            // Close before clearing context so the live socket is still reachable.
            closeMlEphantWebSocket(context.ws)
          },
          assign(({ context }) => {
            if (context.abruptlyClosed) return {}
            // A clean close should not leak connection state into the next chat.
            return {
              abruptlyClosed: false,
              conversation: undefined,
              conversationId: undefined,
              cachedSetup: undefined,
              lastMessageId: undefined,
              lastMessageType: undefined,
              awaitingResponse: false,
              attachmentsLoadedForCurrentPrompt: true,
              pendingBackendShutdown: false,
              closeReason: undefined,
              ws: undefined,
            }
          }),
        ],
      },
    },
  },
})

export type MlEphantManagerActor = ActorRefFrom<typeof mlEphantManagerMachine>
export const MlEphantManagerReactContext = createActorContext(
  mlEphantManagerMachine
)
