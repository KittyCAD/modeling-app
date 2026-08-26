import type {
  MlCopilotClientMessage,
  MlCopilotFile,
  MlCopilotServerMessage,
} from '@kittycad/lib'
import { decode as msgpackDecode } from '@msgpack/msgpack'
import {
  type CustomIconName,
  isCustomIconName,
} from '@src/components/CustomIcon'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import { getKclVersion } from '@src/lib/kclVersion'
import { Socket, SocketConnectionError } from '@src/lib/socket'
import { isErr } from '@src/lib/trap'
import { isArray, uuidv4 } from '@src/lib/utils'
import { withZookeeperWebSocketURL } from '@src/lib/withBaseURL'
import { isZookeeperBillingError } from '@src/lib/zookeeper/zookeeperBilling'
import { S, transitions, xstateEventError } from '@src/machines/utils'
import { createActorContext } from '@xstate/react'
import ms from 'ms'
import type { ActorRefFrom } from 'xstate'
import { assertEvent, assign, fromPromise, setup } from 'xstate'

// Uncomment and switch WebSocket below with this MockSocket for development.
// import { MockSocket } from '@src/mocks/copilot'

import type { KclManager } from '@src/lang/KclManager'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { FileEntry, Project } from '@src/lib/project'
import type { FileMeta } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  constructZookeeperUserPromptRequest,
  type KittyCadLibFile,
} from '@src/lib/zookeeper/zookeeperPromptRequest'
import type { Selections } from '@src/machines/modelingSharedTypes'

import toast from 'react-hot-toast'

export enum ZookeeperSetupErrors {
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
  correlation_id?: string
  engine_api_call_id?: string
}

export const createZookeeperCorrelation = (
  engineApiCallId: string | undefined
) => ({
  correlation_id: uuidv4(),
  ...(engineApiCallId ? { engine_api_call_id: engineApiCallId } : {}),
})

type MlCopilotProjectContextRequest = Extract<
  MlCopilotClientMessage,
  { type: 'project_context' }
> & {
  active_file?: string
  correlation_id?: string
  engine_api_call_id?: string
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

export enum ZookeeperManagerStates {
  Setup = 'setup',
  WaitForContinueCheck = 'wait-for-continue-check',
  ContinueCheck = 'continue-check',
  Ready = 'ready',
  Response = 'response',
  Request = 'request',
}

export enum ZookeeperManagerTransitions {
  AuthTokenChanged = 'auth-token-changed',
  MessageSend = 'message-send',
  ResponseReceive = 'response-receive',
  ModesReceive = 'modes-receive',
  ConversationClose = 'conversation-close',
  Cancel = 'cancel',
  Interrupt = 'interrupt',
  AbruptClose = 'abrupt-close',
  ResumeSuperseded = 'resume-superseded',
  NetworkOffline = 'network-offline',
  CacheSetupAndConnect = 'cache-setup-and-connect',
  BackendShutdown = 'backend-shutdown',
  SetupProgress = 'setup-progress',
}

export const NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS = 3
export const ZOOKEEPER_SETUP_INACTIVITY_TIMEOUT_MS = 60_000
export const ZOOKEEPER_SETUP_ATTEMPT_TIMEOUT_MS = 120_000
export const ZOOKEEPER_HEARTBEAT_INTERVAL_MS = 4_000
export const ZOOKEEPER_HEARTBEAT_TIMEOUT_MS = 30_000
export const ZOOKEEPER_RESUME_SUPERSEDED_CLOSE_CODE = 4409
const ZOOKEEPER_HEARTBEAT_TIMER_DRIFT_GRACE_MS = 5_000

const ZOOKEEPER_PROJECT_TOO_LARGE_CLOSE_REASON =
  'Your project files are too large to send to Zookeeper. Try removing large STL/STEP files or splitting your project.'

class ZookeeperSetupConnectionError extends Error {
  closeReason?: string

  constructor(message: string, closeReason?: string) {
    super(message)
    this.name = 'ZookeeperSetupConnectionError'
    this.closeReason = closeReason
  }
}

function getSetupFailureReason(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) {
    return undefined
  }
  if ('closeReason' in event && typeof event.closeReason === 'string') {
    return event.closeReason
  }
  if (
    'error' in event &&
    event.error instanceof ZookeeperSetupConnectionError
  ) {
    return event.error.closeReason
  }
  if (
    'error' in event &&
    event.error instanceof SocketConnectionError &&
    event.error.code === 1009
  ) {
    return ZOOKEEPER_PROJECT_TOO_LARGE_CLOSE_REASON
  }
  return undefined
}

