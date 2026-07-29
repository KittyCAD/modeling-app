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

vi.mock('@src/lib/cloudSync', () => ({
  cloudSyncStatus: { value: { enabled: false } },
  getCloudSyncProjectMetadataIndex: vi.fn(async () => new Map()),
  getCloudSyncProjectModifiedTime: vi.fn(
    (_metadata: unknown, modified: number | null) => modified
  ),
}))

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

describe('directory project scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.desktop.canReadWriteDirectory.mockResolvedValue({
      value: true,
      error: undefined,
    })
    mocks.desktop.mkdirOrNOOP.mockResolvedValue(undefined)
    mocks.fsZds.rename.mockResolvedValue(undefined)
  })

  it('rejects a project directory that is itself a project', async () => {
    mocks.fsZds.readdir.mockResolvedValue(['project.toml', 'nested-project'])

    await expect(
      readProjectsFromProjectDirectory({
        projectDirectoryPath: '/projects',
        wasmInstancePromise: Promise.resolve({} as ModuleType),
      })
    ).rejects.toThrow(
      'The project library "/projects" is also a project because it contains project.toml.'
    )
    expect(mocks.desktop.getProjectInfo).not.toHaveBeenCalled()
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
