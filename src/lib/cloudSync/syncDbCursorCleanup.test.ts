import {
  appendOutboxEntry,
  clearLegacyConflictCopyReferences,
  clearOutboxEntriesForProject,
  clearOutboxEntriesForProjectAtGeneration,
  clearOutboxEntriesTouchingProject,
} from '@src/lib/cloudSync/syncDb'
import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const metadata = {
  schemaVersion: 1 as const,
  localProjectPath: '/projects/bracket',
  projectName: 'bracket',
}

describe('cloud sync transaction outcomes', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    [
      'append outbox',
      () =>
        appendOutboxEntry({
          projectPath: metadata.localProjectPath,
          kind: 'upsert',
          targetPath: `${metadata.localProjectPath}/main.kcl`,
          createdAt: '2026-10-06T00:00:00.000Z',
        }),
    ],
    [
      'clear project',
      () => clearOutboxEntriesForProject(metadata.localProjectPath),
    ],
    [
      'clear generation',
      () =>
        clearOutboxEntriesForProjectAtGeneration(metadata.localProjectPath, 0),
    ],
    [
      'clear touching project',
      () => clearOutboxEntriesTouchingProject(metadata.localProjectPath),
    ],
    [
      'clear conflict references',
      () => clearLegacyConflictCopyReferences(metadata.localProjectPath),
    ],
  ] as const)(
    'closes the database after an aborted %s transaction',
    async (_, run) => {
      const close = vi.spyOn(IDBDatabase.prototype, 'close')
      // The replacement calls the original method with its object-store receiver.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const openCursor = IDBObjectStore.prototype.openCursor
      vi.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(
        function (
          this: IDBObjectStore,
          ...args: Parameters<typeof openCursor>
        ) {
          const request = openCursor.apply(this, args)
          request.addEventListener('success', () => this.transaction.abort(), {
            once: true,
          })
          return request
        }
      )

      await expect(run()).rejects.toBeInstanceOf(Error)
      expect(close).toHaveBeenCalledOnce()
    }
  )
})
