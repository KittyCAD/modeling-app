import { normalizePathForSync } from '@src/lib/cloudSync/paths'
import type {
  CloudSyncProjectMetadataIndexEntry,
  OutboxEntry,
  ProjectMetadata,
} from '@src/lib/cloudSync/types'
import { webSafePathSplit } from '@src/lib/pathUtils'

const DB_NAME = 'zds-opfs-cloud-sync'
const DB_VERSION = 1
const PROJECTS_STORE = 'projects'
const OUTBOX_STORE = 'outbox'

function openSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable for cloud sync metadata.'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'localProjectPath' })
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        })
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | T
): Promise<T> {
  const db = await openSyncDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    let callbackResult: IDBRequest<T> | T

    transaction.oncomplete = () => {
      db.close()
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error)
    }

    try {
      callbackResult = callback(store)
    } catch (error) {
      transaction.abort()
      reject(error)
      return
    }

    if (
      callbackResult &&
      typeof callbackResult === 'object' &&
      'onsuccess' in callbackResult
    ) {
      callbackResult.onsuccess = () => resolve(callbackResult.result)
      callbackResult.onerror = () => reject(callbackResult.error)
      return
    }

    transaction.oncomplete = () => {
      db.close()
      resolve(callbackResult)
    }
  })
}

export async function getProjectMetadata(projectPath: string) {
  return withStore<ProjectMetadata | undefined>(
    PROJECTS_STORE,
    'readonly',
    (store) => store.get(normalizePathForSync(projectPath))
  )
}

export async function getCloudSyncProjectMetadata(projectPath: string) {
  return getProjectMetadata(normalizePathForSync(projectPath))
}

export async function getCloudSyncProjectMetadataIndex() {
  const [metadata, outboxEntries] = await Promise.all([
    getAllProjectMetadata(),
    getAllOutboxEntries(),
  ])
  const pendingProjectPaths = new Set(
    outboxEntries.map((entry) => normalizePathForSync(entry.projectPath))
  )

  return new Map<string, CloudSyncProjectMetadataIndexEntry>(
    metadata.map((entry) => [
      normalizePathForSync(entry.localProjectPath),
      {
        ...entry,
        hasPendingChanges:
          pendingProjectPaths.has(
            normalizePathForSync(entry.localProjectPath)
          ) || Boolean(entry.tombstone),
      },
    ])
  )
}

export async function putProjectMetadata(metadata: ProjectMetadata) {
  await withStore<IDBValidKey>(PROJECTS_STORE, 'readwrite', (store) =>
    store.put({
      ...metadata,
      localProjectPath: normalizePathForSync(metadata.localProjectPath),
    })
  )
}

export async function deleteProjectMetadata(projectPath: string) {
  await withStore<undefined>(PROJECTS_STORE, 'readwrite', (store) =>
    store.delete(normalizePathForSync(projectPath))
  )
}

export async function getAllProjectMetadata() {
  return withStore<ProjectMetadata[]>(PROJECTS_STORE, 'readonly', (store) =>
    store.getAll()
  )
}

export async function appendOutboxEntry(entry: Omit<OutboxEntry, 'id'>) {
  await withStore<IDBValidKey>(OUTBOX_STORE, 'readwrite', (store) =>
    store.add(entry)
  )
}

export async function getAllOutboxEntries() {
  return withStore<OutboxEntry[]>(OUTBOX_STORE, 'readonly', (store) =>
    store.getAll()
  )
}

export async function clearOutboxEntriesForProject(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const db = await openSyncDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OUTBOX_STORE, 'readwrite')
    const store = transaction.objectStore(OUTBOX_STORE)
    const request = store.openCursor()

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        return
      }
      const entry = cursor.value as OutboxEntry
      if (normalizePathForSync(entry.projectPath) === normalizedProjectPath) {
        cursor.delete()
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
  })
}

/**
 * Atomically retires every path-keyed sync record before a new local project
 * is published at the same path. A queued remote deletion is moved to a
 * hidden synthetic identity so replacing the local path cannot cancel it.
 */
export async function resetProjectSyncIdentity(
  projectPath: string,
  pendingDeletionProjectPath: string
) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const normalizedPendingDeletionPath = normalizePathForSync(
    pendingDeletionProjectPath
  )
  const db = await openSyncDb()

  return new Promise<boolean>((resolve, reject) => {
    const transaction = db.transaction(
      [PROJECTS_STORE, OUTBOX_STORE],
      'readwrite'
    )
    const projectsStore = transaction.objectStore(PROJECTS_STORE)
    const outboxStore = transaction.objectStore(OUTBOX_STORE)
    const metadataRequest = projectsStore.get(normalizedProjectPath)
    const outboxRequest = outboxStore.getAll()
    let metadata: ProjectMetadata | undefined
    let outboxEntries: OutboxEntry[] | undefined
    let metadataLoaded = false
    let preservedRemoteDeletion = false
    let updatesApplied = false

    const applyUpdates = () => {
      if (updatesApplied || !metadataLoaded || !outboxEntries) {
        return
      }
      updatesApplied = true

      const projectOutboxEntries = outboxEntries.filter(
        (entry) =>
          normalizePathForSync(entry.projectPath) === normalizedProjectPath
      )
      const latestEntry = projectOutboxEntries
        .toSorted((left, right) => (left.id ?? 0) - (right.id ?? 0))
        .at(-1)
      preservedRemoteDeletion = Boolean(
        metadata?.remoteProjectId &&
          (metadata.tombstone || latestEntry?.kind === 'delete')
      )

      if (metadata?.remoteProjectId && preservedRemoteDeletion) {
        projectsStore.put({
          schemaVersion: 1,
          localProjectPath: normalizedPendingDeletionPath,
          projectName:
            webSafePathSplit(normalizedPendingDeletionPath).at(-1) ?? '',
          remoteProjectId: metadata.remoteProjectId,
          remoteRevision: metadata.remoteRevision,
          remoteUpdatedAt: metadata.remoteUpdatedAt,
          tombstone: true,
        } satisfies ProjectMetadata)
        outboxStore.add({
          projectPath: normalizedPendingDeletionPath,
          kind: 'delete',
          targetPath: normalizedPendingDeletionPath,
          createdAt: latestEntry?.createdAt ?? new Date().toISOString(),
        } satisfies Omit<OutboxEntry, 'id'>)
      }

      for (const entry of projectOutboxEntries) {
        if (entry.id !== undefined) {
          outboxStore.delete(entry.id)
        }
      }
      projectsStore.delete(normalizedProjectPath)
    }

    metadataRequest.onsuccess = () => {
      metadata = metadataRequest.result as ProjectMetadata | undefined
      metadataLoaded = true
      applyUpdates()
    }
    outboxRequest.onsuccess = () => {
      outboxEntries = outboxRequest.result as OutboxEntry[]
      applyUpdates()
    }
    metadataRequest.onerror = () => reject(metadataRequest.error)
    outboxRequest.onerror = () => reject(outboxRequest.error)
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error)
    }
    transaction.oncomplete = () => {
      db.close()
      resolve(preservedRemoteDeletion)
    }
  })
}
