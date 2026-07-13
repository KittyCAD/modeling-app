import { createSystemIOService } from '@src/lib/systemIO'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  canReadWriteDirectory: vi.fn(async () => ({ value: true, error: undefined })),
  getProjectInfo: vi.fn(),
  mkdirOrNOOP: vi.fn(async () => undefined),
  readdir: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('@src/lib/cloudSync', () => ({
  cloudSyncStatus: { value: { enabled: false } },
  getCloudSyncProjectMetadataIndex: vi.fn(async () => new Map()),
  getCloudSyncProjectModifiedTime: vi.fn(
    (_metadata: unknown, modified: number | undefined) => modified
  ),
}))

vi.mock('@src/lib/desktop', () => ({
  canReadWriteDirectory: mocks.canReadWriteDirectory,
  createNewProjectDirectory: vi.fn(),
  ensureProjectDirectoryExists: vi.fn(),
  getProjectInfo: mocks.getProjectInfo,
  mkdirOrNOOP: mocks.mkdirOrNOOP,
  readAppSettingsFile: vi.fn(),
  renameProjectDirectory: vi.fn(),
  writeProjectTitleToProjectToml: vi.fn(),
}))

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    extname: (path: string) => {
      const lastDot = path.lastIndexOf('.')
      return lastDot >= 0 ? path.slice(lastDot) : ''
    },
    join: (...parts: string[]) =>
      parts.filter(Boolean).reduce((path, part) => {
        return path ? `${path}/${part}` : part
      }, ''),
    readFile: vi.fn(async () => Promise.reject('ENOENT')),
    readdir: mocks.readdir,
    stat: mocks.stat,
    writeFile: mocks.writeFile,
  },
}))

async function flushUntil(predicate: () => boolean) {
  for (let index = 0; index < 20; index++) {
    if (predicate()) {
      return
    }
    await Promise.resolve()
  }
}

describe('systemIOService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('coalesces duplicate shallow local project index requests without recursively loading projects', async () => {
    let releaseReaddir: ((entries: string[]) => void) | undefined
    mocks.readdir.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          releaseReaddir = resolve
        })
    )
    mocks.stat.mockImplementation(async (path: string) => ({
      mode: 0o040000,
      mtimeMs: path.endsWith('alpha') ? 20 : 10,
    }))

    const systemIO = createSystemIOService({
      wasmPromise: Promise.resolve({} as never),
      getProjectDirectoryPath: () => '/projects',
      getDefaultProjectName: () => 'untitled',
      getOpenedProject: () => undefined,
    })

    const first = systemIO.refreshLocalProjects('/projects')
    const second = systemIO.refreshLocalProjects('/projects')
    for (let i = 0; i < 10 && !releaseReaddir; i++) {
      await Promise.resolve()
    }
    expect(releaseReaddir).toBeDefined()
    releaseReaddir?.(['alpha', 'beta'])

    const [firstEntries, secondEntries] = await Promise.all([first, second])

    expect(mocks.readdir).toHaveBeenCalledTimes(1)
    expect(mocks.getProjectInfo).not.toHaveBeenCalled()
    expect(firstEntries).toEqual(secondEntries)
    expect(firstEntries.map((entry) => entry.name)).toEqual(['alpha', 'beta'])
  })

  it('serializes writes that touch the same project', async () => {
    mocks.stat.mockRejectedValue({ code: 'ENOENT' })
    const startedWrites: string[] = []
    const releases = new Map<string, () => void>()
    mocks.writeFile.mockImplementation(
      (path: string) =>
        new Promise<void>((resolve) => {
          startedWrites.push(path)
          releases.set(path, resolve)
        })
    )

    const systemIO = createSystemIOService({
      wasmPromise: Promise.resolve({} as never),
      getProjectDirectoryPath: () => '/projects',
      getDefaultProjectName: () => 'untitled',
      getOpenedProject: () => undefined,
    })

    const first = systemIO.request({
      type: 'file.createBlank',
      requestedAbsolutePath: '/projects/alpha/a.txt',
    })
    const second = systemIO.request({
      type: 'file.createBlank',
      requestedAbsolutePath: '/projects/alpha/b.txt',
    })

    await flushUntil(() => startedWrites.length > 0)
    expect(startedWrites).toEqual(['/projects/alpha/a.txt'])

    releases.get('/projects/alpha/a.txt')?.()
    await flushUntil(() => startedWrites.length === 2)
    releases.get('/projects/alpha/b.txt')?.()

    await Promise.all([first, second])
    expect(startedWrites).toEqual([
      '/projects/alpha/a.txt',
      '/projects/alpha/b.txt',
    ])
  })

  it('allows writes for independent projects to run concurrently', async () => {
    mocks.stat.mockRejectedValue({ code: 'ENOENT' })
    const startedWrites: string[] = []
    const releases = new Map<string, () => void>()
    mocks.writeFile.mockImplementation(
      (path: string) =>
        new Promise<void>((resolve) => {
          startedWrites.push(path)
          releases.set(path, resolve)
        })
    )

    const systemIO = createSystemIOService({
      wasmPromise: Promise.resolve({} as never),
      getProjectDirectoryPath: () => '/projects',
      getDefaultProjectName: () => 'untitled',
      getOpenedProject: () => undefined,
    })

    const first = systemIO.request({
      type: 'file.createBlank',
      requestedAbsolutePath: '/projects/alpha/a.txt',
    })
    const second = systemIO.request({
      type: 'file.createBlank',
      requestedAbsolutePath: '/projects/beta/b.txt',
    })

    await flushUntil(() => startedWrites.length === 2)
    expect(new Set(startedWrites)).toEqual(
      new Set(['/projects/alpha/a.txt', '/projects/beta/b.txt'])
    )

    releases.get('/projects/alpha/a.txt')?.()
    releases.get('/projects/beta/b.txt')?.()

    await Promise.all([first, second])
  })

  it('ignores stale shallow local project index results', async () => {
    const readdirReleases = new Map<string, (entries: string[]) => void>()
    mocks.readdir.mockImplementation(
      (path: string) =>
        new Promise<string[]>((resolve) => {
          readdirReleases.set(path, resolve)
        })
    )
    mocks.stat.mockResolvedValue({
      mode: 0o040000,
      mtimeMs: 10,
    })

    const systemIO = createSystemIOService({
      wasmPromise: Promise.resolve({} as never),
      getProjectDirectoryPath: () => '/projects-old',
      getDefaultProjectName: () => 'untitled',
      getOpenedProject: () => undefined,
    })

    const oldRefresh = systemIO.refreshLocalProjects('/projects-old')
    await flushUntil(() => readdirReleases.has('/projects-old'))
    const newRefresh = systemIO.refreshLocalProjects('/projects-new')
    await flushUntil(() => readdirReleases.has('/projects-new'))

    readdirReleases.get('/projects-new')?.(['new-project'])
    await newRefresh
    expect(
      systemIO.localProjectEntriesSignal.value.map((entry) => entry.name)
    ).toEqual(['new-project'])

    readdirReleases.get('/projects-old')?.(['old-project'])
    await oldRefresh
    expect(
      systemIO.localProjectEntriesSignal.value.map((entry) => entry.name)
    ).toEqual(['new-project'])
  })
})
