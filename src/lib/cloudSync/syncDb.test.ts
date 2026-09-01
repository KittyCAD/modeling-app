import 'fake-indexeddb/auto'
import {
  appendOutboxEntry,
  clearLegacyConflictCopyReferences,
  clearOutboxEntriesTouchingProject,
  getAllOutboxEntries,
  getCloudSyncProjectMetadataIndex,
  getProjectMetadata,
  putProjectMetadata,
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

  it('keeps existing project upload work when a duplicate upsert is registered', async () => {
    await appendOutboxEntry({
      projectPath: '/projects/bracket',
      kind: 'upsert',
      targetPath: '/projects/bracket/main.kcl',
      createdAt: '2026-07-28T12:00:00.000Z',
    })
    await appendOutboxEntry({
      projectPath: '/projects/bracket',
      kind: 'upsert',
      targetPath: '/projects/bracket',
      createdAt: '2026-07-28T12:01:00.000Z',
    })

    await expect(getAllOutboxEntries()).resolves.toMatchObject([
      {
        projectPath: '/projects/bracket',
        kind: 'upsert',
        targetPath: '/projects/bracket/main.kcl',
        createdAt: '2026-07-28T12:00:00.000Z',
      },
    ])
  })

  it('coalesces explicit file deletions without losing their paths', async () => {
    await appendOutboxEntry({
      projectPath: '/projects/bracket',
      kind: 'upsert',
      targetPath: '/projects/bracket/first.kcl',
      deletedPaths: ['first.kcl'],
      createdAt: '2026-08-24T12:00:00.000Z',
    })
    await appendOutboxEntry({
      projectPath: '/projects/bracket',
      kind: 'upsert',
      targetPath: '/projects/bracket/second.kcl',
      deletedPaths: ['second.kcl'],
      createdAt: '2026-08-24T12:01:00.000Z',
    })

    await expect(getAllOutboxEntries()).resolves.toMatchObject([
      {
        projectPath: '/projects/bracket',
        kind: 'upsert',
        deletedPaths: ['first.kcl', 'second.kcl'],
      },
    ])
  })

  it('exposes the oldest durable pending time in the project metadata index', async () => {
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: '/projects/bracket',
      projectName: 'bracket',
    })
    await appendOutboxEntry({
      projectPath: '/projects/bracket',
      kind: 'upsert',
      targetPath: '/projects/bracket/main.kcl',
      createdAt: '2026-08-24T12:00:00.000Z',
    })
    await appendOutboxEntry({
      projectPath: '/projects/bracket',
      kind: 'upsert',
      targetPath: '/projects/bracket/other.kcl',
      createdAt: '2026-08-24T12:01:00.000Z',
    })

    const metadata = (await getCloudSyncProjectMetadataIndex()).get(
      '/projects/bracket'
    )
    expect(metadata).toMatchObject({
      hasPendingChanges: true,
      pendingSince: '2026-08-24T12:00:00.000Z',
    })
  })

  it('keeps project delete work when a later upsert is registered for the tombstoned project', async () => {
    await appendOutboxEntry({
      projectPath: '/projects/bracket',
      kind: 'delete',
      targetPath: '/projects/bracket',
      createdAt: '2026-07-28T12:00:00.000Z',
    })
    await appendOutboxEntry({
      projectPath: '/projects/bracket',
      kind: 'upsert',
      targetPath: '/projects/bracket/main.kcl',
      createdAt: '2026-07-28T12:01:00.000Z',
    })

    await expect(getAllOutboxEntries()).resolves.toMatchObject([
      {
        projectPath: '/projects/bracket',
        kind: 'delete',
        targetPath: '/projects/bracket',
        createdAt: '2026-07-28T12:00:00.000Z',
      },
    ])
  })

  it('clears queued work that touches a deleted project root', async () => {
    const conflictCopyPath =
      '/projects/bracket (cloud conflict 20260807T173344)'

    await appendOutboxEntry({
      projectPath: conflictCopyPath,
      kind: 'upsert',
      targetPath: `${conflictCopyPath}/main.kcl`,
      createdAt: '2026-08-07T17:33:44.000Z',
    })
    await appendOutboxEntry({
      projectPath: '/projects/bracket-restored',
      kind: 'upsert',
      targetPath: '/projects/bracket-restored',
      sourcePath: conflictCopyPath,
      createdAt: '2026-08-07T17:34:44.000Z',
    })
    await appendOutboxEntry({
      projectPath: '/projects/manual-fix',
      kind: 'upsert',
      targetPath: `${conflictCopyPath}/notes.txt`,
      createdAt: '2026-08-07T17:35:44.000Z',
    })
    await appendOutboxEntry({
      projectPath: '/projects/bracket (cloud conflict 20260807T173344)-copy',
      kind: 'upsert',
      targetPath:
        '/projects/bracket (cloud conflict 20260807T173344)-copy/main.kcl',
      createdAt: '2026-08-07T17:36:44.000Z',
    })

    await clearOutboxEntriesTouchingProject(conflictCopyPath)

    const remainingEntries = await getAllOutboxEntries()
    expect(remainingEntries).toHaveLength(1)
    expect(remainingEntries).toMatchObject([
      {
        projectPath: '/projects/bracket (cloud conflict 20260807T173344)-copy',
        kind: 'upsert',
        targetPath:
          '/projects/bracket (cloud conflict 20260807T173344)-copy/main.kcl',
      },
    ])
  })

  it('removes stale legacy conflict-copy paths from source project metadata', async () => {
    const conflictCopyPath =
      '/projects/bracket (cloud conflict 20260807T173344)'

    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: '/projects/bracket',
      projectName: 'bracket',
      remoteProjectId: 'remote-123',
      conflict: {
        remoteRevision: 'rev-2',
        remoteUpdatedAt: '2026-08-07T17:33:44.000Z',
        createdAt: '2026-08-07T17:33:44.000Z',
        conflictProjectPath: conflictCopyPath,
      },
      lastFailure: {
        message: 'Cloud sync conflict: local and remote both changed.',
        at: '2026-08-07T17:33:44.000Z',
      },
    })
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: '/projects/other',
      projectName: 'other',
      remoteProjectId: 'remote-456',
      conflict: {
        remoteRevision: 'rev-4',
        remoteUpdatedAt: '2026-08-07T17:30:44.000Z',
        createdAt: '2026-08-07T17:30:44.000Z',
        conflictProjectPath: '/projects/other (cloud conflict 20260807T173044)',
      },
    })

    await clearLegacyConflictCopyReferences(conflictCopyPath)

    await expect(
      getProjectMetadata('/projects/bracket')
    ).resolves.toMatchObject({
      localProjectPath: '/projects/bracket',
      conflict: {
        remoteRevision: 'rev-2',
        remoteUpdatedAt: '2026-08-07T17:33:44.000Z',
        createdAt: '2026-08-07T17:33:44.000Z',
      },
      lastFailure: {
        message: 'Cloud sync conflict: local and remote both changed.',
      },
    })
    expect(
      (await getProjectMetadata('/projects/bracket'))?.conflict
    ).not.toHaveProperty('conflictProjectPath')
    await expect(getProjectMetadata('/projects/other')).resolves.toMatchObject({
      conflict: {
        conflictProjectPath: '/projects/other (cloud conflict 20260807T173044)',
      },
    })
  })
})
