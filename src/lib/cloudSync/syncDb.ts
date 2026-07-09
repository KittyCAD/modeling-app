import { normalizePathForSync } from '@src/lib/cloudSync/paths'
import type {
  CloudSyncProjectMetadataIndexEntry,
  OutboxEntry,
  ProjectMetadata,
} from '@src/lib/cloudSync/types'

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
