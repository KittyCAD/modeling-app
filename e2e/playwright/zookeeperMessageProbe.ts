import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { decode as msgpackDecode } from '@msgpack/msgpack'
import type { Page, TestInfo } from '@playwright/test'

type FrameDirection = 'received' | 'sent'

type MessageIdentifiers = Record<string, string[]>

export type ZookeeperTransportEvent = {
  atMs: number
  byteLength: number
  contentHash?: string
  direction: FrameDirection
  identifiers: MessageIdentifiers
  messageType: string
  payloadHash?: string
  probeMatched: boolean
  replayIndex?: number
  sequence: number
  socketId: number
  socketPath: string
  timestamp: string
}

export type ZookeeperDomItem = {
  ariaLabel?: string
  index: number
  role: 'info' | 'request' | 'response' | 'retry'
  testId: string
  textHash: string
  textLength: number
  visible: boolean
}

export type ZookeeperDomCheckpoint = {
  checkpoint: string
  items: ZookeeperDomItem[]
  timestamp: string
}

export type ZookeeperStateCheckpoint = {
  available: boolean
  checkpoint: string
  reason?: string
  snapshot?: unknown
  timestamp: string
}

const MESSAGE_KEYS = [
  'attachments_loaded',
  'backend_shutdown',
  'conversation_id',
  'delta',
  'end_of_stream',
  'error',
  'files',
  'info',
  'modes_response',
  'pong',
  'project_updated',
  'reasoning',
  'replay',
  'request_attachments',
  'session_data',
  'tool_output',
  'zookeeper_auto_router_metadata',
  'zookeeper_open_ai_response_checkpoint',
  'zookeeper_recovery_tool_output',
  'zookeeper_turn_usage',
] as const

const IDENTIFIER_KEYS = new Set([
  'api_call_id',
  'call_id',
  'conversation_id',
  'correlation_id',
  'engine_api_call_id',
  'id',
  'prompt_id',
  'request_id',
  'response_id',
  'span_id',
  'thread_id',
  'trace_id',
])

const OMIT_TRAVERSAL_KEYS = new Set([
  'additional_files',
  'current_files',
  'data',
  'files',
  'outputs',
])

const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}

function messageType(value: unknown): string {
  if (!isRecord(value)) {
    return 'unknown'
  }
  if (typeof value.type === 'string') {
    return `client:${value.type}`
  }
  return MESSAGE_KEYS.find((key) => key in value) ?? 'unknown'
}

function messageContent(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  if (value.type === 'user' && typeof value.content === 'string') {
    return value.content
  }
  if (isRecord(value.delta) && typeof value.delta.delta === 'string') {
    return value.delta.delta
  }
  if (
    isRecord(value.end_of_stream) &&
    typeof value.end_of_stream.whole_response === 'string'
  ) {
    return value.end_of_stream.whole_response
  }
  if (isRecord(value.info) && typeof value.info.text === 'string') {
    return value.info.text
  }
  if (isRecord(value.error) && typeof value.error.detail === 'string') {
    return value.error.detail
  }
  for (const key of ['reasoning', 'tool_output', 'project_updated']) {
    if (key in value) {
      return stableStringify(value[key])
    }
  }
  return undefined
}

function collectIdentifiers(value: unknown): MessageIdentifiers {
  const found = new Map<string, Set<string>>()

  const visit = (candidate: unknown, depth: number) => {
    if (depth > 6 || candidate === null || candidate === undefined) {
      return
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate.slice(0, 100)) {
        visit(item, depth + 1)
      }
      return
    }
    if (!isRecord(candidate)) {
      return
    }

    for (const [key, item] of Object.entries(candidate)) {
      if (IDENTIFIER_KEYS.has(key) && typeof item === 'string') {
        const values = found.get(key) ?? new Set<string>()
        values.add(item)
        found.set(key, values)
      }
      if (!OMIT_TRAVERSAL_KEYS.has(key)) {
        visit(item, depth + 1)
      }
    }
  }

  visit(value, 0)
  return Object.fromEntries(
    [...found.entries()].map(([key, values]) => [key, [...values].sort()])
  )
}

function parseFramePayload(payload: string | Buffer): unknown {
  try {
    if (typeof payload === 'string') {
      return JSON.parse(payload)
    }
    return msgpackDecode(new Uint8Array(payload))
  } catch {
    return undefined
  }
}

function replayMessages(value: unknown): unknown[] {
  if (!isRecord(value) || !isRecord(value.replay)) {
    return []
  }
  const messages = value.replay.messages
  if (!Array.isArray(messages)) {
    return []
  }

  return messages.flatMap((bytes) => {
    if (!Array.isArray(bytes)) {
      return []
    }
    try {
      return [JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes)))]
    } catch {
      return []
    }
  })
}

