import 'fake-indexeddb/auto'
import {
  cloudSyncStatus,
  cloudSyncRemoteProjects,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  disconnectCloudSyncProject,
  getCloudSyncProjectMetadata,
  moveCloudSyncProjectToDirectory,
  retryCloudSync,
  setCloudSyncProjectScope,
} from '@src/lib/cloudSync'
import {
  appendOutboxEntry,
  getAllOutboxEntries,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { webSafeJoin, webSafePathSplit } from '@src/lib/pathUtils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const syncDatabaseName = 'zds-opfs-cloud-sync'
const projectPath = '/documents/Projects/bracket'
const projectTomlPath = `${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`
const remoteProjectId = 'remote-project-123'
const remoteRevision = 'revision-123'
const remoteProjectUrl = `https://example.test/user/projects/${remoteProjectId}`

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
  function normalizeDirectory(path: string) {
    const normalizedPath = normalizePath(path)
    return normalizedPath === '/'
      ? normalizedPath
      : normalizedPath.replace(/\/$/g, '')
  }
  function copyPath(sourcePath: string, targetPath: string) {
    const normalizedSourcePath = normalizePath(sourcePath)
    const normalizedTargetPath = normalizePath(targetPath)
    if (directories.has(normalizedSourcePath)) {
      directories.add(normalizedTargetPath)
      for (const directory of Array.from(directories)) {
        if (!directory.startsWith(`${normalizedSourcePath}/`)) {
          continue
        }
        directories.add(
          `${normalizedTargetPath}${directory.slice(normalizedSourcePath.length)}`
        )
      }
      for (const [filePath, contents] of Array.from(files)) {
        if (!filePath.startsWith(`${normalizedSourcePath}/`)) {
          continue
        }
        files.set(
          `${normalizedTargetPath}${filePath.slice(normalizedSourcePath.length)}`,
          contents
        )
      }
      return
    }

    const contents = files.get(normalizedSourcePath)
    if (contents === undefined) {
      throw new Error('ENOENT')
    }
    directories.add(normalizeDirectory(dirname(normalizedTargetPath)))
    files.set(normalizedTargetPath, contents)
  }
  function removePath(path: string) {
    const normalizedPath = normalizePath(path)
    for (const directory of Array.from(directories)) {
      if (
        directory === normalizedPath ||
        directory.startsWith(`${normalizedPath}/`)
      ) {
        directories.delete(directory)
      }
    }
    for (const filePath of Array.from(files.keys())) {
      if (
        filePath === normalizedPath ||
        filePath.startsWith(`${normalizedPath}/`)
      ) {
        files.delete(filePath)
      }
    }
  }
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
    cp: async (sourcePath: string, targetPath: string) => {
      copyPath(sourcePath, targetPath)
    },
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
    rename: async (sourcePath: string, targetPath: string) => {
      copyPath(sourcePath, targetPath)
      removePath(sourcePath)
    },
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
    rm: async (path: string) => removePath(path),
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
})

describe('cloud sync upload failures', () => {
  beforeEach(async () => {
    await deleteSyncDatabase()
    installFetchMock()
  })

  afterEach(async () => {
    setCloudSyncProjectScope(undefined)
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteSyncDatabase()
  })

  it('records a blocked upload failure when the remote project is readable but not writable', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'cube = 1'],
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
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)

      if (url === remoteProjectUrl && method === 'GET') {
        return new Response(
          JSON.stringify({
            id: remoteProjectId,
            title: 'Bracket',
            revision: remoteRevision,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )
      }

      if (
        url === `${remoteProjectUrl}?expected_revision=${remoteRevision}` &&
        method === 'PUT'
      ) {
        return new Response(JSON.stringify({ message: 'Forbidden' }), {
          status: 403,
          statusText: 'Forbidden',
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

    configureCloudSyncEngine({
      enabled: false,
      baseUrl: 'https://example.test',
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: '/documents/Projects',
    })
    setCloudSyncProjectScope(projectPath)
    configureCloudSyncEngine({ enabled: true })
    retryCloudSync()
    await vi.waitFor(() => {
      expect(cloudSyncStatus.value.lastFailureKind).toBe(
        'remote-upload-forbidden'
      )
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `${remoteProjectUrl}?expected_revision=${remoteRevision}`,
      expect.objectContaining({
        credentials: 'include',
        method: 'PUT',
      })
    )
    await expect(getAllOutboxEntries()).resolves.toHaveLength(1)
    const metadata = await getCloudSyncProjectMetadata(projectPath)
    expect(metadata?.conflict).toBeUndefined()
    expect(metadata?.lastFailure).toMatchObject({
      kind: 'remote-upload-forbidden',
      message: expect.stringContaining('does not have edit access'),
    })
    expect(cloudSyncStatus.value).toMatchObject({
      state: 'failed',
      activeProjectPath: projectPath,
      lastFailureKind: 'remote-upload-forbidden',
      lastFailure: expect.stringContaining('does not have edit access'),
    })
  })
})

describe('moveCloudSyncProjectToDirectory', () => {
  beforeEach(async () => {
    await deleteSyncDatabase()
    installFetchMock()
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
    await deleteSyncDatabase()
  })

  it('moves a cloud-linked local project and rewrites sync metadata', async () => {
    const files = new Map([
      [
        projectTomlPath,
        `title = "Bracket"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
      ],
      [`${projectPath}/main.kcl`, 'cube(1)'],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    await seedLinkedProject()
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: `${projectPath}/main.kcl`,
      createdAt: '2026-07-08T12:00:00.000Z',
    })

    await expect(
      moveCloudSyncProjectToDirectory({
        projectPath,
        projectDirectoryPath: '/documents/Zoo/personal',
      })
    ).resolves.toEqual({
      projectPath: '/documents/Zoo/personal/bracket',
      projectName: 'bracket',
      remoteProjectId,
      remoteRevision,
    })

    expect(files.has(`${projectPath}/main.kcl`)).toBe(false)
    expect(files.get('/documents/Zoo/personal/bracket/main.kcl')).toBe(
      'cube(1)'
    )
    expect(await getCloudSyncProjectMetadata(projectPath)).toBeUndefined()
    expect(
      await getCloudSyncProjectMetadata('/documents/Zoo/personal/bracket')
    ).toMatchObject({
      localProjectPath: '/documents/Zoo/personal/bracket',
      projectName: 'bracket',
      remoteProjectId,
      remoteRevision,
    })
    expect(await getAllOutboxEntries()).toEqual([
      expect.objectContaining({
        projectPath: '/documents/Zoo/personal/bracket',
        kind: 'upsert',
        targetPath: '/documents/Zoo/personal/bracket',
        sourcePath: projectPath,
      }),
    ])
  })
})
