import 'fake-indexeddb/auto'
import {
  cloudSyncRemoteProjects,
  cloudSyncStatus,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  disconnectCloudSyncProject,
  ensureCloudProjectLocallySynced,
  getCloudSyncProjectMetadata,
  installCloudSyncFileSystemObserver,
  notifyCloudSyncRenameMutation,
  notifyCloudSyncWriteLikeMutation,
  resetCloudSyncProjectIdentityForRecovery,
  resolveCloudSyncProjectConflict,
  runCloudSyncProjectReadTransaction,
  runCloudSyncWriteTransaction,
  startCloudSyncProject,
} from '@src/lib/cloudSync'
import { INTERNAL_OPFS_META_FILE } from '@src/lib/cloudSync/paths'
import {
  appendOutboxEntry,
  getAllOutboxEntries,
  getAllProjectMetadata,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import {
  DUPLICATE_IN_PROGRESS_FILE_NAME,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import {
  createDuplicatePublicationEvidence,
  getDuplicateReservationFileName,
} from '@src/lib/fs-zds/duplicateReservations'
import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { webSafeJoin, webSafePathSplit } from '@src/lib/pathUtils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const syncDatabaseName = 'zds-opfs-cloud-sync'
const projectPath = '/documents/Projects/bracket'
const projectTomlPath = `${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`
const remoteProjectId = 'remote-project-123'
const remoteRevision = 'revision-123'
const remoteProjectUrl = `https://example.test/user/projects/${remoteProjectId}`
const duplicateToken = '12345678-1234-4123-8123-123456789abc'

function duplicatePublicationEvidence(targetName: string) {
  return createDuplicatePublicationEvidence({
    token: duplicateToken,
    targetName,
    createdAt: 1_752_000_000_000,
  })
}

function evidenceContents(contents: Uint8Array) {
  return new TextDecoder().decode(contents)
}

let deleteProjectFetch: typeof fetch = async () =>
  new Response(null, { status: 204 })

const fetchMock = vi.fn<typeof fetch>()

function normalizePath(path: string) {
  return path.replace(/\/+/g, '/')
}

function joinPaths(...parts: string[]) {
  return normalizePath(webSafeJoin(parts))
}

function dirname(path: string) {
  return webSafeJoin(webSafePathSplit(path).slice(0, -1)) || '/'
}

function basename(path: string) {
  return webSafePathSplit(path).at(-1) || ''
}

function getFetchUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

function getFetchMethod(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) {
  if (init?.method) {
    return init.method
  }
  if (typeof input === 'object' && 'method' in input) {
    return input.method
  }
  return 'GET'
}

async function deleteSyncDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(
      new Error('IndexedDB is unavailable in this test environment.')
    )
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`IndexedDB database ${syncDatabaseName} is blocked.`))
    }, 1000)
    const request = indexedDB.deleteDatabase(syncDatabaseName)
    request.onerror = () => {
      clearTimeout(timeout)
      reject(
        request.error ??
          new Error(`Failed to delete IndexedDB database ${syncDatabaseName}.`)
      )
    }
    request.onblocked = () => undefined
    request.onsuccess = () => {
      clearTimeout(timeout)
      resolve()
    }
  })
}

function installFetchMock() {
  deleteProjectFetch = async () => new Response(null, { status: 204 })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = getFetchUrl(input)
    const method = getFetchMethod(input, init)

    if (url === remoteProjectUrl && method === 'DELETE') {
      return deleteProjectFetch(input, init)
    }

    if (url === 'https://example.test/user/projects' && method === 'GET') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }

    return new Response(
      JSON.stringify({ message: `Unexpected fetch: ${method} ${url}` }),
      {
        status: 500,
        statusText: 'Unexpected fetch',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  })
  vi.stubGlobal('fetch', fetchMock)
}

function createStat(mode: number, size = 0): IStat {
  const date = new Date(0)
  return {
    dev: 0,
    ino: 0,
    mode,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    size,
    blksize: 0,
    blocks: 0,
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: date,
    mtime: date,
    ctime: date,
    birthtime: date,
  }
}

function createTestFs(files: Map<string, string>) {
  const directories = new Set([
    '/documents',
    '/documents/Projects',
    projectPath,
  ])
  return {
    resolve: joinPaths,
    join: joinPaths,
    relative: (from: string, to: string) =>
      normalizePath(to).replace(`${normalizePath(from)}/`, ''),
    extname: (path: string) => {
      const fileName = basename(path)
      const extensionStart = fileName.lastIndexOf('.')
      return extensionStart === -1 ? '' : fileName.slice(extensionStart)
    },
    sep: '/',
    basename,
    dirname,
    getPath: async () => '/documents',
    access: async (path: string) => {
      const normalizedPath = normalizePath(path)
      if (!files.has(normalizedPath) && !directories.has(normalizedPath)) {
        return Promise.reject('ENOENT')
      }
    },
    cp: async () => undefined,
    readFile: async (
      path: string,
      options?: { encoding?: string } | string
    ) => {
      const normalizedPath = normalizePath(path)
      const contents = files.get(normalizedPath)
      if (contents === undefined) {
        return Promise.reject('ENOENT')
      }
      if (
        options === 'utf8' ||
        (typeof options === 'object' && options.encoding === 'utf-8')
      ) {
        return contents
      }
      return new TextEncoder().encode(contents)
    },
    rename: async () => undefined,
    publishDirectory: async () => undefined,
    writeFile: async (path: string, data: Uint8Array<ArrayBuffer>) => {
      files.set(normalizePath(path), new TextDecoder().decode(data))
    },
    readdir: async (path: string) => {
      const normalizedPath = normalizePath(path)
      return [...directories, ...files.keys()]
        .filter((entry) => dirname(entry) === normalizedPath)
        .map(basename)
    },
    stat: async (path: string) => {
      const normalizedPath = normalizePath(path)
      if (directories.has(normalizedPath)) {
        return createStat(0o040000)
      }
      const contents = files.get(normalizedPath)
      if (contents !== undefined) {
        return createStat(0o100000, contents.length)
      }
      return Promise.reject('ENOENT')
    },
    mkdir: async (path: string) => {
      directories.add(normalizePath(path))
      return undefined
    },
    rm: async (path: string) => {
      const normalizedPath = normalizePath(path)
      directories.delete(normalizedPath)
      files.delete(normalizedPath)
    },
    detach: async () => undefined,
    attach: async () => undefined,
  } as IZooDesignStudioFS
}

