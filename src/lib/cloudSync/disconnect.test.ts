import {
  cloudSyncRemoteProjects,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  disconnectCloudSyncProject,
  getCloudSyncProjectMetadata,
} from '@src/lib/cloudSync'
import { CloudApiError } from '@src/lib/cloudSync/cloudApi'
import {
  appendOutboxEntry,
  getAllOutboxEntries,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import type {
  CloudSyncProjectMetadataIndexEntry,
  OutboxEntry,
  ProjectMetadata,
} from '@src/lib/cloudSync/types'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { webSafeJoin, webSafePathSplit } from '@src/lib/pathUtils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cloudApiMocks = vi.hoisted(() => ({
  deleteRemoteProject: vi.fn<() => Promise<void>>(),
}))

const syncDbMocks = vi.hoisted(() => {
  const projects = new Map<string, ProjectMetadata>()
  const outboxEntries: OutboxEntry[] = []
  let nextOutboxId = 1
  const normalize = (path: string) =>
    path.replace(/\\/g, '/').replace(/\/+/g, '/')

  return {
    reset: () => {
      projects.clear()
      outboxEntries.splice(0, outboxEntries.length)
      nextOutboxId = 1
    },
    getProjectMetadata: vi.fn(async (projectPath: string) =>
      projects.get(normalize(projectPath))
    ),
    getCloudSyncProjectMetadata: vi.fn(async (projectPath: string) =>
      projects.get(normalize(projectPath))
    ),
    getCloudSyncProjectMetadataIndex: vi.fn(async () => {
      const pendingProjectPaths = new Set(
        outboxEntries.map((entry) => normalize(entry.projectPath))
      )
      return new Map<string, CloudSyncProjectMetadataIndexEntry>(
        [...projects.values()].map((metadata) => [
          normalize(metadata.localProjectPath),
          {
            ...metadata,
            hasPendingChanges:
              pendingProjectPaths.has(normalize(metadata.localProjectPath)) ||
              Boolean(metadata.tombstone),
          },
        ])
      )
    }),
    putProjectMetadata: vi.fn(async (metadata: ProjectMetadata) => {
      const normalizedProjectPath = normalize(metadata.localProjectPath)
      projects.set(normalizedProjectPath, {
        ...metadata,
        localProjectPath: normalizedProjectPath,
      })
    }),
    deleteProjectMetadata: vi.fn(async (projectPath: string) => {
      projects.delete(normalize(projectPath))
    }),
    getAllProjectMetadata: vi.fn(async () => [...projects.values()]),
    appendOutboxEntry: vi.fn(async (entry: Omit<OutboxEntry, 'id'>) => {
      outboxEntries.push({
        ...entry,
        id: nextOutboxId,
      })
      nextOutboxId += 1
    }),
    getAllOutboxEntries: vi.fn(async () => [...outboxEntries]),
    clearOutboxEntriesForProject: vi.fn(async (projectPath: string) => {
      const normalizedProjectPath = normalize(projectPath)
      const remainingEntries = outboxEntries.filter(
        (entry) => normalize(entry.projectPath) !== normalizedProjectPath
      )
      outboxEntries.splice(0, outboxEntries.length, ...remainingEntries)
    }),
  }
})

vi.mock('@src/lib/cloudSync/cloudApi', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    deleteRemoteProject: cloudApiMocks.deleteRemoteProject,
  }
})

vi.mock('@src/lib/cloudSync/syncDb', () => syncDbMocks)

const projectPath = '/documents/Projects/bracket'
const projectTomlPath = `${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`
const remoteProjectId = 'remote-project-123'
const remoteRevision = 'revision-123'

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
  beforeEach(() => {
    syncDbMocks.reset()
    cloudApiMocks.deleteRemoteProject.mockReset()
    cloudSyncRemoteProjects.value = [{ id: remoteProjectId }]
    configureCloudSyncEngine({
      enabled: true,
      baseUrl: 'https://example.test',
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: '/documents/Projects',
    })
  })

  afterEach(() => {
    configureCloudSyncEngine({ enabled: false })
    syncDbMocks.reset()
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
      cloudApiMocks.deleteRemoteProject.mockImplementation(
        () =>
          new Promise<void>((deleteResolve) => {
            finishDelete = deleteResolve
            resolve()
          })
      )
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
    cloudApiMocks.deleteRemoteProject.mockRejectedValue(
      new CloudApiError(500, 'Remote delete failed.')
    )

    await expect(disconnectCloudSyncProject(projectPath)).rejects.toThrow(
      'Remote delete failed.'
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
