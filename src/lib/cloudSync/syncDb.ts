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
  const pendingSinceByProjectPath = new Map<string, string>()
  for (const entry of outboxEntries) {
    const projectPath = normalizePathForSync(entry.projectPath)
    const pendingSince = pendingSinceByProjectPath.get(projectPath)
    if (!pendingSince || entry.createdAt < pendingSince) {
      pendingSinceByProjectPath.set(projectPath, entry.createdAt)
    }
  }

  return new Map<string, CloudSyncProjectMetadataIndexEntry>(
    metadata.map((entry) => [
      normalizePathForSync(entry.localProjectPath),
      {
        ...entry,
        hasPendingChanges:
          pendingSinceByProjectPath.has(
            normalizePathForSync(entry.localProjectPath)
          ) || Boolean(entry.tombstone),
        pendingSince: pendingSinceByProjectPath.get(
          normalizePathForSync(entry.localProjectPath)
        ),
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
  const normalizedProjectPath = normalizePathForSync(entry.projectPath)
  const nextEntry = {
    ...entry,
    projectPath: normalizedProjectPath,
  }
  const db = await openSyncDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OUTBOX_STORE, 'readwrite')
    const store = transaction.objectStore(OUTBOX_STORE)
    const request = store.openCursor()
    const matchingDeleteEntryKeys: IDBValidKey[] = []
    const matchingUpsertEntries: Array<{
      key: IDBValidKey
      entry: OutboxEntry
    }> = []

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        if (nextEntry.kind === 'delete') {
          for (const key of [
            ...matchingDeleteEntryKeys,
            ...matchingUpsertEntries.map(({ key }) => key),
          ]) {
            store.delete(key)
          }
          store.add(nextEntry)
          return
        }

        const retainedDeleteEntryKey = matchingDeleteEntryKeys[0]
        if (retainedDeleteEntryKey !== undefined) {
          for (const key of [
            ...matchingDeleteEntryKeys.slice(1),
            ...matchingUpsertEntries.map(({ key }) => key),
          ]) {
            store.delete(key)
          }
          return
        }

        const retainedUpsertEntry = matchingUpsertEntries[0]
        if (retainedUpsertEntry !== undefined) {
          const deletedPaths = Array.from(
            new Set(
              [...matchingUpsertEntries.map(({ entry }) => entry), nextEntry]
                .flatMap((entry) => entry.deletedPaths ?? [])
                .map(normalizePathForSync)
            )
          ).sort()
          store.put({
            ...retainedUpsertEntry.entry,
            deletedPaths: deletedPaths.length ? deletedPaths : undefined,
          })
          for (const { key } of matchingUpsertEntries.slice(1)) {
            store.delete(key)
          }
          return
        }

        store.add(nextEntry)
        return
      }

      const existingEntry = cursor.value as OutboxEntry
      if (
        normalizePathForSync(existingEntry.projectPath) ===
        normalizedProjectPath
      ) {
        if (existingEntry.kind === 'delete') {
          matchingDeleteEntryKeys.push(cursor.primaryKey)
        } else {
          matchingUpsertEntries.push({
            key: cursor.primaryKey,
            entry: existingEntry,
          })
        }
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

export async function getAllOutboxEntries() {
  return withStore<OutboxEntry[]>(OUTBOX_STORE, 'readonly', (store) =>
    store.getAll()
  )
}

function pathTouchesProjectRoot(
  targetPath: string | undefined,
  projectRoot: string
) {
  if (!targetPath) {
    return false
  }

  const normalizedTargetPath = normalizePathForSync(targetPath)
  return (
    normalizedTargetPath === projectRoot ||
    normalizedTargetPath.startsWith(`${projectRoot}/`)
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

export async function clearOutboxEntriesTouchingProject(projectPath: string) {
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
      if (
        pathTouchesProjectRoot(entry.projectPath, normalizedProjectPath) ||
        pathTouchesProjectRoot(entry.targetPath, normalizedProjectPath) ||
        pathTouchesProjectRoot(entry.sourcePath, normalizedProjectPath)
      ) {
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

export async function clearLegacyConflictCopyReferences(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const db = await openSyncDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PROJECTS_STORE, 'readwrite')
    const store = transaction.objectStore(PROJECTS_STORE)
    const request = store.openCursor()

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        return
      }

      const metadata = cursor.value as ProjectMetadata
      if (
        pathTouchesProjectRoot(
          metadata.conflict?.conflictProjectPath,
          normalizedProjectPath
        )
      ) {
        const conflict = { ...metadata.conflict }
        delete conflict.conflictProjectPath
        cursor.update({
          ...metadata,
          conflict,
        })
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
