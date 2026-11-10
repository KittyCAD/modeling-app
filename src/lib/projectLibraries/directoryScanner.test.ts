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

vi.mock('@src/lib/desktop', () => mocks.desktop)

vi.mock('@src/lib/fs-zds', () => ({
  default: mocks.fsZds,
}))

vi.mock('@src/lib/trap', () => mocks.trap)

import { readProjectsFromProjectDirectory } from '@src/lib/projectLibraries/directoryScanner'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

const fileOperations = {
  readDirectory: mocks.fsZds.readdir,
  stat: async (path: string) => {
    const stat = await mocks.fsZds.stat(path)
    return {
      kind: stat.mode & fsZdsConstants.S_IFDIR ? 'directory' : 'file',
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
      accessedAt: stat.atimeMs,
      modifiedAt: stat.mtimeMs,
      changedAt: stat.ctimeMs,
      createdAt: stat.birthtimeMs,
    }
  },
  rename: mocks.fsZds.rename,
  remove: (path: string) => mocks.fsZds.rm(path, { recursive: true }),
} as unknown as FileOperationsRegistryService

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
      fileOperations,
      projectDirectoryPath: '/projects',
      wasmInstancePromise: Promise.resolve({} as ModuleType),
      onProjectStatFailures,
    })

    expect(projects).toEqual([])
    expect(mocks.fsZds.stat).toHaveBeenCalledTimes(3)
    expect(onProjectStatFailures).toHaveBeenCalledOnce()
    expect(onProjectStatFailures).toHaveBeenCalledWith({
      error: statFailure,
      count: 2,
    })
  })

  it('lists projects without moving directories to match their titles', async () => {
    const project = createProject()
    mocks.fsZds.readdir.mockResolvedValue(['stale-id'])
    mocks.fsZds.stat.mockResolvedValue(dirStat(1))
    mocks.desktop.getProjectInfo.mockResolvedValue(project)
    const projects = await readProjectsFromProjectDirectory({
      fileOperations,
      projectDirectoryPath: '/projects',
      wasmInstancePromise: Promise.resolve({} as ModuleType),
    })
    expect(projects).toEqual([project])
    expect(mocks.fsZds.rename).not.toHaveBeenCalled()
    expect(mocks.fsZds.rm).not.toHaveBeenCalled()
    expect(mocks.fsZds.writeFile).not.toHaveBeenCalled()
  })
})