async function seedLinkedProject() {
  await putProjectMetadata({
    schemaVersion: 1,
    localProjectPath: projectPath,
    projectName: 'bracket',
    remoteProjectId,
    remoteRevision,
    remoteUpdatedAt: '2026-07-08T12:00:00.000Z',
    baseManifest: {
      files: {},
    },
  })
}

describe('disconnectCloudSyncProject', () => {
  beforeEach(async () => {
    await deleteSyncDatabase()
    // Keep the engine's eager zero-delay scan from carrying the previous
    // test's filesystem into this test. Individual sync tests advance it
    // explicitly after installing their own filesystem fixture.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    installFetchMock()
    cloudSyncRemoteProjects.value = [{ id: remoteProjectId }]
    configureCloudSyncEngine({
      enabled: true,
      baseUrl: 'https://example.test',
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: '/documents/Projects',
    })
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    vi.useRealTimers()
    await deleteSyncDatabase()
  })

  it('detaches local sync metadata before deleting the remote project', async () => {
    const files = new Map([
      [
        projectTomlPath,
        `title = "Bracket"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    await seedLinkedProject()
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: `${projectPath}/main.kcl`,
      createdAt: '2026-07-08T12:00:00.000Z',
    })

    let finishDelete: (() => void) | undefined
    const deleteStarted = new Promise<void>((resolve) => {
      deleteProjectFetch = async () =>
        new Promise<Response>((resolveFetch) => {
          finishDelete = () => {
            resolveFetch(new Response(null, { status: 204 }))
          }
          resolve()
        })
    })

    const disconnect = disconnectCloudSyncProject(projectPath)
    await deleteStarted

    expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
      remoteProjectId: undefined,
      remoteRevision: undefined,
      baseManifest: undefined,
      syncExcluded: {
        reason: 'user-disconnected',
        remoteProjectId,
      },
    })
    expect(files.get(projectTomlPath)).not.toContain('project_id')
    expect(await getAllOutboxEntries()).toHaveLength(1)

    finishDelete?.()
    await disconnect

    expect(fetchMock).toHaveBeenCalledWith(
      remoteProjectUrl,
      expect.objectContaining({
        credentials: 'include',
        method: 'DELETE',
      })
    )
    expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
      remoteProjectId: undefined,
      remoteRevision: undefined,
      baseManifest: undefined,
      syncExcluded: {
        reason: 'user-disconnected',
        remoteProjectId,
      },
    })
    expect(await getAllOutboxEntries()).toHaveLength(0)
    expect(cloudSyncRemoteProjects.value).toEqual([])
  })

  it('restores the local cloud link when remote deletion fails', async () => {
    const files = new Map([
      [
        projectTomlPath,
        `title = "Bracket"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    await seedLinkedProject()
    deleteProjectFetch = async () =>
      new Response(JSON.stringify({ message: 'Remote delete failed.' }), {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          'Content-Type': 'application/json',
        },
      })

    await expect(disconnectCloudSyncProject(projectPath)).rejects.toThrow(
      'Remote delete failed.'
    )

    expect(fetchMock).toHaveBeenCalledWith(
      remoteProjectUrl,
      expect.objectContaining({
        credentials: 'include',
        method: 'DELETE',
      })
    )
    expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
      remoteProjectId,
      remoteRevision,
      syncExcluded: undefined,
    })
    expect(files.get(projectTomlPath)).toContain(
      `project_id = "${remoteProjectId}"`
    )
  })

  it('registers a duplicated project only after its cloud metadata is detached', async () => {
    const duplicateProjectPath = '/documents/Projects/bracket-copy'
    const duplicateProjectTomlPath = `${duplicateProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`
    const stagingProjectPath = '/documents/Projects/.zds-duplicate-staging'
    const files = new Map<string, string>()
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({
      enabled: true,
      syncExistingLocalProjects: false,
    })

    await runCloudSyncWriteTransaction(duplicateProjectPath, async () => {
      files.set(
        duplicateProjectTomlPath,
        `title = "Bracket copy"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`
      )
      files.set(
        `${stagingProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        files.get(duplicateProjectTomlPath) ?? ''
      )

      await notifyCloudSyncWriteLikeMutation(stagingProjectPath)
      await notifyCloudSyncWriteLikeMutation(duplicateProjectPath)

      expect(
        await getCloudSyncProjectMetadata(stagingProjectPath)
      ).toBeUndefined()
      expect(
        await getCloudSyncProjectMetadata(duplicateProjectPath)
      ).toBeUndefined()

      files.set(duplicateProjectTomlPath, 'title = "Bracket copy"\n')
    })

    const duplicateMetadata =
      await getCloudSyncProjectMetadata(duplicateProjectPath)
    expect(duplicateMetadata).toMatchObject({
      localProjectPath: duplicateProjectPath,
    })
    expect(duplicateMetadata).not.toHaveProperty('remoteProjectId')
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('does not register an incomplete duplicate when its transaction fails', async () => {
    const duplicateProjectPath = '/documents/Projects/failed-copy'
    const files = new Map<string, string>()
    configureCloudSyncLocalFileSystem(createTestFs(files))

    await expect(
      runCloudSyncWriteTransaction(duplicateProjectPath, async () => {
        files.set(
          `${duplicateProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
          `title = "Failed copy"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`
        )
        await notifyCloudSyncWriteLikeMutation(duplicateProjectPath)
        return Promise.reject(new Error('copy failed'))
      })
    ).rejects.toThrow('copy failed')

    expect(
      await getCloudSyncProjectMetadata(duplicateProjectPath)
    ).toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('does not migrate cloud identity for a rename observed inside a failed transaction', async () => {
    const targetProjectPath = '/documents/Projects/renamed-bracket'
    const files = new Map([[projectTomlPath, 'title = "Bracket"\n']])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId,
      remoteRevision,
      baseManifest: { files: {} },
    })

    await expect(
      runCloudSyncWriteTransaction(targetProjectPath, async () => {
        files.delete(projectTomlPath)
        files.set(
          `${targetProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
          'title = "Renamed bracket"\n'
        )
        await notifyCloudSyncRenameMutation(projectPath, targetProjectPath)
        return Promise.reject(new Error('rename transaction failed'))
      })
    ).rejects.toThrow('rename transaction failed')

    expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
      remoteProjectId,
      remoteRevision,
    })
    expect(await getCloudSyncProjectMetadata(targetProjectPath)).toBeUndefined()
  })

  it('does not discover or register a marker-bearing partial duplicate', async () => {
    const markerContents = evidenceContents(
      duplicatePublicationEvidence('bracket').targetPublished
    )
    const files = new Map([
      [projectTomlPath, 'title = "Partial copy"\n'],
      [`${projectPath}/${DUPLICATE_IN_PROGRESS_FILE_NAME}`, markerContents],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: true,
      })
      vi.advanceTimersByTime(0)
      let stopWatchingStatus: () => void = () => undefined
      const runFinished = new Promise<void>((resolve) => {
        stopWatchingStatus = cloudSyncStatus.subscribe((status) => {
          if (status.state === 'idle') {
            stopWatchingStatus()
            resolve()
          }
        })
      })
      await runFinished

      await notifyCloudSyncWriteLikeMutation(projectTomlPath)

      expect(await getCloudSyncProjectMetadata(projectPath)).toBeUndefined()
      expect(await getAllOutboxEntries()).toEqual([])
      expect(cloudSyncStatus.value.pendingCount).toBe(0)
    } finally {
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('quarantines ownership evidence created during the root check', async () => {
    const markerPath = `${projectPath}/${DUPLICATE_IN_PROGRESS_FILE_NAME}`
    const files = new Map([[projectTomlPath, 'title = "Partial copy"\n']])
    const testFs = createTestFs(files)
    const stat = testFs.stat
    let markerInjected = false
    testFs.stat = async (targetPath: string, options?: unknown) => {
      if (normalizePath(targetPath) === projectPath && !markerInjected) {
        expect(files.has(markerPath)).toBe(false)
        markerInjected = true
        files.set(
          markerPath,
          evidenceContents(
            duplicatePublicationEvidence('bracket').targetPublishing
          )
        )
      }
      return stat(targetPath, options)
    }
    configureCloudSyncLocalFileSystem(testFs)

    await notifyCloudSyncWriteLikeMutation(projectTomlPath)

    expect(markerInjected).toBe(true)
    expect(await getCloudSyncProjectMetadata(projectPath)).toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('does not consume queued work for a crashed marker-bearing duplicate', async () => {
    const markerPath = `${projectPath}/${DUPLICATE_IN_PROGRESS_FILE_NAME}`
    const files = new Map([
      [projectTomlPath, 'title = "Partial copy"\n'],
      [
        markerPath,
        evidenceContents(
          duplicatePublicationEvidence('bracket').targetPublishing
        ),
      ],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      await putProjectMetadata({
        schemaVersion: 1,
        localProjectPath: projectPath,
        projectName: 'bracket',
        remoteProjectId,
        remoteRevision,
        baseManifest: { files: {} },
      })
      await appendOutboxEntry({
        projectPath,
        kind: 'delete',
        targetPath: projectPath,
        createdAt: '2026-07-08T12:00:00.000Z',
      })
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: false,
      })
      vi.advanceTimersByTime(0)
      let stopWatchingStatus: () => void = () => undefined
      const runFinished = new Promise<void>((resolve) => {
        stopWatchingStatus = cloudSyncStatus.subscribe((status) => {
          if (status.state === 'idle') {
            stopWatchingStatus()
            resolve()
          }
        })
      })
      await runFinished

      expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
        remoteProjectId,
        remoteRevision,
        baseManifest: { files: {} },
      })
      expect(await getAllOutboxEntries()).toEqual([
        expect.objectContaining({
          projectPath,
          kind: 'delete',
        }),
      ])
      expect(cloudSyncStatus.value.pendingCount).toBe(0)
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            getFetchMethod(input, init) === 'DELETE' &&
            getFetchUrl(input).endsWith(`/${remoteProjectId}`)
        )
      ).toBe(false)
    } finally {
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('quarantines a markerless target with collision-equivalent reservation evidence', async () => {
    const publicationEvidence = duplicatePublicationEvidence('BRACKET')
    const reservationPath = `/documents/Projects/${getDuplicateReservationFileName(
      'bracket'
    )}`
    const files = new Map([
      [
        `${projectPath}/${INTERNAL_OPFS_META_FILE}`,
        'internal OPFS bookkeeping',
      ],
      [
        reservationPath,
        evidenceContents(publicationEvidence.reservationReserved),
      ],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const runScheduledSync = async () => {
      vi.advanceTimersByTime(0)
      let stopWatchingStatus: () => void = () => undefined
      await new Promise<void>((resolve) => {
        stopWatchingStatus = cloudSyncStatus.subscribe((status) => {
          if (status.state === 'idle') {
            stopWatchingStatus()
            resolve()
          }
        })
      })
    }

    try {
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: true,
      })
      await runScheduledSync()
      await notifyCloudSyncWriteLikeMutation(projectPath)

      expect(await getCloudSyncProjectMetadata(projectPath)).toBeUndefined()
      expect(await getAllOutboxEntries()).toEqual([])

      configureCloudSyncEngine({ enabled: false })
      await putProjectMetadata({
        schemaVersion: 1,
        localProjectPath: projectPath,
        projectName: 'bracket',
        remoteProjectId,
        remoteRevision,
      })
      await appendOutboxEntry({
        projectPath,
        kind: 'delete',
        targetPath: projectPath,
        createdAt: '2026-07-08T12:00:00.000Z',
      })
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: false,
      })
      await runScheduledSync()

      expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
        remoteProjectId,
        remoteRevision,
      })
      expect(await getAllOutboxEntries()).toEqual([
        expect.objectContaining({
          projectPath,
          kind: 'delete',
        }),
      ])
      expect(cloudSyncStatus.value.pendingCount).toBe(0)
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            getFetchMethod(input, init) === 'DELETE' &&
            getFetchUrl(input).endsWith(`/${remoteProjectId}`)
        )
      ).toBe(false)
    } finally {
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('does not quarantine an internal-only project without valid ownership evidence', async () => {
    const files = new Map([
      [`${projectPath}/${INTERNAL_OPFS_META_FILE}`, 'internal bookkeeping'],
      [`${projectPath}/${DUPLICATE_IN_PROGRESS_FILE_NAME}`, 'not valid JSON'],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      await putProjectMetadata({
        schemaVersion: 1,
        localProjectPath: projectPath,
        projectName: 'bracket',
        remoteProjectId,
        remoteRevision,
        tombstone: true,
      })
      await appendOutboxEntry({
        projectPath,
        kind: 'delete',
        targetPath: projectPath,
        createdAt: '2026-07-08T12:00:00.000Z',
      })
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: false,
      })
      vi.advanceTimersByTime(0)
      let stopWatchingStatus: () => void = () => undefined
      await new Promise<void>((resolve) => {
        stopWatchingStatus = cloudSyncStatus.subscribe((status) => {
          if (status.state === 'idle') {
            stopWatchingStatus()
            resolve()
          }
        })
      })

      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            getFetchMethod(input, init) === 'DELETE' &&
            getFetchUrl(input) === remoteProjectUrl
        )
      ).toBe(true)
      expect(await getCloudSyncProjectMetadata(projectPath)).toBeUndefined()
      expect(await getAllOutboxEntries()).toEqual([])
    } finally {
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('syncs a missing synthetic delete when readdir has OPFS empty-array semantics', async () => {
    const syntheticDeletePath =
      '/documents/Projects/.zds-cloud-delete-missing-project'
    const files = new Map<string, string>()
    const testFs = createTestFs(files)
    const readdir = testFs.readdir
    testFs.readdir = async (targetPath, options) => {
      const entries = await readdir(targetPath, options)
      if (normalizePath(targetPath) === syntheticDeletePath) {
        expect(entries).toEqual([])
      }
      return entries
    }
    expect(await testFs.readdir(syntheticDeletePath)).toEqual([])
    configureCloudSyncLocalFileSystem(testFs)
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      await putProjectMetadata({
        schemaVersion: 1,
        localProjectPath: syntheticDeletePath,
        projectName: '.zds-cloud-delete-missing-project',
        remoteProjectId,
        remoteRevision,
        tombstone: true,
      })
      await appendOutboxEntry({
        projectPath: syntheticDeletePath,
        kind: 'delete',
        targetPath: syntheticDeletePath,
        createdAt: '2026-07-08T12:00:00.000Z',
      })
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: false,
      })
      vi.advanceTimersByTime(0)
      let stopWatchingStatus: () => void = () => undefined
      await new Promise<void>((resolve) => {
        stopWatchingStatus = cloudSyncStatus.subscribe((status) => {
          if (status.state === 'idle') {
            stopWatchingStatus()
            resolve()
          }
        })
      })

      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            getFetchMethod(input, init) === 'DELETE' &&
            getFetchUrl(input) === remoteProjectUrl
        )
      ).toBe(true)
      expect(
        await getCloudSyncProjectMetadata(syntheticDeletePath)
      ).toBeUndefined()
      expect(await getAllOutboxEntries()).toEqual([])
    } finally {
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('atomically gives a duplicate a fresh identity while preserving a queued remote deletion', async () => {
    const duplicateProjectPath = '/documents/Projects/bracket-copy'
    const duplicateMarkerPath = `${duplicateProjectPath}/${DUPLICATE_IN_PROGRESS_FILE_NAME}`
    const files = new Map<string, string>()
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      await putProjectMetadata({
        schemaVersion: 1,
        localProjectPath: duplicateProjectPath,
        projectName: 'bracket-copy',
        remoteProjectId,
        remoteRevision,
        remoteUpdatedAt: '2026-07-08T12:00:00.000Z',
        baseManifest: { files: {} },
        tombstone: true,
        conflict: {
          remoteRevision,
          conflictProjectPath: '/documents/Projects/stale-conflict',
          createdAt: '2026-07-08T12:00:00.000Z',
        },
        syncExcluded: {
          reason: 'user-disconnected',
          remoteProjectId,
          createdAt: '2026-07-08T12:00:00.000Z',
        },
      })
      await appendOutboxEntry({
        projectPath: duplicateProjectPath,
        kind: 'delete',
        targetPath: duplicateProjectPath,
        createdAt: '2026-07-08T12:00:00.000Z',
      })
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: false,
      })

      await runCloudSyncWriteTransaction(
        duplicateProjectPath,
        async () => {
          files.set(
            duplicateMarkerPath,
            evidenceContents(
              duplicatePublicationEvidence('bracket-copy').targetPublished
            )
          )
          files.set(
            `${duplicateProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
            'title = "Bracket copy"\n'
          )
        },
        {
          freshProjectIdentity: true,
          afterFreshIdentityReset: async () => {
            expect(files.has(duplicateMarkerPath)).toBe(true)
            expect(
              await getCloudSyncProjectMetadata(duplicateProjectPath)
            ).toBeUndefined()
            expect(
              (await getAllOutboxEntries()).filter(
                (entry) => entry.projectPath === duplicateProjectPath
              )
            ).toEqual([])
            files.delete(duplicateMarkerPath)
          },
        }
      )

      expect(files.has(duplicateMarkerPath)).toBe(false)
      expect(await getCloudSyncProjectMetadata(duplicateProjectPath)).toEqual({
        schemaVersion: 1,
        localProjectPath: duplicateProjectPath,
        projectName: 'bracket-copy',
      })
      const retiredMetadata = (await getAllProjectMetadata()).find(
        (metadata) => metadata.localProjectPath !== duplicateProjectPath
      )
      expect(retiredMetadata).toMatchObject({
        localProjectPath: expect.stringContaining('/.zds-cloud-delete-'),
        remoteProjectId,
        remoteRevision,
        tombstone: true,
      })
      expect(retiredMetadata).not.toHaveProperty('baseManifest')
      expect(retiredMetadata).not.toHaveProperty('conflict')
      expect(retiredMetadata).not.toHaveProperty('syncExcluded')
      expect(await getAllOutboxEntries()).toEqual([
        expect.objectContaining({
          projectPath: retiredMetadata?.localProjectPath,
          kind: 'delete',
          targetPath: retiredMetadata?.localProjectPath,
        }),
      ])
    } finally {
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('keeps queued work fenced while a write transaction is active', async () => {
    const files = new Map([[projectTomlPath, 'title = "Bracket"\n']])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      await putProjectMetadata({
        schemaVersion: 1,
        localProjectPath: projectPath,
        projectName: 'bracket',
      })
      await appendOutboxEntry({
        projectPath,
        kind: 'upsert',
        targetPath: projectTomlPath,
        createdAt: '2026-07-08T12:00:00.000Z',
      })
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: true,
      })

      let releaseOperation: (() => void) | undefined
      let markOperationStarted: (() => void) | undefined
      const operationStarted = new Promise<void>((resolve) => {
        markOperationStarted = resolve
      })
      const operationGate = new Promise<void>((resolve) => {
        releaseOperation = resolve
      })
      const transaction = runCloudSyncWriteTransaction(
        projectPath,
        async () => {
          markOperationStarted?.()
          await operationGate
        }
      )
      await operationStarted

      await vi.advanceTimersByTimeAsync(0)

      expect(await getAllOutboxEntries()).toHaveLength(1)
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => getFetchMethod(input, init) !== 'GET'
        )
      ).toBe(false)

      releaseOperation?.()
      await transaction
    } finally {
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('queues observed registrations behind a fallback source read lock', async () => {
    const files = new Map([[projectTomlPath, 'title = "Bracket"\n']])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({
      enabled: true,
      syncExistingLocalProjects: true,
    })
    const originalLocks = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'locks'
    )
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: undefined,
    })
    let releaseRead: (() => void) | undefined
    let markReadStarted: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve
    })
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })

    try {
      const read = runCloudSyncProjectReadTransaction(projectPath, async () => {
        markReadStarted?.()
        await readGate
      })
      await readStarted

      let registrationSettled = false
      const registration = notifyCloudSyncWriteLikeMutation(
        projectTomlPath
      ).then(() => {
        registrationSettled = true
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(registrationSettled).toBe(false)
      expect(await getAllOutboxEntries()).toEqual([])

      releaseRead?.()
      await read
      await registration

      expect(await getAllOutboxEntries()).toEqual([
        expect.objectContaining({
          projectPath,
          kind: 'upsert',
          targetPath: projectTomlPath,
        }),
      ])
    } finally {
      releaseRead?.()
      configureCloudSyncEngine({ enabled: false })
      if (originalLocks) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocks)
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'locks')
      }
    }
  })

  it('holds the source lock until overlapping reads on the path complete', async () => {
    const files = new Map([[projectTomlPath, 'title = "Bracket"\n']])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    const originalLocks = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'locks'
    )
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: undefined,
    })
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    let markFirstStarted: (() => void) | undefined
    let markSecondStarted: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve
    })
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    try {
      let outerSettled = false
      const first = runCloudSyncProjectReadTransaction(
        projectPath,
        async () => {
          markFirstStarted?.()
          await firstGate
        }
      ).then(() => {
        outerSettled = true
      })
      await firstStarted
      const second = runCloudSyncProjectReadTransaction(
        projectPath,
        async () => {
          markSecondStarted?.()
          await secondGate
        }
      )
      await secondStarted

      releaseFirst?.()
      await Promise.resolve()
      await Promise.resolve()
      expect(outerSettled).toBe(false)

      releaseSecond?.()
      await Promise.all([first, second])
      expect(outerSettled).toBe(true)
    } finally {
      releaseFirst?.()
      releaseSecond?.()
      configureCloudSyncEngine({ enabled: false })
      if (originalLocks) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocks)
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'locks')
      }
    }
  })

  it('rescans the remote index after a read-leased project was skipped', async () => {
    configureCloudSyncLocalFileSystem(createTestFs(new Map()))
    await seedLinkedProject()
    let releaseRead: (() => void) | undefined
    let markReadStarted: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve
    })
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const runScheduledSync = async () => {
      vi.advanceTimersByTime(0)
      let stopWatchingStatus: () => void = () => undefined
      await new Promise<void>((resolve) => {
        stopWatchingStatus = cloudSyncStatus.subscribe((status) => {
          if (status.state === 'idle') {
            stopWatchingStatus()
            resolve()
          }
        })
      })
    }

    try {
      const read = runCloudSyncProjectReadTransaction(projectPath, async () => {
        markReadStarted?.()
        await readGate
      })
      await readStarted

      await runScheduledSync()
      expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
        remoteProjectId,
      })

      releaseRead?.()
      await read
      await runScheduledSync()

      expect(await getCloudSyncProjectMetadata(projectPath)).toBeUndefined()
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            getFetchMethod(input, init) === 'GET' &&
            getFetchUrl(input) === 'https://example.test/user/projects'
        )
      ).toHaveLength(2)
    } finally {
      releaseRead?.()
    }
  })

  it('queues a destructive cloud mutator behind a fallback source read lock', async () => {
    const files = new Map([
      [
        projectTomlPath,
        `title = "Bracket"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({
      enabled: true,
      syncExistingLocalProjects: true,
    })
    await seedLinkedProject()
    const originalLocks = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'locks'
    )
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: undefined,
    })
    let releaseRead: (() => void) | undefined
    let markReadStarted: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve
    })
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })

    try {
      const read = runCloudSyncProjectReadTransaction(projectPath, async () => {
        markReadStarted?.()
        await readGate
      })
      await readStarted

      let disconnectSettled = false
      const disconnect = disconnectCloudSyncProject(projectPath).then(() => {
        disconnectSettled = true
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(disconnectSettled).toBe(false)
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => getFetchMethod(input, init) === 'DELETE'
        )
      ).toBe(false)

      releaseRead?.()
      await read
      await disconnect

      expect(disconnectSettled).toBe(true)
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            getFetchMethod(input, init) === 'DELETE' &&
            getFetchUrl(input) === remoteProjectUrl
        )
      ).toBe(true)
    } finally {
      releaseRead?.()
      configureCloudSyncEngine({ enabled: false })
      if (originalLocks) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocks)
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'locks')
      }
    }
  })

  it('defers known-local title hydration until a fallback source read completes', async () => {
    const files = new Map([
      [
        projectTomlPath,
        `[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({
      enabled: true,
      syncExistingLocalProjects: true,
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId,
      remoteRevision,
    })
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)
      if (url === remoteProjectUrl && method === 'GET') {
        return new Response(
          JSON.stringify({
            id: remoteProjectId,
            title: 'Remote bracket',
            revision: remoteRevision,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }
      if (url === 'https://example.test/user/projects' && method === 'GET') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 204 })
    })
    const originalLocks = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'locks'
    )
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: undefined,
    })
    let releaseRead: (() => void) | undefined
    let markReadStarted: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve
    })
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })

    try {
      const read = runCloudSyncProjectReadTransaction(projectPath, async () => {
        markReadStarted?.()
        await readGate
      })
      await readStarted

      let hydrationSettled = false
      const hydration = ensureCloudProjectLocallySynced(remoteProjectId).then(
        (result) => {
          hydrationSettled = true
          return result
        }
      )
      await Promise.resolve()
      await Promise.resolve()

      expect(hydrationSettled).toBe(false)
      expect(files.get(projectTomlPath)).not.toContain('title =')

      releaseRead?.()
      await read
      const result = await hydration

      expect(result?.projectPath).toBe(projectPath)
      expect(files.get(projectTomlPath)).toContain('title = "Remote bracket"')
    } finally {
      releaseRead?.()
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
      if (originalLocks) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocks)
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'locks')
      }
    }
  })

  it('rejects direct cloud mutators instead of re-entering a write transaction lock', async () => {
    const files = new Map([[projectTomlPath, 'title = "Bracket"\n']])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId,
      remoteRevision,
    })

    await runCloudSyncWriteTransaction(projectPath, async () => {
      await expect(startCloudSyncProject(projectPath)).rejects.toThrow(
        'being changed'
      )
      await expect(disconnectCloudSyncProject(projectPath)).rejects.toThrow(
        'being changed'
      )
      await expect(
        resolveCloudSyncProjectConflict(projectPath, 'cloud')
      ).rejects.toThrow('being changed')
      await expect(
        ensureCloudProjectLocallySynced(remoteProjectId)
      ).rejects.toThrow('being changed')
    })
  })

  it('emits one final commit for overlapping successful transactions', async () => {
    const duplicateProjectPath = '/documents/Projects/overlap-copy'
    const files = new Map<string, string>()
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: true,
      })
      let releaseFirst: (() => void) | undefined
      let markFirstStarted: (() => void) | undefined
      const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve
      })
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      const first = runCloudSyncWriteTransaction(
        duplicateProjectPath,
        async () => {
          markFirstStarted?.()
          await firstGate
          files.set(
            `${duplicateProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
            'title = "Overlap copy"\n'
          )
        },
        { freshProjectIdentity: true }
      )
      await firstStarted

      await runCloudSyncWriteTransaction(duplicateProjectPath, async () => {
        files.set(
          `${duplicateProjectPath}/main.kcl`,
          'cube = startSketchOn(XY)'
        )
        await notifyCloudSyncWriteLikeMutation(duplicateProjectPath)
      })

      expect(
        await getCloudSyncProjectMetadata(duplicateProjectPath)
      ).toBeUndefined()
      expect(await getAllOutboxEntries()).toEqual([])

      releaseFirst?.()
      await first

      expect(await getAllOutboxEntries()).toEqual([
        expect.objectContaining({
          projectPath: duplicateProjectPath,
          kind: 'upsert',
        }),
      ])
    } finally {
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('queues transactions started after the current write cohort settles', async () => {
    const duplicateProjectPath = '/documents/Projects/settled-copy'
    const files = new Map([
      [
        `${duplicateProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        'title = "Settled copy"\n',
      ],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({
      enabled: true,
      syncExistingLocalProjects: true,
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let releaseFinalizer: (() => void) | undefined
    let markFinalizerStarted: (() => void) | undefined
    const finalizerStarted = new Promise<void>((resolve) => {
      markFinalizerStarted = resolve
    })
    const finalizerGate = new Promise<void>((resolve) => {
      releaseFinalizer = resolve
    })

    try {
      const first = runCloudSyncWriteTransaction(
        duplicateProjectPath,
        async () => undefined,
        {
          freshProjectIdentity: true,
          afterFreshIdentityReset: async () => {
            markFinalizerStarted?.()
            await finalizerGate
          },
        }
      )
      await finalizerStarted

      let secondStarted = false
      const second = runCloudSyncWriteTransaction(
        duplicateProjectPath,
        async () => {
          secondStarted = true
        }
      )
      await Promise.resolve()
      await Promise.resolve()
      expect(secondStarted).toBe(false)

      releaseFinalizer?.()
      await Promise.all([first, second])
      expect(secondStarted).toBe(true)
      expect(await getAllOutboxEntries()).toHaveLength(2)
    } finally {
      releaseFinalizer?.()
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('does not lose a nested commit when the outer operation fails', async () => {
    const duplicateProjectPath = '/documents/Projects/nested-copy'
    const files = new Map<string, string>()
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: true,
      })

      await expect(
        runCloudSyncWriteTransaction(duplicateProjectPath, async () => {
          await runCloudSyncWriteTransaction(duplicateProjectPath, async () => {
            files.set(
              `${duplicateProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
              'title = "Nested copy"\n'
            )
          })
          return Promise.reject(new Error('outer operation failed'))
        })
      ).rejects.toThrow('outer operation failed')

      expect(await getAllOutboxEntries()).toEqual([
        expect.objectContaining({
          projectPath: duplicateProjectPath,
          kind: 'upsert',
        }),
      ])
    } finally {
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('does not latch fresh identity from a failed outer operation', async () => {
    const files = new Map([[projectTomlPath, 'title = "Bracket"\n']])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    const finalizeFreshIdentity = vi.fn(async () => undefined)
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId,
      remoteRevision,
      baseManifest: { files: {} },
    })
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: projectTomlPath,
      createdAt: '2026-07-08T12:00:00.000Z',
    })

    await expect(
      runCloudSyncWriteTransaction(
        projectPath,
        async () => {
          await runCloudSyncWriteTransaction(projectPath, async () => {
            files.set(`${projectPath}/main.kcl`, 'cube = startSketchOn(XY)')
          })
          return Promise.reject(new Error('fresh operation failed'))
        },
        {
          freshProjectIdentity: true,
          afterFreshIdentityReset: finalizeFreshIdentity,
        }
      )
    ).rejects.toThrow('fresh operation failed')

    expect(finalizeFreshIdentity).not.toHaveBeenCalled()
    expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
      remoteProjectId,
      remoteRevision,
      baseManifest: { files: {} },
    })
    expect(await getAllOutboxEntries()).toEqual([
      expect.objectContaining({ projectPath, targetPath: projectTomlPath }),
      expect.objectContaining({ projectPath, targetPath: projectPath }),
    ])
  })

  it('preserves a committed write when fresh identity finalization fails', async () => {
    const failedProjectPath = '/documents/Projects/rollback-copy'
    const markerPath = `${failedProjectPath}/${DUPLICATE_IN_PROGRESS_FILE_NAME}`
    const files = new Map<string, string>()
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    const testIndexedDb = globalThis.indexedDB
    let published = false
    const afterFreshIdentityReset = vi.fn(async () => {
      files.delete(markerPath)
    })
    vi.stubGlobal('indexedDB', {})

    try {
      await expect(
        runCloudSyncWriteTransaction(
          failedProjectPath,
          async () => {
            files.set(
              markerPath,
              evidenceContents(
                duplicatePublicationEvidence('rollback-copy').targetPublished
              )
            )
            published = true
            return 'published'
          },
          {
            freshProjectIdentity: true,
            afterFreshIdentityReset,
          }
        )
      ).rejects.toThrow()
      expect(published).toBe(true)
      expect(afterFreshIdentityReset).not.toHaveBeenCalled()
      expect(files.has(markerPath)).toBe(true)
    } finally {
      vi.stubGlobal('indexedDB', testIndexedDb)
    }
  })

  it('leaves the marker quarantined when filesystem finalization fails', async () => {
    const failedProjectPath = '/documents/Projects/finalizer-failed-copy'
    const markerPath = `${failedProjectPath}/${DUPLICATE_IN_PROGRESS_FILE_NAME}`
    const files = new Map<string, string>()
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: true,
      })
      await expect(
        runCloudSyncWriteTransaction(
          failedProjectPath,
          async () => {
            files.set(
              markerPath,
              evidenceContents(
                duplicatePublicationEvidence('finalizer-failed-copy')
                  .targetPublished
              )
            )
            files.set(
              `${failedProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
              'title = "Failed finalizer copy"\n'
            )
          },
          {
            freshProjectIdentity: true,
            afterFreshIdentityReset: async () =>
              Promise.reject(new Error('marker removal failed')),
          }
        )
      ).rejects.toThrow('marker removal failed')

      expect(files.has(markerPath)).toBe(true)
      expect(
        await getCloudSyncProjectMetadata(failedProjectPath)
      ).toBeUndefined()
      expect(
        (await getAllOutboxEntries()).filter(
          (entry) => entry.projectPath === failedProjectPath
        )
      ).toEqual([])
    } finally {
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
    }
  })

  it('clears latent identity for owned recovery without registering the partial target', async () => {
    const failedProjectPath = '/documents/Projects/recovery-copy'
    const markerPath = `${failedProjectPath}/${DUPLICATE_IN_PROGRESS_FILE_NAME}`
    const files = new Map([
      [
        markerPath,
        evidenceContents(
          duplicatePublicationEvidence('recovery-copy').targetPublishing
        ),
      ],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: failedProjectPath,
      projectName: 'recovery-copy',
      remoteProjectId,
      remoteRevision,
      baseManifest: { files: {} },
    })
    await appendOutboxEntry({
      projectPath: failedProjectPath,
      kind: 'upsert',
      targetPath: failedProjectPath,
      createdAt: '2026-07-08T12:00:00.000Z',
    })

    await resetCloudSyncProjectIdentityForRecovery(failedProjectPath)

    expect(files.has(markerPath)).toBe(true)
    expect(await getCloudSyncProjectMetadata(failedProjectPath)).toBeUndefined()
    expect(
      (await getAllOutboxEntries()).filter(
        (entry) => entry.projectPath === failedProjectPath
      )
    ).toEqual([])
  })

  it('reloads queued work after the project lock before syncing a fresh identity', async () => {
    const duplicateProjectPath = '/documents/Projects/reused-copy'
    const files = new Map([[projectTomlPath, 'title = "Bracket"\n']])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const lockTails = new Map<string, Promise<void>>()
    const requestLock = async <T>(
      _name: string,
      callback: () => Promise<T>
    ) => {
      const previous = lockTails.get(_name) ?? Promise.resolve()
      let releaseCurrent: (() => void) | undefined
      const current = new Promise<void>((resolve) => {
        releaseCurrent = resolve
      })
      lockTails.set(_name, current)
      await previous
      try {
        return await callback()
      } finally {
        releaseCurrent?.()
        if (lockTails.get(_name) === current) {
          lockTails.delete(_name)
        }
      }
    }
    const originalLocks = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'locks'
    )
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: { request: requestLock },
    })

    let releaseBlockerUpload: (() => void) | undefined
    let markBlockerUploadStarted: (() => void) | undefined
    const blockerUploadStarted = new Promise<void>((resolve) => {
      markBlockerUploadStarted = resolve
    })
    const blockerUploadGate = new Promise<void>((resolve) => {
      releaseBlockerUpload = resolve
    })

    try {
      fetchMock.mockImplementation(async (input, init) => {
        const url = getFetchUrl(input)
        const method = getFetchMethod(input, init)
        if (url === 'https://example.test/user/projects' && method === 'GET') {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (
          url === 'https://example.test/user/projects/blocker-old' &&
          method === 'DELETE'
        ) {
          markBlockerUploadStarted?.()
          await blockerUploadGate
          return new Response(null, { status: 204 })
        }
        return new Response(null, { status: 204 })
      })

      await putProjectMetadata({
        schemaVersion: 1,
        localProjectPath: projectPath,
        projectName: 'bracket',
        remoteProjectId: 'blocker-old',
        tombstone: true,
      })
      await appendOutboxEntry({
        projectPath,
        kind: 'delete',
        targetPath: projectPath,
        createdAt: '2026-07-08T12:00:00.000Z',
      })
      await putProjectMetadata({
        schemaVersion: 1,
        localProjectPath: duplicateProjectPath,
        projectName: 'reused-copy',
        remoteProjectId,
        tombstone: true,
      })
      await appendOutboxEntry({
        projectPath: duplicateProjectPath,
        kind: 'delete',
        targetPath: duplicateProjectPath,
        createdAt: '2026-07-08T12:00:00.000Z',
      })
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: false,
      })

      vi.advanceTimersByTime(0)
      await blockerUploadStarted

      await runCloudSyncWriteTransaction(
        duplicateProjectPath,
        async () => {
          files.set(
            `${duplicateProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
            'title = "Reused copy"\n'
          )
        },
        { freshProjectIdentity: true }
      )

      let stopWatchingStatus: () => void = () => undefined
      const runFinished = new Promise<void>((resolve) => {
        stopWatchingStatus = cloudSyncStatus.subscribe((status) => {
          if (status.state === 'idle') {
            stopWatchingStatus()
            resolve()
          }
        })
      })
      releaseBlockerUpload?.()
      await runFinished

      expect(await getCloudSyncProjectMetadata(duplicateProjectPath)).toEqual({
        schemaVersion: 1,
        localProjectPath: duplicateProjectPath,
        projectName: 'reused-copy',
      })
      expect(
        (await getAllOutboxEntries()).filter(
          (entry) => entry.projectPath === duplicateProjectPath
        )
      ).toEqual([])
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            getFetchMethod(input, init) === 'DELETE' &&
            getFetchUrl(input).endsWith(`/${remoteProjectId}`)
        )
      ).toBe(false)
    } finally {
      releaseBlockerUpload?.()
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
      if (originalLocks) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocks)
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'locks')
      }
    }
  })

  it('supports fresh transactions when cloud persistence is unavailable', async () => {
    configureCloudSyncEngine({ enabled: false })
    const testIndexedDb = globalThis.indexedDB
    vi.stubGlobal('indexedDB', undefined)

    try {
      await expect(
        runCloudSyncWriteTransaction(
          '/documents/Projects/local-copy',
          async () => 'copied',
          { freshProjectIdentity: true }
        )
      ).resolves.toBe('copied')
    } finally {
      vi.stubGlobal('indexedDB', testIndexedDb)
    }
  })

  it('publishes the fresh identity before releasing the shared project lock', async () => {
    const lockedProjectPath = '/documents/Projects/locked-copy'
    const files = new Map<string, string>()
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({ enabled: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const lockTails = new Map<string, Promise<void>>()
    const request = async <T>(name: string, callback: () => Promise<T>) => {
      const previous = lockTails.get(name) ?? Promise.resolve()
      let releaseCurrent: (() => void) | undefined
      const current = new Promise<void>((resolve) => {
        releaseCurrent = resolve
      })
      lockTails.set(name, current)
      await previous
      try {
        return await callback()
      } finally {
        releaseCurrent?.()
        if (lockTails.get(name) === current) {
          lockTails.delete(name)
        }
      }
    }
    const originalLocks = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'locks'
    )
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: { request },
    })

    let releaseOperation: (() => void) | undefined
    let markOperationStarted: (() => void) | undefined
    const operationStarted = new Promise<void>((resolve) => {
      markOperationStarted = resolve
    })
    const operationGate = new Promise<void>((resolve) => {
      releaseOperation = resolve
    })

    try {
      configureCloudSyncEngine({
        enabled: true,
        syncExistingLocalProjects: true,
      })
      const transaction = runCloudSyncWriteTransaction(
        lockedProjectPath,
        async () => {
          markOperationStarted?.()
          await operationGate
          files.set(
            `${lockedProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
            'title = "Locked copy"\n'
          )
        },
        { freshProjectIdentity: true }
      )
      await operationStarted

      const waitingRenderer = request(
        `zds-cloud-sync:${lockedProjectPath}`,
        async () => ({
          metadata: await getCloudSyncProjectMetadata(lockedProjectPath),
          entries: (await getAllOutboxEntries()).filter(
            (entry) => entry.projectPath === lockedProjectPath
          ),
        })
      )

      releaseOperation?.()
      await transaction
      const { metadata: observedMetadata, entries: observedEntries } =
        await waitingRenderer

      expect(observedMetadata).toEqual({
        schemaVersion: 1,
        localProjectPath: lockedProjectPath,
        projectName: 'locked-copy',
      })
      expect(observedEntries).toEqual([
        expect.objectContaining({
          projectPath: lockedProjectPath,
          kind: 'upsert',
        }),
      ])
    } finally {
      releaseOperation?.()
      configureCloudSyncEngine({ enabled: false })
      vi.useRealTimers()
      if (originalLocks) {
        Object.defineProperty(globalThis.navigator, 'locks', originalLocks)
      } else {
        Reflect.deleteProperty(globalThis.navigator, 'locks')
      }
    }
  })

  it('forwards the three-argument directory publication through the observer', async () => {
    configureCloudSyncEngine({ enabled: false })
    const files = new Map<string, string>()
    const activeFs = createTestFs(files)
    const publishDirectory = vi.fn(async () => undefined)
    activeFs.publishDirectory = publishDirectory
    installCloudSyncFileSystemObserver(activeFs)
    const evidence = duplicatePublicationEvidence('target')

    await activeFs.publishDirectory(
      '/documents/Projects/source',
      '/documents/Projects/target',
      evidence
    )

    expect(publishDirectory).toHaveBeenCalledWith(
      '/documents/Projects/source',
      '/documents/Projects/target',
      evidence
    )
  })
})