export type ZookeeperManagerEvents =
  | {
      type: ZookeeperManagerTransitions.AuthTokenChanged
      apiToken: string
    }
  | {
      type: 'xstate.done.state.(machine).ready'
      conversationId: undefined
    }
  | {
      type: 'xstate.error.actor.0.(machine).setup'
      conversationId: undefined
    }
  | {
      type: ZookeeperManagerTransitions.CacheSetupAndConnect
      refParentSend: (event: ZookeeperManagerEvents) => void
      // If not present, a new conversation is created.
      conversationId?: string
    }
  | {
      type: ZookeeperManagerStates.Setup
      refParentSend: (event: ZookeeperManagerEvents) => void
      // If not present, a new conversation is created.
      conversationId?: string
    }
  | {
      type: ZookeeperManagerTransitions.MessageSend
      projectForPromptOutput: Project
      prompt: string
      applicationProjectDirectory: string
      fileSelectedDuringPrompting: { entry: FileEntry; content: string }
      projectFiles: FileMeta[]
      selections: Selections | null
      artifactGraph: ArtifactGraph
      kclManager: KclManager
      engineCommandManager: ConnectionManager
      wasmInstance: ModuleType
      mode?: MlCopilotModeId
      additionalFiles?: File[]
    }
  | {
      type: ZookeeperManagerStates.ContinueCheck
      projectName: string
      projectFiles: FileMeta[]
      activeFile?: string
      engineApiCallId?: string
    }
  | {
      type: ZookeeperManagerTransitions.ResponseReceive
      response: MlCopilotServerMessage
    }
  | {
      type: ZookeeperManagerTransitions.ModesReceive
      defaultMode?: MlCopilotModeId
      modeOptions: MlCopilotModeOption[]
    }
  | {
      type: ZookeeperManagerTransitions.ConversationClose
    }
  | {
      type: ZookeeperManagerTransitions.Cancel
    }
  | {
      type: ZookeeperManagerTransitions.Interrupt
    }
  | {
      type: ZookeeperManagerTransitions.AbruptClose
      closeReason?: string
    }
  | {
      type: ZookeeperManagerTransitions.ResumeSuperseded
      webSocket: WebSocket
    }
  | {
      type: ZookeeperManagerTransitions.NetworkOffline
    }
  | {
      type: ZookeeperManagerTransitions.BackendShutdown
    }
  | {
      type: ZookeeperManagerTransitions.SetupProgress
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

  // Client-side start time for an in-progress response.
  startedAt?: Date
}

export type Conversation = {
  exchanges: Exchange[]
}

export interface ZookeeperManagerContext {
  apiToken: string
  ws?: WebSocket
  abruptlyClosed: boolean
  setupFailed: boolean
  setupAttempt: number
  setupFailureReason?: string
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
    refParentSend?: (event: ZookeeperManagerEvents) => void
    conversationId?: string
    activeExchangeStartedAt?: Date
  }
}

