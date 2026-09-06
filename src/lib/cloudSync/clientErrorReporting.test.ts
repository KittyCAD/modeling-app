import type * as ClientErrorsModule from '@src/lib/clientErrors'
import { CloudApiError } from '@src/lib/cloudSync/cloudApi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reportClientError: vi.fn<typeof ClientErrorsModule.reportClientError>(
    async () => undefined
  ),
  reportRejection: vi.fn(),
}))

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: {
    CloudSyncConflict: 'cloud_sync_conflict',
    CloudSyncConflictCopyDetected: 'cloud_sync_conflict_copy_detected',
    CloudSyncFailure: 'cloud_sync_failure',
    CloudSyncUntrackedLocalChanges: 'cloud_sync_untracked_local_changes',
  },
  reportClientError: mocks.reportClientError,
}))

vi.mock('@src/lib/trap', () => ({
  reportRejection: mocks.reportRejection,
}))

import {
  reportCloudSyncConflict,
  reportCloudSyncConflictCopyDetected,
  reportCloudSyncFailure,
  reportCloudSyncUntrackedLocalChanges,
  setCloudSyncFailureContext,
} from '@src/lib/cloudSync/clientErrorReporting'

describe('cloud sync client error reporting', () => {
  beforeEach(() => {
    mocks.reportClientError.mockReset()
    mocks.reportClientError.mockResolvedValue(undefined)
    mocks.reportRejection.mockClear()
  })

  it('reports conflicts with privacy-safe project fingerprints', () => {
    reportCloudSyncConflict({
      localProjectPath: '/Users/someone/Projects/secret-project',
      remoteProjectId: 'remote-123',
      syncBaseRemoteRevision: 'rev-1',
      conflictRemoteRevision: 'rev-2',
      conflictRemoteUpdatedAt: '2026-07-17T12:00:00.000Z',
      existingConflictCreatedAt: '2026-07-17T11:58:30.000Z',
      reportedAt: '2026-07-17T12:00:00.000Z',
      baseManifest: {
        files: {
          'main.kcl': { byteSize: 10, sha256: 'base-main' },
          'notes.txt': { byteSize: 5, sha256: 'same' },
        },
      },
      localManifest: {
        files: {
          'main.kcl': { byteSize: 11, sha256: 'local-main' },
          'notes.txt': { byteSize: 5, sha256: 'same' },
        },
      },
      remoteManifest: {
        files: {
          'main.kcl': { byteSize: 12, sha256: 'remote-main' },
          'notes.txt': { byteSize: 5, sha256: 'same' },
          'remote-only.kcl': { byteSize: 8, sha256: 'remote-only' },
        },
      },
    })

    expect(mocks.reportClientError).toHaveBeenCalledWith({
      code: 'cloud_sync_conflict',
      errorName: 'CloudSyncConflict',
      message: 'Cloud sync conflict: local and remote both changed.',
      route: '/cloud-sync',
      dedupeKey: expect.stringMatching(
        /^CloudSync:conflict:remote-project-id:remote-123:rev-1:rev-2:/
      ),
      extra: expect.objectContaining({
        source: 'CloudSyncEngine',
        operation: 'reconcile-project',
        clientInstanceId: expect.any(String),
        projectIdentityKind: 'remote-project-id',
        projectIdentity: 'remote-123',
        remoteProjectId: 'remote-123',
        localProjectPathHash: expect.any(String),
        syncBaseRemoteRevision: 'rev-1',
        conflictRemoteRevision: 'rev-2',
        conflictRemoteUpdatedAt: '2026-07-17T12:00:00.000Z',
        conflictAlreadyRecorded: true,
        existingConflictAgeMs: 90_000,
        baseManifestFingerprint: expect.any(String),
        localManifestFingerprint: expect.any(String),
        remoteManifestFingerprint: expect.any(String),
        baseManifestFileCount: 2,
        localManifestFileCount: 2,
        remoteManifestFileCount: 3,
        localChangedFileCount: 1,
        remoteChangedFileCount: 2,
        overlappingChangedFileCount: 1,
        divergentChangedFileCount: 1,
      }),
    })
    expect(JSON.stringify(mocks.reportClientError.mock.calls)).not.toContain(
      '/Users/someone'
    )
    expect(JSON.stringify(mocks.reportClientError.mock.calls)).not.toContain(
      'secret-project'
    )
  })

  it('reports legacy conflict-copy detections without project details', () => {
    reportCloudSyncConflictCopyDetected()

    expect(mocks.reportClientError).toHaveBeenCalledWith({
      code: 'cloud_sync_conflict_copy_detected',
      errorName: 'CloudSyncConflictCopyDetected',
      message: 'Cloud sync "conflict copy" folder detected',
      route: '/cloud-sync',
      extra: {
        source: 'CloudSyncEngine',
        operation: 'reconcile-project',
      },
    })
  })

  it('reports recovery of local changes that were missing queued work', () => {
    reportCloudSyncUntrackedLocalChanges({
      remoteProjectId: 'remote-123',
      remoteRevision: 'rev-1',
      baseFileCount: 4,
      localFileCount: 5,
    })

    expect(mocks.reportClientError).toHaveBeenCalledWith({
      code: 'cloud_sync_untracked_local_changes',
      errorName: 'CloudSyncUntrackedLocalChanges',
      message: 'Cloud sync detected local changes without queued work.',
      route: '/cloud-sync',
      dedupeKey: 'CloudSync:untracked-local-changes:remote-123:rev-1',
      extra: {
        source: 'CloudSyncEngine',
        operation: 'reconcile-project',
        remoteProjectId: 'remote-123',
        remoteRevision: 'rev-1',
        baseFileCount: 4,
        localFileCount: 5,
        recoveryAction: 'sync-project',
      },
    })
  })

  it('reports privacy-safe failure categories', () => {
    const firstError = new Error('ENOENT: /projects/one/main.kcl')
    firstError.name = '/projects/private-error-name'
    reportCloudSyncFailure('sync', firstError)
    reportCloudSyncFailure('sync', new Error('ENOENT: /projects/two/main.kcl'))
    reportCloudSyncFailure(
      'sync',
      Object.assign(new Error('Forbidden'), {
        kind: 'remote-upload-forbidden',
      })
    )
    reportCloudSyncFailure(
      'remote-index',
      new Error('Remote index failed', {
        cause: new CloudApiError(503, 'Remote index is unavailable'),
      })
    )

    const [first, second, third, fourth] =
      mocks.reportClientError.mock.calls.map(([report]) => report)
    expect(first.dedupeKey).toBe('CloudSync:failure:sync:Error:none:unknown')
    expect(second.dedupeKey).toBe(first.dedupeKey)
    expect(third).toMatchObject({
      dedupeKey: 'CloudSync:failure:sync:Error:none:remote-upload-forbidden',
      extra: {
        operation: 'sync',
        errorType: 'Error',
        failureKind: 'remote-upload-forbidden',
      },
    })
    expect(fourth).toMatchObject({
      code: 'cloud_sync_failure',
      dedupeKey: 'CloudSync:failure:remote-index:CloudApiError:503:unknown',
      extra: {
        operation: 'remote-index',
        errorType: 'CloudApiError',
        cloudApiStatus: 503,
      },
    })
    expect(fourth.dedupeKey).not.toBe(first.dedupeKey)
    expect(JSON.stringify([first, second, third, fourth])).not.toContain(
      '/projects/'
    )
    expect(JSON.stringify([first, second, third, fourth])).not.toContain(
      'Remote index is unavailable'
    )
  })

  it('reports aggregate project failure context without filesystem details', () => {
    const remoteProjectId = '123e4567-e89b-42d3-a456-426614174000'
    const entries = [
      {
        id: 1,
        projectPath: '/Users/someone/Projects/secret-project',
        kind: 'upsert' as const,
        targetPath:
          '/Users/someone/Projects/secret-project/private/obsolete.kcl',
        sourcePath:
          '/Users/someone/Projects/secret-project/private/original.kcl',
        deletedPaths: ['private/obsolete.kcl', 'private/obsolete.kcl'],
        createdAt: '2026-07-17T12:00:00.000Z',
      },
      {
        id: 2,
        projectPath: '/Users/someone/Projects/secret-project',
        kind: 'delete' as const,
        targetPath: '/Users/someone/Projects/secret-project',
        createdAt: '2026-07-17T12:01:00.000Z',
      },
    ]
    const context = {
      remoteProjectId,
      syncBaseRemoteRevision: 'rev-1',
      observedRemoteRevision: 'rev-1',
      baseManifest: {
        files: {
          'main.kcl': { byteSize: 10, sha256: 'main' },
          'private/obsolete.kcl': { byteSize: 12, sha256: 'obsolete' },
        },
      },
      localManifest: {
        files: {
          'main.kcl': { byteSize: 10, sha256: 'main' },
        },
      },
      attemptOutboxEntries: entries,
      currentOutboxEntries: entries,
      replacementUploadFileCount: 1,
      replacementUploadDeletedPathCount: 1,
    }
    const error = new CloudApiError(409, 'Deletion intent mismatch')
    expect(setCloudSyncFailureContext(error, context)).toBe(error)

    reportCloudSyncFailure(
      'sync',
      new Error('Remote index failed', { cause: error })
    )

    const report = mocks.reportClientError.mock.calls.at(-1)?.[0]
    expect(report).toMatchObject({
      code: 'cloud_sync_failure',
      extra: {
        operation: 'sync',
        errorType: 'CloudApiError',
        cloudApiStatus: 409,
        remoteProjectId,
        syncBaseRemoteRevisionPresent: true,
        observedRemoteRevisionPresent: true,
        remoteRevisionsMatch: true,
        baseManifestFileCount: 2,
        localManifestFileCount: 1,
        replacementUploadFileCount: 1,
        replacementUploadDeletedPathCount: 1,
        replacementUploadIncludedDeletedPaths: true,
        attemptOutbox: {
          readSucceeded: true,
          entryCount: 2,
          upsertEntryCount: 1,
          deleteEntryCount: 1,
          entriesWithSourcePathCount: 1,
          entriesWithDeletedPathsCount: 1,
          declaredDeletedPathCount: 2,
          distinctDeletedPathCount: 1,
          invalidEntryCount: 0,
          invalidDeletedPathValueCount: 0,
          oldestEntryAgeBucket: expect.any(String),
        },
        currentOutbox: {
          readSucceeded: true,
          entryCount: 2,
          declaredDeletedPathCount: 2,
        },
      },
    })
    const sameShapeError = new CloudApiError(409, 'Deletion intent mismatch')
    setCloudSyncFailureContext(sameShapeError, context)
    reportCloudSyncFailure('sync', sameShapeError)
    const sameShapeReport = mocks.reportClientError.mock.calls.at(-1)?.[0]
    expect(sameShapeReport?.dedupeKey).toBe(report?.dedupeKey)

    const changedShapeError = new CloudApiError(409, 'Deletion intent mismatch')
    setCloudSyncFailureContext(changedShapeError, {
      ...context,
      replacementUploadDeletedPathCount: 0,
    })
    reportCloudSyncFailure('sync', changedShapeError)
    const changedShapeReport = mocks.reportClientError.mock.calls.at(-1)?.[0]
    expect(changedShapeReport?.dedupeKey).not.toBe(report?.dedupeKey)

    const serializedReports = JSON.stringify(mocks.reportClientError.mock.calls)
    expect(serializedReports).not.toContain('/Users/someone')
    expect(serializedReports).not.toContain('secret-project')
    expect(serializedReports).not.toContain('obsolete.kcl')
    expect(serializedReports).not.toContain('original.kcl')
  })

  it('handles malformed persisted context and primitive failures', () => {
    const malformedContext = {
      remoteProjectId: '/Users/someone/SecretProject',
      syncBaseRemoteRevision: '/Users/someone/base-revision',
      observedRemoteRevision: '/Users/someone/observed-revision',
      baseManifest: { files: null },
      attemptOutboxEntries: [
        {
          kind: 'upsert',
          deletedPaths: ['safe.kcl', null],
          createdAt: 'invalid',
        },
      ],
    } as unknown as Parameters<typeof setCloudSyncFailureContext>[1]

    const contextualError = setCloudSyncFailureContext(
      'filesystem rejected with a string',
      malformedContext
    )
    expect(contextualError).toBeInstanceOf(Error)
    expect(() => reportCloudSyncFailure('sync', contextualError)).not.toThrow()
    expect(mocks.reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        extra: expect.objectContaining({
          invalidRemoteProjectId: true,
          syncBaseRemoteRevisionPresent: true,
          observedRemoteRevisionPresent: true,
          remoteRevisionsMatch: false,
          attemptOutbox: expect.objectContaining({
            readSucceeded: true,
            entryCount: 1,
            invalidDeletedPathValueCount: 1,
          }),
          currentOutbox: { readSucceeded: false },
        }),
      })
    )
    const serializedReports = JSON.stringify(mocks.reportClientError.mock.calls)
    expect(serializedReports).not.toContain('safe.kcl')
    expect(serializedReports).not.toContain('/Users/someone')
    expect(serializedReports).not.toContain('base-revision')
  })

  it('does not propagate reporting failures', async () => {
    const rejection = new Error('Client error endpoint unavailable')
    mocks.reportClientError.mockRejectedValueOnce(rejection)

    expect(reportCloudSyncFailure('sync', new Error('Sync failed'))).toBe(
      undefined
    )
    await vi.waitFor(() => {
      expect(mocks.reportRejection).toHaveBeenCalledWith(rejection)
    })
  })
})
