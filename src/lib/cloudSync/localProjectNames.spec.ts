import 'fake-indexeddb/auto'
import {
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  ensureCloudProjectLocallySynced,
  getCloudSyncProjectMetadata,
  scheduleCloudProjectDirectoryNameSyncFromTitles,
} from '@src/lib/cloudSync'
import {
  getAllOutboxEntries,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { webSafeJoin, webSafePathSplit } from '@src/lib/pathUtils'
import type * as TrapModule from '@src/lib/trap'
import { reportRejection } from '@src/lib/trap'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/trap', async (importOriginal) => {
  const actual = await importOriginal<typeof TrapModule>()
  return {
    ...actual,
    reportRejection: vi.fn(),
  }
})

const syncDatabaseName = 'zds-opfs-cloud-sync'
const baseUrl = 'https://example.test'
const projectDirectory = '/documents/Projects'
const remoteProjectId = 'remote-project-123'
const remoteProjectUrl = `${baseUrl}/user/projects/${remoteProjectId}`
const remoteProjectDownloadUrl = `${remoteProjectUrl}/download?format=zip`

const fetchMock = vi.fn<typeof fetch>()

function normalizePath(path: string) {
  const normalized = path.replace(/\/+/g, '/')
  if (!normalized || normalized === '/') {
    return '/'
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function joinPaths(...parts: string[]) {
  return normalizePath(webSafeJoin(parts))
}

function dirname(path: string) {
  const parts = webSafePathSplit(normalizePath(path)).filter(Boolean)
  return parts.length <= 1 ? '/' : joinPaths(...parts.slice(0, -1))
}

function basename(path: string) {
  return webSafePathSplit(normalizePath(path)).filter(Boolean).at(-1) || ''
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

function pathNotFound() {
  return Promise.reject('ENOENT')
}

function createTestFs(
  files: Map<string, string>,
  options: { failRenames?: boolean } = {}
) {
  const directories = new Set<string>()
  const addDirectory = (path: string) => {
    const parts = webSafePathSplit(normalizePath(path)).filter(Boolean)
    directories.add('/')
    for (let index = 0; index < parts.length; index += 1) {
      directories.add(joinPaths(...parts.slice(0, index + 1)))
    }
  }

  addDirectory(projectDirectory)
  for (const path of files.keys()) {
    addDirectory(dirname(path))
  }

  const movePath = (path: string, source: string, target: string) =>
    path === source
      ? target
      : path.startsWith(`${source}/`)
        ? `${target}${path.slice(source.length)}`
        : path

  return {
    resolve: joinPaths,
    join: joinPaths,
    relative: (from: string, to: string) => {
      const normalizedFrom = normalizePath(from)
      const normalizedTo = normalizePath(to)
      return normalizedTo === normalizedFrom
        ? ''
        : normalizedTo.replace(`${normalizedFrom}/`, '')
    },
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
        return pathNotFound()
      }
    },
    cp: async () => undefined,
    readFile: async (
      path: string,
      options?: { encoding?: string } | string
    ) => {
      const contents = files.get(normalizePath(path))
      if (contents === undefined) {
        return pathNotFound()
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
      if (options.failRenames) {
        throw new Error('rename failed')
      }

      const source = normalizePath(sourcePath)
      const target = normalizePath(targetPath)
      if (directories.has(source)) {
        const movedDirectories = [...directories]
          .filter((path) => path === source || path.startsWith(`${source}/`))
          .map((path) => [path, movePath(path, source, target)] as const)
        const movedFiles = [...files.entries()]
          .filter(([path]) => path === source || path.startsWith(`${source}/`))
          .map(
            ([path, contents]) =>
              [path, movePath(path, source, target), contents] as const
          )

        for (const [path] of movedDirectories) {
          directories.delete(path)
        }
        for (const [path] of movedFiles) {
          files.delete(path)
        }
        for (const [, nextPath] of movedDirectories) {
          directories.add(nextPath)
        }
        for (const [, nextPath, contents] of movedFiles) {
          files.set(nextPath, contents)
        }
        return
      }

      const contents = files.get(source)
      if (contents === undefined) {
        return pathNotFound()
      }
      files.delete(source)
      files.set(target, contents)
    },
    writeFile: async (path: string, data: Uint8Array | string) => {
      files.set(
        normalizePath(path),
        typeof data === 'string' ? data : new TextDecoder().decode(data)
      )
    },
    readdir: async (path: string) => {
      const normalizedPath = normalizePath(path)
      if (!directories.has(normalizedPath)) {
        return pathNotFound()
      }

      const children = new Set<string>()
      for (const entry of [...directories, ...files.keys()]) {
        if (entry !== normalizedPath && dirname(entry) === normalizedPath) {
          children.add(basename(entry))
        }
      }
      return [...children]
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
      return pathNotFound()
    },
    mkdir: async (path: string) => {
      addDirectory(path)
    },
    rm: async (path: string) => {
      const normalizedPath = normalizePath(path)
      for (const directory of [...directories]) {
        if (
          directory === normalizedPath ||
          directory.startsWith(`${normalizedPath}/`)
        ) {
          directories.delete(directory)
        }
      }
      for (const file of [...files.keys()]) {
        if (file === normalizedPath || file.startsWith(`${normalizedPath}/`)) {
          files.delete(file)
        }
      }
    },
    detach: async () => undefined,
    attach: async () => undefined,
  } as IZooDesignStudioFS
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

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetchMock() {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = getFetchUrl(input)
    const method = getFetchMethod(input, init)

    if (url === `${baseUrl}/user/projects` && method === 'GET') {
      return jsonResponse([])
    }
    if (url === remoteProjectUrl && method === 'GET') {
      return jsonResponse({
        id: remoteProjectId,
        title: 'Café Bracket / v2',
        revision: 'rev-1',
      })
    }
    if (url === remoteProjectDownloadUrl && method === 'GET') {
      return jsonResponse({
        files: [{ relativePath: 'main.kcl', contents: 'x = 1' }],
      })
    }

    return jsonResponse({ message: `Unexpected fetch: ${method} ${url}` }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function deleteSyncDatabase() {
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

describe('cloud sync local project names', () => {
  beforeEach(async () => {
    await deleteSyncDatabase()
    installFetchMock()
    vi.mocked(reportRejection).mockClear()
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    configureCloudSyncLocalFileSystem(createTestFs(new Map()))
    vi.unstubAllGlobals()
    await deleteSyncDatabase()
  })

  it('materializes remote projects with a Unix-friendly directory name from the title', async () => {
    const files = new Map<string, string>()
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: projectDirectory,
      syncExistingLocalProjects: false,
    })

    const project = await ensureCloudProjectLocallySynced(
      remoteProjectId,
      projectDirectory
    )

    const expectedProjectPath = `${projectDirectory}/cafe-bracket-v2`
    expect(project).toMatchObject({
      projectPath: expectedProjectPath,
      projectName: 'cafe-bracket-v2',
      remoteProjectId,
    })
    expect(files.get(`${expectedProjectPath}/main.kcl`)).toBe('x = 1')
    expect(
      files.get(`${expectedProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`)
    ).toContain(`project_id = "${remoteProjectId}"`)
    expect(
      await getCloudSyncProjectMetadata(expectedProjectPath)
    ).toMatchObject({
      localProjectPath: expectedProjectPath,
      projectName: 'cafe-bracket-v2',
      remoteProjectId,
    })
  })

  it('renames existing ID-based cloud project folders and rekeys metadata', async () => {
    const idProjectPath = `${projectDirectory}/${remoteProjectId}`
    const titleProjectPath = `${projectDirectory}/cafe-bracket-v2`
    const files = new Map([
      [`${idProjectPath}/main.kcl`, 'x = 1'],
      [
        `${idProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        `title = "Café Bracket / v2"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(createTestFs(files))
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: projectDirectory,
      syncExistingLocalProjects: false,
    })
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: idProjectPath,
      projectName: remoteProjectId,
      remoteProjectId,
    })
    const onProjectDirectoriesRenamed = vi.fn()

    scheduleCloudProjectDirectoryNameSyncFromTitles({
      projects: [
        {
          path: idProjectPath,
          name: remoteProjectId,
          title: 'Café Bracket / v2',
          readWriteAccess: true,
        },
      ],
      onProjectDirectoriesRenamed,
    })

    await vi.waitFor(() =>
      expect(onProjectDirectoriesRenamed).toHaveBeenCalled()
    )

    expect(files.get(`${titleProjectPath}/main.kcl`)).toBe('x = 1')
    expect(files.has(`${idProjectPath}/main.kcl`)).toBe(false)
    expect(await getCloudSyncProjectMetadata(idProjectPath)).toBeUndefined()
    expect(await getCloudSyncProjectMetadata(titleProjectPath)).toMatchObject({
      localProjectPath: titleProjectPath,
      projectName: 'cafe-bracket-v2',
      remoteProjectId,
    })
    expect(await getAllOutboxEntries()).toEqual([])
    expect(onProjectDirectoriesRenamed).toHaveBeenCalledTimes(1)
  })

  it('leaves data and metadata in place when a cloud project directory rename fails', async () => {
    const idProjectPath = `${projectDirectory}/${remoteProjectId}`
    const titleProjectPath = `${projectDirectory}/cafe-bracket-v2`
    const files = new Map([
      [`${idProjectPath}/main.kcl`, 'x = 1'],
      [
        `${idProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        `title = "Café Bracket / v2"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createTestFs(files, { failRenames: true })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: projectDirectory,
      syncExistingLocalProjects: false,
    })
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: idProjectPath,
      projectName: remoteProjectId,
      remoteProjectId,
    })
    const onProjectDirectoriesRenamed = vi.fn()

    scheduleCloudProjectDirectoryNameSyncFromTitles({
      projects: [
        {
          path: idProjectPath,
          name: remoteProjectId,
          title: 'Café Bracket / v2',
          readWriteAccess: true,
        },
      ],
      onProjectDirectoriesRenamed,
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(files.get(`${idProjectPath}/main.kcl`)).toBe('x = 1')
    expect(files.has(`${titleProjectPath}/main.kcl`)).toBe(false)
    expect(await getCloudSyncProjectMetadata(idProjectPath)).toMatchObject({
      localProjectPath: idProjectPath,
      projectName: remoteProjectId,
      remoteProjectId,
    })
    expect(await getCloudSyncProjectMetadata(titleProjectPath)).toBeUndefined()
    expect(onProjectDirectoriesRenamed).not.toHaveBeenCalled()
    expect(reportRejection).toHaveBeenCalledWith(expect.any(Error))
  })
})
