import { Buffer } from 'node:buffer'
import type { MlCopilotClientMessage } from '@kittycad/lib'
import { encode } from '@msgpack/msgpack'
import { zookeeperFixtureReply } from '@e2e/performance/zookeeper-protocol'
import { expect, test } from 'vitest'

const infoText = 'Performance audit streamed info'
const request: Extract<MlCopilotClientMessage, { type: 'user' }> = {
  type: 'user',
  content: 'Show an informational status',
  project_name: 'interaction-performance',
  active_file: 'main.kcl',
  current_files: {
    'main.kcl': Array.from(
      new TextEncoder().encode('@settings(kclVersion = 3.0)\nlength = 10mm\n')
    ),
  },
}

test('replies to the JSON authentication header with the existing conversation', () => {
  const headers: Extract<MlCopilotClientMessage, { type: 'headers' }> = {
    type: 'headers',
    headers: { Authorization: 'Bearer fixture-token' },
  }
  expect(zookeeperFixtureReply(JSON.stringify(headers), infoText)).toEqual({
    conversation_id: {
      conversation_id: '00000000-0000-4000-8000-000000000001',
    },
  })
})

test('retains the JSON user request response', () => {
  expect(zookeeperFixtureReply(JSON.stringify(request), infoText)).toEqual({
    info: { text: infoText },
  })
})

test('replies to the binary MessagePack user request carrying project files', () => {
  // Production MessageSend uses this encoder/options; Playwright supplies its
  // binary WebSocket messages as Node Buffers, not JSON strings.
  const message = Buffer.from(encode(request, { ignoreUndefined: true }))
  expect(zookeeperFixtureReply(message, infoText)).toEqual({
    info: { text: infoText },
  })
})

test('does not manufacture a response to an unrelated heartbeat', () => {
  const ping: Extract<MlCopilotClientMessage, { type: 'ping' }> = {
    type: 'ping',
  }
  expect(zookeeperFixtureReply(JSON.stringify(ping), infoText)).toBeUndefined()
})
