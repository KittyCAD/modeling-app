import { getCloudSyncProjectMetadataIndex } from '@src/lib/cloudSync'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import type { Project } from '@src/lib/project'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const pathNotFound = () =>
    Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  const join = (...parts: string[]) => {
    let joinedPath = ''
    for (const part of parts) {
      if (!part) {
        continue
      }
      if (!joinedPath) {
        joinedPath = part
        continue
      }
      joinedPath = `${joinedPath.replace(/\/+$/g, '')}/${part.replace(
        /^\/+/g,
        ''
      )}`
    }

    return joinedPath.replace(/\/$/g, '')
  }
  const dirname = (path: string) => {
    const normalizedPath = path.replace(/\/+$/g, '')
    const lastSeparatorIndex = normalizedPath.lastIndexOf('/')

    if (lastSeparatorIndex <= 0) {
      return '/'
    }

    return normalizedPath.slice(0, lastSeparatorIndex)
  }

  return {
    pathNotFound,
    desktop: {
      canReadWriteDirectory: vi.fn(),
      getProjectInfo: vi.fn(),
      isPathNotFoundError: vi.fn((error: unknown) => {
        return (
          error === 'ENOENT' ||
          (typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT')
        )
      }),
      mkdirOrNOOP: vi.fn(),
    },
    cloudSyncDb: {
      clearLegacyConflictCopyReferences: vi.fn(),
      clearOutboxEntriesTouchingProject: vi.fn(),
      deleteProjectMetadata: vi.fn(),
    },
    clientErrorReporting: {
      reportCloudSyncConflictCopyDetected: vi.fn(),
    },
    fsZds: {
      cp: vi.fn(),
      dirname: vi.fn(dirname),
      join: vi.fn(join),
      readdir: vi.fn(),
      rename: vi.fn(),
      rm: vi.fn(),
      stat: vi.fn(),
      writeFile: vi.fn(),
    },
    trap: {
      reportRejection: vi.fn(),
    },
  }
})

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

vi.mock('@src/lib/cloudSync', () => ({
  cloudSyncStatus: { value: { enabled: true } },
  getCloudSyncProjectMetadataIndex: vi.fn(async () => new Map()),
  getCloudSyncProjectModifiedTime: vi.fn(
    (_metadata: unknown, modified: number | null) => modified
  ),
}))

vi.mock('@src/lib/cloudSync/syncDb', () => mocks.cloudSyncDb)

vi.mock(
  '@src/lib/cloudSync/clientErrorReporting',
  () => mocks.clientErrorReporting
)

vi.mock('@src/lib/desktop', () => mocks.desktop)

vi.mock('@src/lib/fs-zds', () => ({
  default: mocks.fsZds,
}))

vi.mock('@src/lib/trap', () => mocks.trap)

import {
  readProjectsFromProjectDirectory,
  scheduleProjectDirectoryNameSyncFromTitles,
  syncProjectDirectoryNameFromTitle,
} from '@src/lib/projectLibraries/directoryScanner'

function dirStat(ino: number) {
  const date = new Date(0)
  return {
    dev: 1,
    ino,
    mode: fsZdsConstants.S_IFDIR,
    nlink: 1,
    uid: 1,
    gid: 1,
    rdev: 1,
    size: 1,
    blksize: 1,
    blocks: 1,
    atimeMs: 1,
    mtimeMs: 1,
    ctimeMs: 1,
    birthtimeMs: 1,
    atime: date,
    mtime: date,
    ctime: date,
    birthtime: date,
  }
}

function createProject(overrides: Partial<Project> = {}): Project {
  const name = overrides.name ?? 'stale-id'
  const path = overrides.path ?? `/projects/${name}`
  return {
    name,
    path,
    title: 'My Cool Project',
    children: [],
    default_file: `${path}/main.kcl`,
    directory_count: 0,
    kcl_file_count: 1,
    metadata: null,
    readWriteAccess: true,
    ...overrides,
  }
}

function createLegacyConflictCopyMetadata(conflictCopyPath: string) {
  const projectName = conflictCopyPath.slice(
    conflictCopyPath.lastIndexOf('/') + 1
  )
  return {
    schemaVersion: 1,
    localProjectPath: conflictCopyPath,
    projectName,
    remoteProjectId: 'remote-123',
    hasPendingChanges: false,
    syncExcluded: {
      reason: 'conflict-copy',
      sourceProjectPath: '/projects/normal',
      remoteProjectId: 'remote-123',
      createdAt: '2026-07-17T12:00:00.000Z',
    },
  } as const
}