function sanitizedSocketPath(rawUrl: string): {
  identifiers: MessageIdentifiers
  path: string
} {
  try {
    const url = new URL(rawUrl)
    const conversationId = url.searchParams.get('conversation_id')
    return {
      identifiers: conversationId ? { conversation_id: [conversationId] } : {},
      path: url.pathname,
    }
  } catch {
    return { identifiers: {}, path: 'unparseable-websocket-url' }
  }
}

function mergeIdentifiers(...sets: MessageIdentifiers[]): MessageIdentifiers {
  const merged = new Map<string, Set<string>>()
  for (const identifiers of sets) {
    for (const [key, values] of Object.entries(identifiers)) {
      const destination = merged.get(key) ?? new Set<string>()
      for (const value of values) {
        destination.add(value)
      }
      merged.set(key, destination)
    }
  }
  return Object.fromEntries(
    [...merged.entries()].map(([key, values]) => [key, [...values].sort()])
  )
}

export async function observeZookeeperMessageProvenance(
  page: Page,
  { probeId }: { probeId: string }
) {
  const startedAt = Date.now()
  const transport: ZookeeperTransportEvent[] = []
  const cdpTransport: ZookeeperTransportEvent[] = []
  const dom: ZookeeperDomCheckpoint[] = []
  const state: ZookeeperStateCheckpoint[] = []
  let sequence = 0
  let cdpSequence = 0
  let socketSequence = 0
  let cdpSocketSequence = 0
  let cdpUnavailableReason: string | undefined

  const recordFrame = ({
    direction,
    payload,
    socketId,
    socketPath,
    socketIdentifiers,
    replayIndex,
    destination = transport,
  }: {
    direction: FrameDirection
    payload: string | Buffer
    replayIndex?: number
    socketId: number
    socketIdentifiers: MessageIdentifiers
    socketPath: string
    destination?: ZookeeperTransportEvent[]
  }) => {
    const parsed = parseFramePayload(payload)
    const type = messageType(parsed)
    const isCredentialFrame =
      type === 'client:headers' ||
      (isRecord(parsed) && isRecord(parsed.headers))
    const content = isCredentialFrame ? undefined : messageContent(parsed)
    const eventSequence =
      destination === cdpTransport ? ++cdpSequence : ++sequence
    destination.push({
      atMs: Date.now() - startedAt,
      byteLength:
        typeof payload === 'string'
          ? Buffer.byteLength(payload, 'utf8')
          : payload.byteLength,
      ...(content === undefined ? {} : { contentHash: sha256(content) }),
      direction,
      identifiers: mergeIdentifiers(
        socketIdentifiers,
        isCredentialFrame ? {} : collectIdentifiers(parsed)
      ),
      messageType: type,
      ...(isCredentialFrame ? {} : { payloadHash: sha256(payload) }),
      probeMatched: content?.includes(probeId) ?? false,
      ...(replayIndex === undefined ? {} : { replayIndex }),
      sequence: eventSequence,
      socketId,
      socketPath,
      timestamp: new Date().toISOString(),
    })
  }

  page.on('websocket', (socket) => {
    const socketId = ++socketSequence
    const sanitized = sanitizedSocketPath(socket.url())
    if (sanitized.path !== '/ws/ml/copilot') {
      return
    }

    socket.on('framesent', ({ payload }) => {
      recordFrame({
        direction: 'sent',
        payload,
        socketId,
        socketIdentifiers: sanitized.identifiers,
        socketPath: sanitized.path,
      })
    })
    socket.on('framereceived', ({ payload }) => {
      recordFrame({
        direction: 'received',
        payload,
        socketId,
        socketIdentifiers: sanitized.identifiers,
        socketPath: sanitized.path,
      })
      const parsed = parseFramePayload(payload)
      replayMessages(parsed).forEach((message, replayIndex) => {
        recordFrame({
          direction: 'received',
          payload: JSON.stringify(message),
          replayIndex,
          socketId,
          socketIdentifiers: sanitized.identifiers,
          socketPath: sanitized.path,
        })
      })
    })
  })

  try {
    const cdp = await page.context().newCDPSession(page)
    const cdpSockets = new Map<
      string,
      {
        identifiers: MessageIdentifiers
        path: string
        socketId: number
      }
    >()
    await cdp.send('Network.enable')
    cdp.on('Network.webSocketCreated', ({ requestId, url }) => {
      const sanitized = sanitizedSocketPath(url)
      if (sanitized.path !== '/ws/ml/copilot') {
        return
      }
      cdpSockets.set(requestId, {
        identifiers: sanitized.identifiers,
        path: sanitized.path,
        socketId: ++cdpSocketSequence,
      })
    })

    const recordCdpFrame = ({
      direction,
      opcode,
      payloadData,
      requestId,
    }: {
      direction: FrameDirection
      opcode: number
      payloadData: string
      requestId: string
    }) => {
      const socket = cdpSockets.get(requestId)
      if (!socket) {
        return
      }
      recordFrame({
        destination: cdpTransport,
        direction,
        payload:
          opcode === 2 ? Buffer.from(payloadData, 'base64') : payloadData,
        socketId: socket.socketId,
        socketIdentifiers: socket.identifiers,
        socketPath: socket.path,
      })
    }

    cdp.on(
      'Network.webSocketFrameSent',
      ({ requestId, response: { opcode, payloadData } }) => {
        recordCdpFrame({
          direction: 'sent',
          opcode,
          payloadData,
          requestId,
        })
      }
    )
    cdp.on(
      'Network.webSocketFrameReceived',
      ({ requestId, response: { opcode, payloadData } }) => {
        recordCdpFrame({
          direction: 'received',
          opcode,
          payloadData,
          requestId,
        })
      }
    )
  } catch (error) {
    cdpUnavailableReason =
      error instanceof Error ? error.message : 'unknown CDP setup error'
  }

  const captureDom = async (checkpoint: string) => {
    const rawItems = await page
      .locator(
        [
          '[data-testid="ml-request-chat-bubble"]',
          '[data-testid="ml-response-chat-bubble"]',
          '[data-testid="ml-response-info-chat-bubble"]',
          '[data-testid="ml-response-retry-status"]',
        ].join(', ')
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const element = node as HTMLElement
          return {
            ariaLabel: element.getAttribute('aria-label') ?? undefined,
            testId: element.dataset.testid ?? 'unknown',
            text: element.innerText,
            visible: Boolean(
              element.offsetWidth ||
                element.offsetHeight ||
                element.getClientRects().length
            ),
          }
        })
      )

    const roleForTestId = (testId: string): ZookeeperDomItem['role'] => {
      if (testId === 'ml-request-chat-bubble') {
        return 'request'
      }
      if (testId === 'ml-response-chat-bubble') {
        return 'response'
      }
      if (testId === 'ml-response-info-chat-bubble') {
        return 'info'
      }
      return 'retry'
    }

    dom.push({
      checkpoint,
      items: rawItems.map((item, index) => ({
        ...(item.ariaLabel ? { ariaLabel: item.ariaLabel } : {}),
        index,
        role: roleForTestId(item.testId),
        testId: item.testId,
        textHash: sha256(item.text),
        textLength: item.text.length,
        visible: item.visible,
      })),
      timestamp: new Date().toISOString(),
    })
  }

  const captureState = async (checkpoint: string) => {
    const snapshot = await page.evaluate(async () => {
      const actor = window.app?.debug?.zookeeperManagerActor
      if (!actor) {
        return {
          available: false as const,
          reason:
            'app.debug.zookeeperManagerActor is not exposed by this deployment',
        }
      }

      const digest = async (value: string) => {
        const bytes = new TextEncoder().encode(value)
        const result = await crypto.subtle.digest('SHA-256', bytes)
        return Array.from(new Uint8Array(result), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('')
      }
      const state = actor.getSnapshot()
      const context = state.context
      const exchanges = await Promise.all(
        (context.conversation?.exchanges ?? []).map(
          async (exchange, exchangeIndex) => ({
            exchangeIndex,
            request:
              exchange.request && 'content' in exchange.request
                ? {
                    contentHash: await digest(exchange.request.content),
                    correlationId: exchange.request.correlation_id,
                    engineApiCallId: exchange.request.engine_api_call_id,
                    type: exchange.request.type,
                  }
                : undefined,
            responseCount: exchange.responses.length,
            responseTypes: exchange.responses.map(
              (response) =>
                Object.keys(response).find((key) =>
                  [
                    'delta',
                    'end_of_stream',
                    'error',
                    'info',
                    'reasoning',
                    'tool_output',
                  ].includes(key)
                ) ?? 'other'
            ),
            deltasAggregatedHash: await digest(exchange.deltasAggregated),
            deltasAggregatedLength: exchange.deltasAggregated.length,
          })
        )
      )
      return {
        available: true as const,
        snapshot: {
          awaitingResponse: context.awaitingResponse,
          conversationId: context.conversationId,
          exchanges,
          lastMessageId: context.lastMessageId,
          lastMessageType: context.lastMessageType,
          stateValue: state.value,
        },
      }
    })

    state.push({
      ...snapshot,
      checkpoint,
      timestamp: new Date().toISOString(),
    })
  }

  const captureCheckpoint = async (checkpoint: string) => {
    await captureDom(checkpoint)
    await captureState(checkpoint)
  }

  const attach = async (testInfo: TestInfo) => {
    const userSubmissions = transport.filter(
      (event) =>
        event.direction === 'sent' &&
        event.messageType === 'client:user' &&
        event.probeMatched
    )
    const inboundLiveTerminalMessages = transport.filter(
      (event) =>
        event.direction === 'received' &&
        event.messageType === 'end_of_stream' &&
        event.replayIndex === undefined
    )
    const replayedTerminalMessages = transport.filter(
      (event) =>
        event.direction === 'received' &&
        event.messageType === 'end_of_stream' &&
        event.replayIndex !== undefined
    )
    const replayEnvelopes = transport.filter(
      (event) =>
        event.messageType === 'replay' && event.replayIndex === undefined
    )
    const finalDom = dom.at(-1)
    const identifiers = mergeIdentifiers(
      ...transport.map((event) => event.identifiers)
    )
    const repeatedConversationIdFrames = transport
      .filter(
        (event) =>
          event.direction === 'received' &&
          event.messageType === 'conversation_id' &&
          event.replayIndex === undefined &&
          event.payloadHash !== undefined
      )
      .reduce<Record<string, number>>((counts, event) => {
        const key = `${event.socketId}:${event.payloadHash}`
        counts[key] = (counts[key] ?? 0) + 1
        return counts
      }, {})
    const conversationIdDuplicateGroups = Object.values(
      repeatedConversationIdFrames
    ).filter((count) => count > 1)
    const cdpConversationIdFrames = cdpTransport.filter(
      (event) =>
        event.direction === 'received' &&
        event.messageType === 'conversation_id' &&
        event.replayIndex === undefined
    )
    const cdpConversationIdDuplicateGroups = Object.values(
      cdpConversationIdFrames.reduce<Record<string, number>>(
        (counts, event) => {
          const key = `${event.socketId}:${event.payloadHash}`
          counts[key] = (counts[key] ?? 0) + 1
          return counts
        },
        {}
      )
    ).filter((count) => count > 1)
    const summary = {
      probeId,
      runWindow: {
        completedAt: new Date().toISOString(),
        startedAt: new Date(startedAt).toISOString(),
      },
      counts: {
        domInfo: finalDom?.items.filter((item) => item.role === 'info').length,
        domRequests: finalDom?.items.filter((item) => item.role === 'request')
          .length,
        domResponses: finalDom?.items.filter((item) => item.role === 'response')
          .length,
        conversationIdDuplicateFrames: conversationIdDuplicateGroups.reduce(
          (total, count) => total + count - 1,
          0
        ),
        conversationIdDuplicateGroups: conversationIdDuplicateGroups.length,
        cdpConversationIdDuplicateFrames:
          cdpConversationIdDuplicateGroups.reduce(
            (total, count) => total + count - 1,
            0
          ),
        cdpConversationIdDuplicateGroups:
          cdpConversationIdDuplicateGroups.length,
        cdpSockets: new Set(cdpTransport.map((event) => event.socketId)).size,
        inboundLiveTerminalMessages: inboundLiveTerminalMessages.length,
        replayEnvelopes: replayEnvelopes.length,
        replayedTerminalMessages: replayedTerminalMessages.length,
        sockets: new Set(transport.map((event) => event.socketId)).size,
        userSubmissions: userSubmissions.length,
      },
      identifiers,
      limitations: [
        state.some((checkpoint) => checkpoint.available)
          ? 'The deployment exposed a sanitized application-state snapshot.'
          : 'The production deployment did not expose the application actor; transport-to-DOM is observable but transport-to-store is not.',
        'Playwright and backend clocks were not synchronized beyond UTC wall-clock timestamps.',
        'Raw frame bodies, credentials, project files, and rendered message text were not persisted.',
        cdpUnavailableReason
          ? `Chrome DevTools transport capture was unavailable: ${cdpUnavailableReason}`
          : 'Chrome DevTools transport capture independently corroborated the Playwright WebSocket ledger.',
      ],
    }

    for (const [name, value] of [
      ['zookeeper-transport-ledger.json', transport],
      ['zookeeper-cdp-transport-ledger.json', cdpTransport],
      ['zookeeper-dom-ledger.json', dom],
      ['zookeeper-state-ledger.json', state],
      ['zookeeper-correlation-summary.json', summary],
    ] as const) {
      const artifactPath = testInfo.outputPath(name)
      await writeFile(artifactPath, JSON.stringify(value, null, 2), 'utf8')
      await testInfo.attach(name, {
        contentType: 'application/json',
        path: artifactPath,
      })
    }

    return summary
  }

  return { attach, captureCheckpoint, cdpTransport, dom, state, transport }
}