export const zookeeperDefaultContext = (args: {
  input?: {
    apiToken?: string
  } | null
}): ZookeeperManagerContext => ({
  apiToken: args.input?.apiToken ?? '',
  ws: undefined,
  abruptlyClosed: false,
  setupFailed: false,
  setupAttempt: 0,
  setupFailureReason: undefined,
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
  ZookeeperManagerContext,
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
  context: ZookeeperManagerContext
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

function terminalSetupFailureMessage(
  context: ZookeeperManagerContext,
  event: unknown
): string {
  return (
    getSetupFailureReason(event) ??
    context.setupFailureReason ??
    (context.conversationId === undefined
      ? `Zookeeper couldn't connect after ${NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS} attempts.`
      : `Zookeeper couldn't load this conversation after ${NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS} attempts.`)
  )
}

function reportZookeeperClientError(args: {
  code: ClientErrorCode
  error: Error
  dedupeKey?: string
  extra?: Record<string, unknown>
}) {
  // Transient backend and websocket lifecycle events are not reported
  // individually. Setup failures are reported once only after retries are
  // exhausted and the recovery UI becomes visible.
  void reportClientError({
    code: args.code,
    message: args.error.message,
    error: args.error,
    dedupeKey: args.dedupeKey,
    extra: {
      source: 'ZookeeperManagerMachine',
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

const intentionalZookeeperCloses = new WeakSet<WebSocket>()

function closeZookeeperWebSocket(ws: WebSocket | undefined) {
  if (ws?.readyState !== WebSocket.OPEN) return
  intentionalZookeeperCloses.add(ws)
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

export const ZookeeperConversationToMarkdown = (
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
  input: { event: Extract<ZookeeperManagerEvents, { type: T }> } & {
    context: ZookeeperManagerContext
  }
  signal: AbortSignal
}

export const zookeeperManagerMachine = setup({
  types: {
    context: {} as ZookeeperManagerContext,
    input: {} as Pick<ZookeeperManagerContext, 'apiToken'>,
    events: {} as ZookeeperManagerEvents,
  },
  guards: {
    canRetrySetup: ({ context }) =>
      context.setupAttempt < NUMBER_OF_ZOOKEEPER_SETUP_ATTEMPTS,
    hasApiToken: ({ context }) => context.apiToken.trim().length > 0,
    canResumeSetupWithApiToken: ({ context, event }) => {
      assertEvent(event, ZookeeperManagerTransitions.AuthTokenChanged)
      return (
        context.cachedSetup !== undefined && event.apiToken.trim().length > 0
      )
    },
    apiTokenChanged: ({ context, event }) => {
      assertEvent(event, ZookeeperManagerTransitions.AuthTokenChanged)
      return event.apiToken !== context.apiToken
    },
    apiTokenCleared: ({ event }) => {
      assertEvent(event, ZookeeperManagerTransitions.AuthTokenChanged)
      return event.apiToken.trim().length === 0
    },
    isCurrentZookeeperWebSocket: ({ context, event }) => {
      assertEvent(event, ZookeeperManagerTransitions.ResumeSuperseded)
      return context.ws === event.webSocket
    },
  },
  actions: {
    assignApiToken: assign(({ event }) => {
      assertEvent(event, ZookeeperManagerTransitions.AuthTokenChanged)
      return { apiToken: event.apiToken }
    }),
    toastError: ({ event, context }) => {
      console.error(event)
      const error = xstateEventError(event)
      if (!isErr(error)) return

      reportZookeeperClientError({
        code: ClientErrorCode.ZookeeperActorError,
        error,
        dedupeKey: `ZookeeperManagerMachine:actor-error:${event.type}:${error.message}`,
        extra: {
          eventType: event.type,
          ...zookeeperErrorContext(context),
        },
      })
      toast.error(error.message)
    },
    reportTerminalSetupFailure: ({ event, context }) => {
      const rejectedValue = 'error' in event ? event.error : undefined
      const error = isErr(rejectedValue)
        ? rejectedValue
        : new Error(
            typeof rejectedValue === 'string' && rejectedValue.length > 0
              ? rejectedValue
              : terminalSetupFailureMessage(context, event)
          )
      reportZookeeperClientError({
        code: ClientErrorCode.ZookeeperSetupError,
        error,
        extra: {
          eventType: event.type,
          terminal: true,
          setupAttempt: context.setupAttempt,
          setupFailureReason:
            getSetupFailureReason(event) ?? context.setupFailureReason,
          rejectedValue:
            rejectedValue !== undefined && !isErr(rejectedValue)
              ? String(rejectedValue)
              : undefined,
          ...zookeeperErrorContext(context),
        },
      })
    },
    handleAbruptClose: assign(({ event, context }) => {
      assertEvent(event, [
        ZookeeperManagerTransitions.AbruptClose,
        ZookeeperManagerTransitions.ResumeSuperseded,
      ])
      const closeReason =
        event.type === ZookeeperManagerTransitions.AbruptClose
          ? event.closeReason
          : undefined
      logZookeeperDisconnect('machine handling abrupt websocket close', {
        closeReason,
        resumeSuperseded:
          event.type === ZookeeperManagerTransitions.ResumeSuperseded,
        ...zookeeperErrorContext(context),
      })
      if (closeReason && !isZookeeperBillingError(closeReason)) {
        toast.error(closeReason)
      }
      return {
        abruptlyClosed: true,
        setupFailed: false,
        setupFailureReason: undefined,
        closeReason,
      }
    }),
    handleNetworkOffline: assign(({ context }) => {
      logZookeeperDisconnect('browser reported network offline', {
        ...zookeeperErrorContext(context),
      })
      return {
        abruptlyClosed: true,
        setupFailed: false,
        setupFailureReason: undefined,
        closeReason: 'No internet connection.',
      }
    }),
    prepareSetupRetry: assign(({ event, context }) => {
      return {
        setupAttempt: context.setupAttempt + 1,
        setupFailureReason:
          getSetupFailureReason(event) ?? context.setupFailureReason,
        cachedSetup: {
          refParentSend: context.cachedSetup?.refParentSend,
          conversationId: context.cachedSetup?.conversationId,
          activeExchangeStartedAt: context.cachedSetup?.activeExchangeStartedAt,
        },
      }
    }),
    markSetupFailed: assign(({ context, event }) => {
      const setupFailureReason =
        getSetupFailureReason(event) ?? context.setupFailureReason
      const closeReason = terminalSetupFailureMessage(context, event)
      logZookeeperDisconnect('conversation setup attempts exhausted', {
        ...zookeeperErrorContext(context),
        setupAttempt: context.setupAttempt,
        setupFailureReason,
      })
      return {
        abruptlyClosed: true,
        setupFailed: true,
        setupFailureReason,
        closeReason,
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
      assertEvent(event, ZookeeperManagerTransitions.ModesReceive)
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
      assertEvent(event, ZookeeperManagerTransitions.ResponseReceive)
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
    prepareSetup: assign(({ context, event }) => {
      assertEvent(event, ZookeeperManagerTransitions.CacheSetupAndConnect)
      closeZookeeperWebSocket(context.ws)

      return {
        ws: undefined,
        abruptlyClosed: false,
        setupFailed: false,
        setupAttempt: 1,
        setupFailureReason: undefined,
        closeReason: undefined,
        lastMessageId: undefined,
        lastMessageType: undefined,
        conversation: undefined,
        conversationId: event.conversationId || undefined,
        defaultMode: undefined,
        modeOptions: undefined,
        awaitingResponse: false,
        attachmentsLoadedForCurrentPrompt: true,
        pendingBackendShutdown: false,
        cachedSetup: {
          refParentSend: event.refParentSend,
          conversationId: event.conversationId,
          activeExchangeStartedAt:
            context.conversation?.exchanges.findLast((exchange) =>
              isMlCopilotUserRequest(exchange.request)
            )?.startedAt ?? context.cachedSetup?.activeExchangeStartedAt,
        },
      }
    }),
    clearCacheSetup: assign({
      cachedSetup: undefined,
    }),
  },
  actors: {
    [ZookeeperManagerStates.Setup]: fromPromise(async function (
      args: XSInput<ZookeeperManagerStates.Setup>
    ): Promise<Partial<ZookeeperManagerContext>> {
      assertEvent(args.input.event, ZookeeperManagerStates.Setup)

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
      const url = withZookeeperWebSocketURL(querystring)
      const conversationId =
        args.input.context.conversationId ?? args.input.event.conversationId

      // Defensive: if there's already an open connection, close it.
      closeZookeeperWebSocket(args.input.context.ws)

      const ws = await Socket(
        WebSocket,
        url,
        args.input.context.apiToken,
        args.signal
      )
      ws.binaryType = 'arraybuffer'

      logZookeeperDisconnect('websocket opened and authenticated', {
        conversationId,
        url,
        readyState: getWebSocketReadyStateLabel(ws.readyState),
      })

      let maybeReplayedExchanges: Exchange[] = []
      let maybeModeOptions: MlCopilotModeOption[] | undefined
      let maybeDefaultMode: MlCopilotModeId | undefined
      let setupResolved = false

      return await new Promise<Partial<ZookeeperManagerContext>>(
        (onFulfilled, onRejected) => {
          let devCalledClose = false
          let attemptCanceled = false

          // Any WS protocol messages will trigger the `api` heartbeat update.
          let heartbeatSentAt: number | undefined
          const pingIntervalId = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) {
              return
            }
            const now = Date.now()
            if (heartbeatSentAt !== undefined) {
              const heartbeatElapsed = now - heartbeatSentAt
              if (heartbeatElapsed >= ZOOKEEPER_HEARTBEAT_TIMEOUT_MS) {
                if (
                  heartbeatElapsed - ZOOKEEPER_HEARTBEAT_TIMEOUT_MS <=
                  ZOOKEEPER_HEARTBEAT_TIMER_DRIFT_GRACE_MS
                ) {
                  clearInterval(pingIntervalId)
                  logZookeeperDisconnect('websocket heartbeat timed out', {
                    conversationId,
                    readyState: getWebSocketReadyStateLabel(ws.readyState),
                  })
                  theRefParentSend({
                    type: ZookeeperManagerTransitions.AbruptClose,
                    closeReason: 'Zookeeper connection timed out.',
                  })
                  return
                }
                heartbeatSentAt = undefined
              }
            }
            ws.send(JSON.stringify({ type: 'ping' }))
            heartbeatSentAt ??= now
          }, ZOOKEEPER_HEARTBEAT_INTERVAL_MS)
          const cancelSetupAttempt = () => {
            if (attemptCanceled) {
              return
            }
            attemptCanceled = true
            devCalledClose = true
            clearInterval(pingIntervalId)
            ws.close()
          }
          args.signal.addEventListener('abort', cancelSetupAttempt, {
            once: true,
          })
          if (args.signal.aborted) {
            cancelSetupAttempt()
            onRejected(new Error('Zookeeper conversation setup was canceled'))
            return
          }

          ws.addEventListener('error', function (event: Event) {
            if (attemptCanceled) {
              return
            }
            logZookeeperDisconnect('websocket error event received', {
              conversationId,
              readyState: getWebSocketReadyStateLabel(ws.readyState),
              eventType: event.type,
            })
          })

          ws.addEventListener('message', function (event: MessageEvent<any>) {
            if (attemptCanceled) {
              return
            }
            heartbeatSentAt = undefined

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
                  dedupeKey: `ZookeeperManagerMachine:binary-decode:${String(conversationId)}:${msgpackError.message}`,
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
                  dedupeKey: `ZookeeperManagerMachine:json-parse:${String(conversationId)}:${e.message}`,
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

            if (!setupResolved) {
              theRefParentSend({
                type: ZookeeperManagerTransitions.SetupProgress,
              })
            }

            const modesResult = parseMlCopilotModesResult(response)
            if (modesResult !== null) {
              maybeModeOptions = modesResult.modeOptions
              maybeDefaultMode = modesResult.defaultMode
              if (setupResolved && theRefParentSend) {
                theRefParentSend({
                  type: ZookeeperManagerTransitions.ModesReceive,
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
                  type: ZookeeperManagerTransitions.BackendShutdown,
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
              isZookeeperBillingError(response.error.detail)
            ) {
              if (setupResolved) {
                theRefParentSend({
                  type: ZookeeperManagerTransitions.AbruptClose,
                  closeReason: response.error.detail,
                })
              } else {
                cancelSetupAttempt()
                onRejected(
                  new ZookeeperSetupConnectionError(
                    response.error.detail,
                    response.error.detail
                  )
                )
              }
              return
            }

            if (
              'error' in response &&
              (response.error.detail.includes(
                ZookeeperSetupErrors.ConversationNotFound
              ) ||
                response.error.detail.includes(
                  ZookeeperSetupErrors.InvalidConversationId
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
              cancelSetupAttempt()
              onRejected(ZookeeperSetupErrors.ConversationNotFound)
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
            }

            // We're only considered setup when a conversation_id is assigned
            // to us. That means data is being stored and the system is ready.
            if ('conversation_id' in response) {
              const activeExchange = maybeReplayedExchanges.findLast(
                (exchange) => isMlCopilotUserRequest(exchange.request)
              )
              if (activeExchange) {
                activeExchange.startedAt =
                  args.input.context.cachedSetup?.activeExchangeStartedAt
              }

              setupResolved = true
              args.signal.removeEventListener('abort', cancelSetupAttempt)
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
                type: ZookeeperManagerTransitions.ResponseReceive,
                response,
              })
            } else {
              cancelSetupAttempt()
              onRejected(ZookeeperSetupErrors.NoRefParentSend)
            }
          })

          const listModesRequest: MlCopilotListModesRequest = {
            type: 'list_modes',
          }
          ws.send(JSON.stringify(listModesRequest))

          ws.addEventListener('close', function (event: CloseEvent) {
            clearInterval(pingIntervalId)
            attemptCanceled = true
            const intentionallyClosed = intentionalZookeeperCloses.has(ws)
            if (intentionallyClosed) {
              intentionalZookeeperCloses.delete(ws)
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

            if (devCalledClose) {
              return
            }

            if (!setupResolved) {
              onRejected(
                new ZookeeperSetupConnectionError(
                  `WebSocket closed while loading the Zookeeper conversation (code ${event.code})`,
                  event.code === 1009
                    ? ZOOKEEPER_PROJECT_TOO_LARGE_CLOSE_REASON
                    : undefined
                )
              )
              return
            }

            if (theRefParentSend !== undefined) {
              if (event.code === ZOOKEEPER_RESUME_SUPERSEDED_CLOSE_CODE) {
                theRefParentSend({
                  type: ZookeeperManagerTransitions.ResumeSuperseded,
                  webSocket: ws,
                })
                return
              }

              const closeReason =
                event.code === 1009
                  ? ZOOKEEPER_PROJECT_TOO_LARGE_CLOSE_REASON
                  : undefined
              theRefParentSend({
                type: ZookeeperManagerTransitions.AbruptClose,
                closeReason,
              })
            }
          })
        }
      )
    }),
    [ZookeeperManagerTransitions.MessageSend]: fromPromise(async function (
      args: XSInput<ZookeeperManagerTransitions.MessageSend>
    ): Promise<Partial<ZookeeperManagerContext>> {
      const { context, event } = args.input
      if (!isPresent<WebSocket>(context.ws))
        return Promise.reject(new Error('WebSocket not present'))
      if (!isPresent<Conversation>(context.conversation))
        return Promise.reject(new Error('Conversation not present'))

      const requestData = await constructZookeeperUserPromptRequest({
        conversationId: context.conversationId ?? '',
        prompt: event.prompt,
        selections: event.selections,
        applicationProjectDirectory: event.applicationProjectDirectory,
        projectFiles: event.projectFiles,
        artifactGraph: event.artifactGraph,
        projectName: event.projectForPromptOutput.name,
        currentFile: event.fileSelectedDuringPrompting,
        kclVersion: getKclVersion(),
        kclManager: event.kclManager,
        engineCommandManager: event.engineCommandManager,
        wasmInstance: event.wasmInstance,
      })
      if (isErr(requestData)) return Promise.reject(requestData)

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
        ...createZookeeperCorrelation(event.engineCommandManager.apiCallId),
        content: requestData.body.prompt ?? '',
        project_name: requestData.body.project_name,
        ...(requestData.body.source_ranges !== undefined
          ? { source_ranges: requestData.body.source_ranges }
          : {}),
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
    [ZookeeperManagerStates.ContinueCheck]: fromPromise(async function (
      args: XSInput<ZookeeperManagerStates.ContinueCheck>
    ): Promise<Partial<ZookeeperManagerContext>> {
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
        ...createZookeeperCorrelation(event.engineApiCallId),
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
        projectNameCurrentlyOpened: event.projectName,
      }
    }),
    [ZookeeperManagerTransitions.Cancel]: fromPromise(async function (
      args: XSInput<ZookeeperManagerTransitions.Cancel>
    ): Promise<Partial<ZookeeperManagerContext>> {
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
    [ZookeeperManagerTransitions.Interrupt]: fromPromise(async function (
      args: XSInput<ZookeeperManagerTransitions.Interrupt>
    ): Promise<Partial<ZookeeperManagerContext>> {
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
  context: zookeeperDefaultContext,
  exit: (args) => {
    // Make sure the connection is closed.
    closeZookeeperWebSocket(args.context?.ws)
  },
  on: {
    [ZookeeperManagerTransitions.AuthTokenChanged]: {
      actions: ['assignApiToken'],
    },
    [ZookeeperManagerTransitions.ModesReceive]: {
      actions: ['assignModeOptions'],
    },
    [ZookeeperManagerTransitions.AbruptClose]: {
      target: '#zookeeper-abrupt-close',
      actions: ['handleAbruptClose'],
    },
    [ZookeeperManagerTransitions.ResumeSuperseded]: {
      guard: 'isCurrentZookeeperWebSocket',
      target: '#zookeeper-abrupt-close',
      actions: ['handleAbruptClose'],
    },
    [ZookeeperManagerTransitions.NetworkOffline]: {
      target: '#zookeeper-abrupt-close',
      actions: ['handleNetworkOffline'],
    },
  },
  states: {
    [S.Await]: {
      on: {
        [ZookeeperManagerTransitions.CacheSetupAndConnect]: [
          {
            guard: 'hasApiToken',
            target: ZookeeperManagerStates.Setup,
            actions: ['prepareSetup'],
          },
          {
            actions: ['prepareSetup'],
          },
        ],
        [ZookeeperManagerTransitions.AuthTokenChanged]: [
          {
            guard: 'canResumeSetupWithApiToken',
            target: ZookeeperManagerStates.Setup,
            actions: ['assignApiToken'],
          },
          {
            actions: ['assignApiToken'],
          },
        ],
        ...transitions([ZookeeperManagerStates.Setup]),
      },
    },
    [ZookeeperManagerStates.Setup]: {
      id: 'zookeeper-setup',
      initial: 'waiting-for-progress',
      states: {
        'waiting-for-progress': {
          after: {
            [ZOOKEEPER_SETUP_INACTIVITY_TIMEOUT_MS]: [
              {
                guard: 'canRetrySetup',
                target: '#zookeeper-setup',
                actions: ['prepareSetupRetry'],
                reenter: true,
              },
              {
                target: '#zookeeper-conversation-close',
                actions: ['reportTerminalSetupFailure', 'markSetupFailed'],
              },
            ],
          },
          on: {
            [ZookeeperManagerTransitions.SetupProgress]: {
              target: 'waiting-for-progress',
              reenter: true,
            },
          },
        },
      },
      invoke: {
        input: (args) => {
          return {
            event: {
              type: ZookeeperManagerStates.Setup,
              conversationId:
                'conversationId' in args.event
                  ? args.event.conversationId
                  : undefined,
              refParentSend: args.self.send,
            },
            context: args.context,
          }
        },
        src: ZookeeperManagerStates.Setup,
        onDone: {
          target: ZookeeperManagerStates.WaitForContinueCheck,
          actions: [
            assign(({ event, context }) => ({
              ...event.output,
              defaultMode: event.output.defaultMode ?? context.defaultMode,
              modeOptions: event.output.modeOptions ?? context.modeOptions,
              setupFailed: false,
              setupAttempt: 0,
              setupFailureReason: undefined,
              awaitingResponse: false,
              attachmentsLoadedForCurrentPrompt: true,
              pendingBackendShutdown: false,
            })),
            'clearCacheSetup',
          ],
        },
        onError: [
          {
            guard: 'canRetrySetup',
            target: ZookeeperManagerStates.Setup,
            actions: ['prepareSetupRetry'],
            reenter: true,
          },
          {
            target: ZookeeperManagerTransitions.ConversationClose,
            actions: ['reportTerminalSetupFailure', 'markSetupFailed'],
          },
        ],
      },
      after: {
        [ZOOKEEPER_SETUP_ATTEMPT_TIMEOUT_MS]: [
          {
            guard: 'canRetrySetup',
            target: '#zookeeper-setup',
            actions: ['prepareSetupRetry'],
            reenter: true,
          },
          {
            target: '#zookeeper-conversation-close',
            actions: ['reportTerminalSetupFailure', 'markSetupFailed'],
          },
        ],
      },
      on: {
        [ZookeeperManagerTransitions.AuthTokenChanged]: [
          {
            guard: 'apiTokenCleared',
            target: S.Await,
            actions: ['assignApiToken'],
          },
          {
            guard: 'apiTokenChanged',
            target: ZookeeperManagerStates.Setup,
            actions: ['assignApiToken'],
            reenter: true,
          },
        ],
        ...transitions([ZookeeperManagerTransitions.ConversationClose]),
        [ZookeeperManagerTransitions.AbruptClose]: [
          {
            guard: 'canRetrySetup',
            target: ZookeeperManagerStates.Setup,
            actions: ['prepareSetupRetry'],
            reenter: true,
          },
          {
            target: ZookeeperManagerTransitions.ConversationClose,
            actions: ['reportTerminalSetupFailure', 'markSetupFailed'],
          },
        ],
        [ZookeeperManagerTransitions.BackendShutdown]: {
          actions: ['handleBackendShutdown', 'disconnectIfIdle'],
        },
      },
    },
    // Must wait because other systems have the data we need for the check.
    [ZookeeperManagerStates.WaitForContinueCheck]: {
      on: {
        ...transitions([ZookeeperManagerStates.ContinueCheck]),
      },
    },
    [ZookeeperManagerStates.ContinueCheck]: {
      invoke: {
        input: (args) => {
          assertEvent(args.event, [ZookeeperManagerStates.ContinueCheck])

          return {
            event: args.event,
            context: args.context,
          }
        },
        src: ZookeeperManagerStates.ContinueCheck,
        onDone: {
          target: ZookeeperManagerStates.Ready,
          actions: [
            assign({
              awaitingResponse({ event }) {
                return event.output.awaitingResponse ?? false
              },
              projectNameCurrentlyOpened({ context, event }) {
                return (
                  event.output.projectNameCurrentlyOpened ??
                  context.projectNameCurrentlyOpened
                )
              },
            }),
          ],
        },
        onError: { target: S.Await, actions: ['toastError'] },
      },
    },
    [ZookeeperManagerStates.Ready]: {
      type: 'parallel',
      on: {
        [ZookeeperManagerTransitions.BackendShutdown]: {
          actions: ['handleBackendShutdown', 'disconnectIfIdle'],
        },
      },
      states: {
        [ZookeeperManagerStates.Response]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              on: {
                ...transitions([
                  ZookeeperManagerTransitions.ResponseReceive,
                  ZookeeperManagerTransitions.ConversationClose,
                ]),
                [ZookeeperManagerTransitions.AbruptClose]: {
                  target: ZookeeperManagerTransitions.AbruptClose,
                  actions: ['handleAbruptClose'],
                },
              },
            },
            [ZookeeperManagerTransitions.ConversationClose]: {
              type: 'final',
            },
            [ZookeeperManagerTransitions.AbruptClose]: {
              type: 'final',
            },
            // Triggered by the WebSocket 'message' event.
            [ZookeeperManagerTransitions.ResponseReceive]: {
              always: {
                target: S.Await,
                actions: [
                  'disconnectIfPendingBackendShutdown',
                  assign(({ event, context }) => {
                    assertEvent(event, [
                      ZookeeperManagerTransitions.ResponseReceive,
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
                      'files',
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
        [ZookeeperManagerStates.Request]: {
          initial: S.Await,
          states: {
            [S.Await]: {
              on: transitions([
                ZookeeperManagerTransitions.MessageSend,
                ZookeeperManagerTransitions.Cancel,
                ZookeeperManagerTransitions.Interrupt,
                ZookeeperManagerTransitions.ConversationClose,
                ZookeeperManagerTransitions.AbruptClose,
              ]),
            },
            [ZookeeperManagerTransitions.ConversationClose]: {
              type: 'final',
            },
            [ZookeeperManagerTransitions.AbruptClose]: {
              type: 'final',
            },
            [ZookeeperManagerTransitions.MessageSend]: {
              invoke: {
                input: (args) => {
                  assertEvent(args.event, [
                    ZookeeperManagerTransitions.MessageSend,
                  ])
                  return {
                    event: args.event,
                    context: args.context,
                  }
                },
                src: ZookeeperManagerTransitions.MessageSend,
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
            [ZookeeperManagerTransitions.Cancel]: {
              invoke: {
                input: (args) => {
                  assertEvent(args.event, [ZookeeperManagerTransitions.Cancel])
                  return {
                    event: args.event,
                    context: args.context,
                  }
                },
                src: ZookeeperManagerTransitions.Cancel,
                onDone: {
                  target: S.Await,
                  actions: [],
                },
                onError: { target: S.Await, actions: ['toastError'] },
              },
            },
            [ZookeeperManagerTransitions.Interrupt]: {
              invoke: {
                input: (args) => {
                  assertEvent(args.event, [
                    ZookeeperManagerTransitions.Interrupt,
                  ])
                  return {
                    event: args.event,
                    context: args.context,
                  }
                },
                src: ZookeeperManagerTransitions.Interrupt,
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
        target: ZookeeperManagerTransitions.ConversationClose,
      },
    },
    [ZookeeperManagerTransitions.AbruptClose]: {
      id: 'zookeeper-abrupt-close',
      always: {
        target: ZookeeperManagerTransitions.ConversationClose,
      },
    },
    [ZookeeperManagerTransitions.ConversationClose]: {
      id: 'zookeeper-conversation-close',
      always: {
        target: S.Await,
        actions: [
          ({ context }) => {
            // Close before clearing context so the live socket is still reachable.
            closeZookeeperWebSocket(context.ws)
          },
          assign(({ context }) => {
            if (context.abruptlyClosed) return {}
            // A clean close should not leak connection state into the next chat.
            return {
              abruptlyClosed: false,
              setupFailed: false,
              setupAttempt: 0,
              setupFailureReason: undefined,
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

export type ZookeeperManagerActor = ActorRefFrom<typeof zookeeperManagerMachine>
export const ZookeeperManagerReactContext = createActorContext(
  zookeeperManagerMachine
)
