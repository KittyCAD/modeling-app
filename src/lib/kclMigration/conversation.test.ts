import assert from 'node:assert/strict'
import { once } from 'node:events'
import {
  MigrationConversation,
  migrationHistoryPosition,
} from '@src/lib/kclMigration/conversation'
import type {
  MigrationClientMessage,
  MigrationHistoryEntry,
  MigrationServerMessage,
} from '@src/lib/kclMigration/protocol'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'

let server: WebSocketServer
let history: MigrationConversation
let messages: MigrationClientMessage[]
let respond: (message: MigrationClientMessage, socket: WebSocket) => void
const conversationId = 'prior-conversation'
const entry: MigrationHistoryEntry = {
  operation_id: 'operation',
  conversation_id: conversationId,
  created_at: '2026-10-02T12:00:00Z',
  status: 'succeeded',
  detail: 'Conversion passed.',
  application: { status: 'not_applied', revision: 0 },
}
const send = (socket: WebSocket, message: MigrationServerMessage) =>
  socket.send(JSON.stringify(message))

beforeEach(async () => {
  server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  vi.stubEnv('VITE_ZOO_API_BASE_URL', `http://127.0.0.1:${address.port}`)
  messages = []
  respond = () => undefined
  server.on('connection', (socket) =>
    socket.on('message', (data) => {
      const message: MigrationClientMessage = JSON.parse(data.toString())
      if (message.type === 'headers') return
      messages.push(message)
      respond(message, socket)
    })
  )
  history = new MigrationConversation(() => 'test-token')
})
afterEach(async () => {
  history.reset()
  for (const socket of server.clients) socket.terminate()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  vi.unstubAllEnvs()
})

it('loads read-only history in one request and anchors entries to the prior prompt', async () => {
  respond = (message, socket) => {
    assert.equal(message.type, 'history')
    if (message.type !== 'history') return
    send(socket, {
      type: 'history',
      conversation_id: conversationId,
      entries: [
        entry,
        {
          ...entry,
          operation_id: 'older',
          created_at: '2026-10-01T12:00:00Z',
        },
      ],
    })
  }
  history.select(conversationId)
  await vi.waitFor(() => expect(history.entries.value).toHaveLength(2))
  expect(messages).toEqual([
    { type: 'history', conversation_id: conversationId },
  ])
  expect(history.entries.value[0].operation_id).toBe('older')
  expect(history.entries.value[1].application.status).toBe('not_applied')
  const exchanges = [
    {
      responses: [{ end_of_stream: { id: 'prompt-1' } }],
      deltasAggregated: '',
    },
    {
      responses: [{ end_of_stream: { id: 'prompt-2' } }],
      deltasAggregated: '',
    },
  ]
  expect(
    migrationHistoryPosition(
      { ...entry, after_prompt_id: 'prompt-1' },
      exchanges
    )
  ).toBe(1)
  expect(migrationHistoryPosition(entry, exchanges)).toBe(0)
  expect(
    migrationHistoryPosition(
      { ...entry, after_prompt_id: 'prompt-1', prompt_id: 'prompt-2' },
      exchanges
    )
  ).toBe(2)
  expect(
    migrationHistoryPosition({ ...entry, after_prompt_id: 'pruned' }, exchanges)
  ).toBe(2)
})

it('retries an ambiguous Apply with the same revision before reporting Undo', async () => {
  let first = true
  respond = (message, socket) => {
    assert.equal(message.type, 'application')
    if (message.type !== 'application') return
    if (first) {
      first = false
      socket.terminate()
      return
    }
    send(socket, {
      type: 'application',
      operation_id: message.operation_id,
      application: {
        status: message.status,
        revision: message.expected_revision + 1,
      },
    })
  }
  const link = history.link(conversationId)
  link.reportApplication(entry.operation_id, 'applied')
  await vi.waitFor(() => expect(history.applicationError.value).not.toBe(''))
  link.reportApplication(entry.operation_id, 'undone')
  expect(messages).toHaveLength(1)
  history.retryApplications()
  await vi.waitFor(() => expect(messages).toHaveLength(3))
  expect(messages).toEqual([
    {
      type: 'application',
      operation_id: entry.operation_id,
      status: 'applied',
      expected_revision: 0,
    },
    {
      type: 'application',
      operation_id: entry.operation_id,
      status: 'applied',
      expected_revision: 0,
    },
    {
      type: 'application',
      operation_id: entry.operation_id,
      status: 'undone',
      expected_revision: 1,
    },
  ])
  await vi.waitFor(() => expect(history.applicationError.value).toBe(''))
})

it('rejects another conversation and drops late results on a conversation switch', async () => {
  let oldSocket: WebSocket | undefined
  respond = (message, socket) => {
    if (message.type !== 'history') return
    if (message.conversation_id === conversationId) oldSocket = socket
    else
      send(socket, {
        type: 'history',
        conversation_id: message.conversation_id,
        entries: [{ ...entry, conversation_id: message.conversation_id }],
      })
  }
  history.select(conversationId)
  await vi.waitFor(() => expect(oldSocket).toBeDefined())
  history.select('new-conversation')
  await vi.waitFor(() =>
    expect(history.entries.value[0]?.conversation_id).toBe('new-conversation')
  )
  if (oldSocket)
    send(oldSocket, {
      type: 'history',
      conversation_id: conversationId,
      entries: [entry],
    })
  expect(
    history.entries.value.every(
      (item) => item.conversation_id === 'new-conversation'
    )
  ).toBe(true)
  respond = (_, socket) =>
    send(socket, {
      type: 'history',
      conversation_id: conversationId,
      entries: [entry],
    })
  await history.refresh()
  expect(history.error.value).toContain('different request')
  expect(history.entries.value[0].conversation_id).toBe('new-conversation')
})

it('does not replay acknowledgements into another account or project after reset', () => {
  const previous = history.link(conversationId)
  history.reset()
  previous.reportApplication(entry.operation_id, 'undone')
  expect(messages).toEqual([])
  expect(history.entries.value).toEqual([])
})

it('refreshes model replay only after the selected conversation acknowledgement is saved', async () => {
  let saved = entry.application
  respond = (message, socket) => {
    if (message.type === 'history')
      send(socket, {
        type: 'history',
        conversation_id: conversationId,
        entries: [{ ...entry, application: saved }],
      })
    if (message.type === 'application') {
      saved = {
        status: message.status,
        revision: message.expected_revision + 1,
      }
      send(socket, {
        type: 'application',
        operation_id: message.operation_id,
        application: {
          status: message.status,
          revision: message.expected_revision + 1,
        },
      })
    }
  }
  history.select(conversationId)
  await vi.waitFor(() => expect(history.entries.value).toHaveLength(1))
  const link = history.link(conversationId)
  link.completed()
  expect(history.replayRevision.value).toBe(1)
  link.reportApplication(entry.operation_id, 'applied')
  expect(history.reportingApplication.value).toBe(true)
  await vi.waitFor(() => expect(history.replayRevision.value).toBe(2))
  expect(history.reportingApplication.value).toBe(false)
  link.reportApplication(entry.operation_id, 'undone')
  await vi.waitFor(() => expect(history.replayRevision.value).toBe(3))
  await vi.waitFor(() =>
    expect(history.entries.value[0].application.status).toBe('undone')
  )
})
