import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installEngineCassette,
  replaySession,
} from '@e2e/playwright/lib/engine-cassette'
import type { Page, TestInfo } from '@playwright/test'
import { expect, it, vi } from 'vitest'

const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'
const frame = (from: 'engine' | 'client', value: object) => ({
  from,
  wire: JSON.stringify(value),
})

it('rejects a selection of a different entity supplied by the engine', () => {
  const reply = vi.fn()
  const session = replaySession(
    [
      frame('engine', { entities: [a, b] }),
      frame('client', { cmd: { type: 'select_add', entity_id: a } }),
      frame('engine', { selection: [a] }),
    ],
    reply
  )
  expect(() =>
    session.receive(
      frame('client', { cmd: { type: 'select_add', entity_id: b } })
    )
  ).toThrow('Engine cassette mismatch')
  expect(reply).toHaveBeenCalledTimes(1)
})

it('moves only the plane visibility exchange across selection', () => {
  const makePlane = frame('client', {
    type: 'modeling_cmd_batch_req',
    batch_id: b,
    requests: [{ cmd_id: a, cmd: { type: 'make_plane' } }],
  })
  const hidePlane = frame('client', {
    type: 'modeling_cmd_batch_req',
    batch_id: a,
    requests: [{ cmd: { type: 'object_visible', object_id: a } }],
  })
  const hideReply = frame('engine', {
    success: true,
    request_id: a,
    resp: { type: 'modeling_batch' },
  })
  const select = frame('client', { cmd: { type: 'select_clear' } })
  const selectReply = frame('engine', { selected: [] })
  const next = frame('client', { cmd: { type: 'begin_execution' } })
  const frames = [makePlane, hidePlane, hideReply, select, selectReply, next]
  const send = vi.fn()
  const session = replaySession(frames, send)
  session.receive(makePlane)
  session.receive(select)
  expect(send.mock.calls).toEqual([[selectReply.wire]])
  session.receive(hidePlane)
  session.receive(next)
  expect(send.mock.calls).toEqual([[selectReply.wire], [hideReply.wire]])
  expect(session.complete()).toBe(true)

  const missingBatch = replaySession(frames, vi.fn())
  missingBatch.receive(makePlane)
  missingBatch.receive(select)
  expect(() => missingBatch.receive(next)).toThrow(
    'Missing plane visibility batch'
  )
})

it('skips verification for a tagged test with no fresh recording on the shard', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zds-cassette-test-'))
  const routeWebSocket = vi.fn()
  const skipped = new Error('Playwright skip')
  const skip = vi.fn(() => {
    throw skipped
  })
  vi.stubEnv('ZDS_VCR_DIR', directory)
  vi.stubEnv('ZDS_VCR_VERIFY', '1')
  vi.stubEnv('ZDS_VCR_LIVE', '0')
  try {
    await expect(
      installEngineCassette(
        { routeWebSocket } as unknown as Page,
        {
          tags: ['@vcr', '@localRenderer'],
          repeatEachIndex: 0,
          project: { name: 'chrome', testDir: directory },
          file: join(directory, 'sample.spec.ts'),
          titlePath: ['sample'],
          skip,
        } as unknown as TestInfo
      )
    ).rejects.toBe(skipped)
    expect(skip).toHaveBeenCalledWith(
      true,
      'This test did not produce a fresh cassette on this shard'
    )
    expect(routeWebSocket).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true })
  }
})

it('replays startup with or without an empty selection sync', () => {
  const begin = frame('client', {
    cmd: { type: 'begin_execution', enable_render: true },
  })
  const end = frame('client', { cmd: { type: 'end_execution' } })
  const selectGet = frame('client', {
    type: 'modeling_cmd_req',
    cmd_id: a,
    cmd: { type: 'select_get' },
  })
  const emptyReply = frame('engine', {
    success: true,
    request_id: a,
    resp: {
      type: 'modeling',
      data: {
        modeling_response: { type: 'select_get', data: { entity_ids: [] } },
      },
    },
  })

  const skip = replaySession(
    [begin, end, selectGet, emptyReply, begin],
    vi.fn()
  )
  for (const request of [begin, end, begin]) {
    skip.receive(request)
  }
  expect(skip.complete()).toBe(true)

  const send = vi.fn()
  const insert = replaySession([begin, end, begin], send)
  for (const request of [begin, end, selectGet, begin]) {
    insert.receive(request)
  }
  expect(JSON.parse(send.mock.calls[0][0])).toEqual(JSON.parse(emptyReply.wire))
  expect(insert.complete()).toBe(true)

  const strict = replaySession([begin, end, begin], vi.fn())
  strict.receive(begin)
  strict.receive(end)
  const selectEntity = frame('client', {
    type: 'modeling_cmd_req',
    cmd_id: a,
    cmd: { type: 'select_add', entities: [b] },
  })
  expect(() => strict.receive(selectEntity)).toThrow(
    'expected begin_execution, received select_add'
  )

  const afterStartup = replaySession([begin, end, begin], vi.fn())
  for (const request of [begin, end, begin]) {
    afterStartup.receive(request)
  }
  expect(() => afterStartup.receive(selectGet)).toThrow(
    'Unexpected engine command'
  )
})
