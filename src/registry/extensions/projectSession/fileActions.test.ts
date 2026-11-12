import { posix } from '@chainner/node-path'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import {
  projectStorageProvidersValueSpec,
  type ProjectStorage,
} from '@src/lib/projectSession/storage'
import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'
import { getProjectInfo } from '@src/lib/desktop'
import type { Project } from '@src/lib/project'
import type { ZDSProject } from '@src/lib/projectSession'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  fileOperationsService,
  type FileOperationsRegistryService,
} from '@src/registry/contracts/fileOperations'
import { projectSession } from '@src/registry/contracts/projectSession'
import { routerService } from '@src/registry/contracts/router'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import projectSessionRegistryItem from '@src/registry/extensions/projectSession'
import { createRouterRegistryService } from '@src/registry/extensions/router'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', () => ({ default: posix }))
vi.mock('@src/lib/desktop', () => ({
  getProjectInfo: vi.fn(),
  writeProjectThumbnailFile: vi.fn(async () => {}),
}))
vi.mock('@src/lib/activeTextFile', () => ({
  flushActiveTextFileWrite: vi.fn(async () => {}),
}))

const metadata = (title = 'Project'): Project => ({
  name: 'project',
  path: '/project',
  title,
  children: [],
  default_file: '/project/main.kcl',
  directory_count: 0,
  kcl_file_count: 1,
  metadata: null,
  readWriteAccess: true,
})
const registries: Registry[] = []
afterEach(() => {
  for (const registry of registries.splice(0)) registry[Symbol.dispose]()
  vi.resetAllMocks()
})
function createProject(path = '/project/parts/main.kcl') {
  const filePath = signal(path)
  const flush = vi.fn(async () => true)
  const editor = {
    get path() {
      return filePath.value
    },
    flushWriteToFile: flush,
  } as unknown as KclManager
  const project = {
    path: '/project',
    projectIORefSignal: signal(metadata()),
    executingPathSignal: signal(filePath),
    executingEditor: signal(editor),
  } as unknown as ZDSProject
  return { project, filePath, flush }
}
function setup(storage?: ProjectStorage) {
  const exists = vi.fn(async () => false)
  const rename = vi.fn(async () => {})
  const router = createRouterRegistryService()
  const navigate = vi.fn(async (_path?: unknown, _options?: unknown) => {})
  router.setNavigate(navigate)
  const registry = new Registry()
  registry.configure([
    projectSessionRegistryItem,
    defineRegistryItem({
      provides: [
        provide(wasmPromiseValueSpec, Promise.resolve({} as ModuleType)),
        ...(storage
          ? [provide(projectStorageProvidersValueSpec, () => storage)]
          : []),
      ],
      providesServices: [
        provideService(fileOperationsService, {
          exists,
          rename,
        } as unknown as FileOperationsRegistryService),
        provideService(routerService, router),
      ],
    }),
  ])
  registries.push(registry)
  const session = registry.get(projectSession)
  const current = createProject()
  session.setProject(current.project)
  return {
    registry,
    session,
    exists,
    rename,
    router,
    navigate,
    ...current,
  }
}