describe('directory project scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCloudSyncProjectMetadataIndex).mockResolvedValue(new Map())
    mocks.desktop.canReadWriteDirectory.mockResolvedValue({
      value: true,
      error: undefined,
    })
    mocks.desktop.mkdirOrNOOP.mockResolvedValue(undefined)
    mocks.fsZds.rename.mockResolvedValue(undefined)
    mocks.fsZds.rm.mockResolvedValue(undefined)
  })

  it('aggregates non-missing project stat failures', async () => {
    const statFailure = Object.assign(new Error('Permission denied'), {
      code: 'EACCES',
    })
    const onProjectStatFailures = vi.fn()

    mocks.fsZds.readdir.mockResolvedValue([
      'missing-project',
      'blocked-project-one',
      'blocked-project-two',
    ])
    mocks.fsZds.stat.mockImplementation(async (path: string) => {
      if (path === '/projects/missing-project') {
        throw mocks.pathNotFound()
      }
      throw statFailure
    })

    const projects = await readProjectsFromProjectDirectory({
      projectDirectoryPath: '/projects',
      wasmInstancePromise: Promise.resolve({} as ModuleType),
      onProjectStatFailures,
    })

    expect(projects).toEqual([])
    expect(onProjectStatFailures).toHaveBeenCalledOnce()
    expect(onProjectStatFailures).toHaveBeenCalledWith({
      error: statFailure,
      count: 2,
    })
  })

  it('schedules stale project directory name syncs after the scan returns', async () => {
    const project = createProject()
    let finishRename: () => void = () => undefined

    mocks.fsZds.readdir.mockResolvedValue(['stale-id'])
    mocks.fsZds.stat.mockImplementation(async (path: string) => {
      if (path === '/projects/stale-id') {
        return dirStat(1)
      }
      throw mocks.pathNotFound()
    })
    mocks.fsZds.rename.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRename = resolve
        })
    )
    mocks.desktop.getProjectInfo.mockResolvedValue(project)
    const onProjectDirectoriesRenamed = vi.fn()

    const projects = await readProjectsFromProjectDirectory({
      projectDirectoryPath: '/projects',
      wasmInstancePromise: Promise.resolve({} as ModuleType),
    })

    expect(projects).toEqual([project])
    expect(mocks.fsZds.rename).not.toHaveBeenCalled()

    scheduleProjectDirectoryNameSyncFromTitles({
      projects,
      onProjectDirectoriesRenamed,
    })

    await vi.waitFor(() =>
      expect(mocks.fsZds.rename).toHaveBeenCalledWith(
        '/projects/stale-id',
        '/projects/my-cool-project'
      )
    )
    expect(onProjectDirectoriesRenamed).not.toHaveBeenCalled()

    finishRename()

    await vi.waitFor(() =>
      expect(onProjectDirectoriesRenamed).toHaveBeenCalledTimes(1)
    )
  })

  it('deletes legacy cloud conflict-copy projects marked as sync-excluded', async () => {
    const project = createProject({
      name: 'normal',
      path: '/projects/normal',
    })
    const conflictCopyPath = '/projects/normal (cloud conflict 20260717T120000)'

    vi.mocked(getCloudSyncProjectMetadataIndex).mockResolvedValue(
      new Map([
        [conflictCopyPath, createLegacyConflictCopyMetadata(conflictCopyPath)],
      ])
    )
    mocks.fsZds.readdir.mockResolvedValue([
      'normal',
      'normal (cloud conflict 20260717T120000)',
    ])
    mocks.fsZds.stat.mockImplementation(async (path: string) => {
      if (path === '/projects/normal') {
        return dirStat(1)
      }
      if (path === conflictCopyPath) {
        return dirStat(2)
      }
      throw mocks.pathNotFound()
    })
    mocks.desktop.getProjectInfo.mockResolvedValue(project)

    const projects = await readProjectsFromProjectDirectory({
      projectDirectoryPath: '/projects',
      wasmInstancePromise: Promise.resolve({} as ModuleType),
    })

    expect(projects).toEqual([project])
    expect(mocks.desktop.getProjectInfo).toHaveBeenCalledWith(
      '/projects/normal',
      expect.anything()
    )
    expect(mocks.desktop.getProjectInfo).not.toHaveBeenCalledWith(
      conflictCopyPath,
      expect.anything()
    )
    expect(mocks.fsZds.rm).toHaveBeenCalledWith(conflictCopyPath, {
      recursive: true,
    })
    expect(
      mocks.cloudSyncDb.clearOutboxEntriesTouchingProject
    ).toHaveBeenCalledWith(conflictCopyPath)
    expect(
      mocks.cloudSyncDb.clearLegacyConflictCopyReferences
    ).toHaveBeenCalledWith(conflictCopyPath)
    expect(mocks.cloudSyncDb.deleteProjectMetadata).toHaveBeenCalledWith(
      conflictCopyPath
    )
    expect(
      mocks.clientErrorReporting.reportCloudSyncConflictCopyDetected
    ).toHaveBeenCalledTimes(1)
  })

  it('keeps legacy cloud conflict-copy metadata when folder deletion fails', async () => {
    const project = createProject({
      name: 'normal',
      path: '/projects/normal',
    })
    const conflictCopyPath = '/projects/normal (cloud conflict 20260717T120000)'
    const deleteError = Object.assign(new Error('EPERM'), { code: 'EPERM' })

    vi.mocked(getCloudSyncProjectMetadataIndex).mockResolvedValue(
      new Map([
        [conflictCopyPath, createLegacyConflictCopyMetadata(conflictCopyPath)],
      ])
    )
    mocks.fsZds.readdir.mockResolvedValue([
      'normal',
      'normal (cloud conflict 20260717T120000)',
    ])
    mocks.fsZds.stat.mockImplementation(async (path: string) => {
      if (path === '/projects/normal') {
        return dirStat(1)
      }
      if (path === conflictCopyPath) {
        return dirStat(2)
      }
      throw mocks.pathNotFound()
    })
    mocks.fsZds.rm.mockRejectedValue(deleteError)
    mocks.desktop.getProjectInfo.mockResolvedValue(project)

    const projects = await readProjectsFromProjectDirectory({
      projectDirectoryPath: '/projects',
      wasmInstancePromise: Promise.resolve({} as ModuleType),
    })

    expect(projects).toEqual([project])
    expect(mocks.desktop.getProjectInfo).not.toHaveBeenCalledWith(
      conflictCopyPath,
      expect.anything()
    )
    expect(mocks.trap.reportRejection).toHaveBeenCalledWith(deleteError)
    expect(
      mocks.cloudSyncDb.clearOutboxEntriesTouchingProject
    ).not.toHaveBeenCalled()
    expect(
      mocks.cloudSyncDb.clearLegacyConflictCopyReferences
    ).not.toHaveBeenCalled()
    expect(mocks.cloudSyncDb.deleteProjectMetadata).not.toHaveBeenCalled()
    expect(
      mocks.clientErrorReporting.reportCloudSyncConflictCopyDetected
    ).not.toHaveBeenCalled()
  })

  it('batches scheduled directory name sync refreshes', async () => {
    const onProjectDirectoriesRenamed = vi.fn()
    const projects = [
      createProject({
        name: 'stale-one',
        path: '/projects/stale-one',
        title: 'First Project',
      }),
      createProject({
        name: 'stale-two',
        path: '/projects/stale-two',
        title: 'Second Project',
      }),
    ]

    mocks.fsZds.readdir.mockResolvedValue(['stale-one', 'stale-two'])
    mocks.fsZds.stat.mockImplementation(async (path: string) => {
      if (path === '/projects/stale-one') {
        return dirStat(1)
      }
      if (path === '/projects/stale-two') {
        return dirStat(2)
      }
      throw mocks.pathNotFound()
    })

    scheduleProjectDirectoryNameSyncFromTitles({
      projects,
      onProjectDirectoriesRenamed,
    })

    await vi.waitFor(() => expect(mocks.fsZds.rename).toHaveBeenCalledTimes(2))
    expect(mocks.fsZds.rename).toHaveBeenCalledWith(
      '/projects/stale-one',
      '/projects/first-project'
    )
    expect(mocks.fsZds.rename).toHaveBeenCalledWith(
      '/projects/stale-two',
      '/projects/second-project'
    )
    await vi.waitFor(() =>
      expect(onProjectDirectoriesRenamed).toHaveBeenCalledTimes(1)
    )
  })

  it('reports rename failures without stopping the batch or risking project data', async () => {
    const renameFailure = new Error('Permission denied')
    const onProjectDirectoriesRenamed = vi.fn()
    const projects = [
      createProject({
        name: 'stale-one',
        path: '/projects/stale-one',
        title: 'First Project',
      }),
      createProject({
        name: 'stale-two',
        path: '/projects/stale-two',
        title: 'Second Project',
      }),
    ]

    mocks.fsZds.readdir.mockResolvedValue(['stale-one', 'stale-two'])
    mocks.fsZds.stat.mockImplementation(async (path: string) => {
      if (path === '/projects/stale-one') {
        return dirStat(1)
      }
      if (path === '/projects/stale-two') {
        return dirStat(2)
      }
      throw mocks.pathNotFound()
    })
    mocks.fsZds.rename.mockImplementation(async (sourcePath: string) => {
      if (sourcePath === '/projects/stale-one') {
        throw renameFailure
      }
    })

    scheduleProjectDirectoryNameSyncFromTitles({
      projects,
      onProjectDirectoriesRenamed,
    })

    await vi.waitFor(() => expect(mocks.fsZds.rename).toHaveBeenCalledTimes(2))
    expect(mocks.trap.reportRejection).toHaveBeenCalledWith(renameFailure)
    expect(mocks.fsZds.rename).toHaveBeenCalledWith(
      '/projects/stale-one',
      '/projects/first-project'
    )
    expect(mocks.fsZds.rename).toHaveBeenCalledWith(
      '/projects/stale-two',
      '/projects/second-project'
    )
    expect(onProjectDirectoriesRenamed).toHaveBeenCalledTimes(1)
    expect(mocks.fsZds.cp).not.toHaveBeenCalled()
    expect(mocks.fsZds.rm).not.toHaveBeenCalled()
    expect(mocks.fsZds.writeFile).not.toHaveBeenCalled()
  })

  it('uses a unique unix-friendly directory name when the title slug is occupied', async () => {
    mocks.fsZds.stat.mockImplementation(async (path: string) => {
      if (path === '/projects/stale-id') {
        return dirStat(1)
      }
      if (path === '/projects/my-cool-project-1') {
        throw mocks.pathNotFound()
      }
      return dirStat(2)
    })

    const targetProjectDirectoryName = await syncProjectDirectoryNameFromTitle({
      project: createProject(),
      projectDirectoryEntryNames: ['stale-id', 'my-cool-project'],
    })

    expect(targetProjectDirectoryName).toBe('my-cool-project-1')
    expect(mocks.fsZds.rename).toHaveBeenCalledWith(
      '/projects/stale-id',
      '/projects/my-cool-project-1'
    )
  })

  it('falls back to the default project directory name when the title cannot be slugged', async () => {
    mocks.fsZds.stat.mockImplementation(async (path: string) => {
      if (path === '/projects/stale-id') {
        return dirStat(1)
      }
      throw mocks.pathNotFound()
    })

    const targetProjectDirectoryName = await syncProjectDirectoryNameFromTitle({
      project: createProject({ title: '!!!' }),
      projectDirectoryEntryNames: ['stale-id'],
    })

    expect(targetProjectDirectoryName).toBe('untitled')
    expect(mocks.fsZds.rename).toHaveBeenCalledWith(
      '/projects/stale-id',
      '/projects/untitled'
    )
  })

  it('does not rename when the project directory already matches the title', async () => {
    const targetProjectDirectoryName = await syncProjectDirectoryNameFromTitle({
      project: createProject({
        name: 'my-cool-project',
        path: '/projects/my-cool-project',
      }),
      projectDirectoryEntryNames: ['my-cool-project'],
    })

    expect(targetProjectDirectoryName).toBeUndefined()
    expect(mocks.fsZds.rename).not.toHaveBeenCalled()
    expect(mocks.fsZds.stat).not.toHaveBeenCalled()
  })
})
