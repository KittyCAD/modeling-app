import 'fake-indexeddb/auto'
import {
  appendOutboxEntry,
  getAllOutboxEntries,
} from '@src/lib/cloudSync/syncDb'
import { deleteCloudSyncTestDatabase } from '@src/lib/cloudSync/testUtils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('cloud sync outbox persistence', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
  })

  afterEach(async () => {
    await deleteCloudSyncTestDatabase()
  })

  it('coalesces queued work for the same project to the latest entry', async () => {
    await appendOutboxEntry({
      projectPath: '/projects/bracket',
      kind: 'upsert',
      targetPath: '/projects/bracket/main.kcl',
      createdAt: '2026-07-28T12:00:00.000Z',
    })
    await appendOutboxEntry({
      projectPath: '/projects/bracket',
      kind: 'delete',
      targetPath: '/projects/bracket',
      createdAt: '2026-07-28T12:01:00.000Z',
    })
    await appendOutboxEntry({
      projectPath: '/projects/other',
      kind: 'upsert',
      targetPath: '/projects/other/main.kcl',
      createdAt: '2026-07-28T12:02:00.000Z',
    })

    await expect(getAllOutboxEntries()).resolves.toMatchObject([
      {
        projectPath: '/projects/bracket',
        kind: 'delete',
        targetPath: '/projects/bracket',
        createdAt: '2026-07-28T12:01:00.000Z',
      },
      {
        projectPath: '/projects/other',
        kind: 'upsert',
        targetPath: '/projects/other/main.kcl',
        createdAt: '2026-07-28T12:02:00.000Z',
      },
    ])
  })
})