describe('direct project session file actions', () => {
  it.each([undefined, 'remote-after-sync'])(
    'refreshes cloud identity and preserves library ownership ($0)',
    async (discoveredId) => {
      const s = setup()
      s.project.projectIORefSignal.value = {
        ...metadata(),
        cloudProjectId: 'remote',
        libraryPath: '/library',
        libraryType: 'cloud',
      }
      vi.mocked(getProjectInfo).mockResolvedValueOnce({
        ...metadata('Fresh'),
        cloudProjectId: discoveredId,
      })
      await s.session.refreshProject()
      expect(getProjectInfo).toHaveBeenCalledWith(
        expect.anything(),
        '/project',
        expect.anything(),
        { createMissingEntrypoint: true }
      )
      expect(s.project.projectIORefSignal.value).toMatchObject({
        title: 'Fresh',
        cloudProjectId: discoveredId ?? 'remote',
        libraryPath: '/library',
        libraryType: 'cloud',
      })
    }
  )

  it('discards a tree read completed after the project changed', async () => {
    const s = setup()
    const gate = Promise.withResolvers<Project>()
    vi.mocked(getProjectInfo).mockReturnValueOnce(gate.promise)
    const refresh = s.session.refreshProject()
    const next = createProject()
    s.session.setProject(next.project)
    gate.resolve(metadata('Stale'))
    await refresh
    expect(next.project.projectIORefSignal.value.title).toBe('Project')
    expect(s.project.projectIORefSignal.value.title).toBe('Project')
  })

  it('keeps the newest tree when concurrent reads finish out of order', async () => {
    const s = setup()
    const gate = Promise.withResolvers<Project>()
    vi.mocked(getProjectInfo)
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValueOnce(metadata('Latest'))
    const previous = s.session.refreshProject()
    await vi.waitFor(() => expect(getProjectInfo).toHaveBeenCalledOnce())
    await s.session.refreshProject()
    gate.resolve(metadata('Old'))
    await previous
    expect(s.project.projectIORefSignal.value.title).toBe('Latest')
  })

  it('resolves navigation after the router loader finishes and preserves unrelated query parameters', async () => {
    const s = setup()
    const gate = Promise.withResolvers<undefined>()
    s.navigate.mockImplementationOnce(async () => {
      await gate.promise
    })
    s.router.setLocation({
      pathname: '/home',
      search: '?keep=value&project-id=remote',
      hash: '',
      state: null,
      key: 'one',
    })
    const complete = vi.fn()
    const opening = s.session
      .openFile('/project/new.kcl', {
        projectPath: '/project',
        clearProjectId: true,
      })
      .then(complete)
    expect(s.navigate).toHaveBeenCalledWith(
      expect.stringContaining('?keep=value'),
      expect.anything()
    )
    expect(s.navigate.mock.calls[0][0]).not.toContain('project-id=')
    expect(complete).not.toHaveBeenCalled()
    gate.resolve(undefined)
    await opening
    expect(complete).toHaveBeenCalledOnce()
  })

  it('flushes an affected editor before renaming a folder and updates its owned path', async () => {
    const s = setup()
    const gate = Promise.withResolvers<boolean>()
    s.flush.mockReturnValueOnce(gate.promise)
    const renaming = s.session.rename('/project/parts', '/project/renamed')
    expect(s.rename).not.toHaveBeenCalled()
    gate.resolve(true)
    await renaming
    expect(s.rename).toHaveBeenCalledWith('/project/parts', '/project/renamed')
    expect(s.filePath.value).toBe('/project/renamed/main.kcl')
  })

  it('cancels a rename when pending edits cannot be saved', async () => {
    const s = setup()
    s.flush.mockResolvedValueOnce(false)
    await expect(
      s.session.rename('/project/parts', '/project/new')
    ).rejects.toThrow('unsaved changes')
    expect(s.rename).not.toHaveBeenCalled()
    expect(s.filePath.value).toBe('/project/parts/main.kcl')
  })

  it('refuses a destination collision', async () => {
    const s = setup()
    s.exists.mockResolvedValueOnce(true)
    await expect(
      s.session.rename('/project/parts', '/project/existing')
    ).rejects.toThrow('already exists')
    expect(s.rename).not.toHaveBeenCalled()
  })

  it('does not update a replaced project after a captured rename completes', async () => {
    const s = setup()
    const gate = Promise.withResolvers<undefined>()
    s.rename.mockImplementationOnce(async () => {
      await gate.promise
    })
    const renaming = s.session.rename('/project/parts', '/project/new')
    await vi.waitFor(() => expect(s.rename).toHaveBeenCalledOnce())
    const next = createProject()
    s.session.setProject(next.project)
    gate.resolve(undefined)
    await renaming
    expect(next.filePath.value).toBe('/project/parts/main.kcl')
  })
})

function storageForTest(): ProjectStorage {
  return {
    root: '/project',
    writeAvailability: signal({ writable: true }),
    externalChanges: 'snapshot',
    deletionHistory: 'storage',
    createMissingEntrypoint: false,
    watch: vi.fn(() => vi.fn()),
    batch: vi.fn(async (_path, run) => run({ ...testFileOperations })),
    refresh: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    editorChanged: vi.fn(),
    writeThumbnail: vi.fn(async () => {}),
  }
}

it('releases captured watchers when a watch is replaced, removed, or the session is disposed', () => {
  const storage = storageForTest()
  const first = vi.fn()
  const second = vi.fn()
  const third = vi.fn()
  vi.mocked(storage.watch)
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second)
    .mockReturnValueOnce(third)
  const s = setup(storage)
  const io = s.session.textFileIO
  io.watch('/project/main.kcl', 'editor', vi.fn())
  io.watch('/project/main.kcl', 'editor', vi.fn())
  expect(first).toHaveBeenCalledOnce()
  expect(second).not.toHaveBeenCalled()
  io.unwatch('/project/main.kcl', 'editor')
  expect(second).toHaveBeenCalledOnce()
  io.watch('/project/other.kcl', 'editor', vi.fn())
  s.registry[Symbol.dispose]()
  registries.splice(registries.indexOf(s.registry), 1)
  expect(third).toHaveBeenCalledOnce()
})

it('uses the provider entrypoint policy when refreshing a project', async () => {
  const s = setup(storageForTest())
  vi.mocked(getProjectInfo).mockResolvedValueOnce(metadata('Snapshot'))
  await s.session.refreshProject()
  expect(getProjectInfo).toHaveBeenCalledWith(
    expect.anything(),
    '/project',
    expect.anything(),
    { createMissingEntrypoint: false }
  )
  expect(s.session.project.peek()?.projectIORefSignal.peek().title).toBe(
    'Snapshot'
  )
})
