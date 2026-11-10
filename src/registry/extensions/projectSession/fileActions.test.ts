import { FileAlreadyExists } from '@src/lib/fileSystem/fileOperations'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { createFileOperationsScheduler } from '@src/lib/fileSystem/scheduler'
import { createProjectForTest } from '@src/lib/projectTestUtils'
import { posix } from '@chainner/node-path'
import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
  Slot,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'
import { getProjectInfo } from '@src/lib/desktop'
import type { Project } from '@src/lib/project'
import type { ZDSProject } from '@src/lib/projectSession'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  cloudStorageService,
  fileOperationsService,
  type FileOperationsRegistryService,
  type CloudStorageService,
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
  adoptCloudTextSnapshot: vi.fn(),
}))

const metadata = (title = 'Project'): Project =>
  createProjectForTest('/project', {
    name: 'project',
    title,
    default_file: '/project/main.kcl',
    kcl_file_count: 1,
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
    path,
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
function setup(cloud?: CloudStorageService) {
  const exists = vi.fn(async () => false)
  const rename = vi.fn(async (_source: string, _destination: string) => {})
  const readFile = vi.fn(async () =>
    new TextEncoder().encode('title = "Project"\ndefault_file = "main.kcl"\n')
  )
  const writeFile = vi.fn(async () => {})
  const router = createRouterRegistryService()
  const navigate = vi.fn(async (_path?: unknown, _options?: unknown) => {})
  router.setNavigate(navigate)
  const registry = new Registry()
  const lateCloud = new Slot()
  registry.configure([
    projectSessionRegistryItem,
    lateCloud.of(),
    defineRegistryItem({
      provides: [
        provide(wasmPromiseValueSpec, Promise.resolve({} as ModuleType)),
      ],
      providesServices: [
        provideService(fileOperationsService, {
          exists,
          rename,
          readFile,
          writeFile,
        } as unknown as FileOperationsRegistryService),
        provideService(routerService, router),
        ...(cloud ? [provideService(cloudStorageService, cloud)] : []),
      ],
    }),
  ])
  registries.push(registry)
  const session = registry.get(projectSession)
  const current = createProject()
  session.setProject(current.project)
  return {
    registry,
    lateCloud,
    session,
    exists,
    rename,
    readFile,
    writeFile,
    router,
    navigate,
    ...current,
  }
}

describe('direct project session file actions', () => {
  it.each([false, true])(
    'retries cloud storage before flushing the live editor on reconnect (switch project: %s)',
    async (switchProject) => {
      vi.useFakeTimers()
      const gate = Promise.withResolvers<undefined>()
      const retry = vi.fn(() => gate.promise)
      const s = setup({ retry } as unknown as CloudStorageService)
      s.project.projectIORefSignal.value = {
        ...metadata(),
        cloudProjectId: 'remote',
      }
      try {
        window.dispatchEvent(new Event('online'))
        expect(retry).toHaveBeenCalledExactlyOnceWith('remote')
        await vi.advanceTimersByTimeAsync(7_000)
        expect(s.flush).not.toHaveBeenCalled()
        if (switchProject) s.session.clearProject()
        gate.resolve(undefined)
        await vi.advanceTimersByTimeAsync(0)
        expect(s.flush).toHaveBeenCalledTimes(switchProject ? 0 : 1)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it('subscribes when cloud storage becomes available and applies its authoritative snapshot', async () => {
    const s = setup()
    const adopt = vi.fn()
    Object.assign(s.project.executingEditor.peek()!, {
      adoptCloudSnapshot: adopt,
    })
    const reload = vi.fn(async () => {})
    Object.assign(s.project, { reloadFilesFromStorage: reload })
    await Promise.resolve()
    let listener:
      | ((
          root: string,
          files: { relativePath: string; data: Uint8Array }[]
        ) => void)
      | undefined
    const stop = vi.fn()
    const subscribeReconciled = vi.fn((next: NonNullable<typeof listener>) => {
      listener = next
      return stop
    })
    s.registry.reconfigure(s.lateCloud, [
      defineRegistryItem({
        id: 'late-cloud-storage',
        providesServices: [
          provideService(cloudStorageService, {
            subscribeReconciled,
          } as unknown as CloudStorageService),
        ],
      }),
    ])
    await vi.waitFor(() => expect(subscribeReconciled).toHaveBeenCalledOnce())
    listener!('/another-project', [])
    expect(adopt).not.toHaveBeenCalled()
    listener!('/project', [
      {
        relativePath: 'parts/main.kcl',
        data: new TextEncoder().encode('cloud truth'),
      },
    ])
    expect(adopt).toHaveBeenCalledWith('/project', 'cloud truth')
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    s.registry[Symbol.dispose]()
    registries.splice(registries.indexOf(s.registry), 1)
    expect(stop).toHaveBeenCalledOnce()
  })

  it('stages cloud thumbnails and forwards editor activity without file writes', async () => {
    const stageThumbnail = vi.fn(async () => {})
    const editorChanged = vi.fn()
    const s = setup({
      root: '/cloud',
      stageThumbnail,
      editorChanged,
    } as unknown as CloudStorageService)
    const bytes = new Uint8Array([1, 2])
    await s.session.writeThumbnail('/cloud/project', bytes)
    s.session.editorChanged('/cloud/project/main.kcl')
    s.session.editorChanged('/local/main.kcl')
    expect(stageThumbnail).toHaveBeenCalledExactlyOnceWith(
      '/cloud/project',
      bytes
    )
    expect(editorChanged).toHaveBeenCalledExactlyOnceWith(
      '/cloud/project/main.kcl'
    )
  })

  it('preserves cloud identity and library ownership when refreshing the tree', async () => {
    const s = setup()
    s.project.projectIORefSignal.value = {
      ...metadata(),
      cloudProjectId: 'remote',
      libraryPath: '/library',
      libraryType: 'cloud',
    }
    vi.mocked(getProjectInfo).mockResolvedValueOnce(metadata('Fresh'))
    await s.session.refreshProject()
    expect(getProjectInfo).toHaveBeenCalledWith(
      expect.anything(),
      '/project',
      expect.anything(),
      { createMissingEntrypoint: false }
    )
    expect(s.project.projectIORefSignal.value).toMatchObject({
      title: 'Fresh',
      cloudProjectId: 'remote',
      libraryPath: '/library',
      libraryType: 'cloud',
    })
  })

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

  it('rebinds both the editor and navigation path after moving an open file', async () => {
    const s = setup()
    await s.session.rename('/project/parts/main.kcl', '/project/moved.kcl')
    expect(s.project.executingEditor.peek()!.path).toBe('/project/moved.kcl')
    expect(s.filePath.value).toBe('/project/moved.kcl')
  })

  it('does not rebind an active file when an unrelated sibling prefix is renamed', async () => {
    const s = setup()
    s.filePath.value = '/project/parts-extra/main.kcl'
    s.project.executingEditor.peek()!.path = s.filePath.value
    await s.session.rename('/project/parts', '/project/components')
    expect(s.filePath.value).toBe('/project/parts-extra/main.kcl')
    expect(s.project.executingEditor.peek()!.path).toBe(s.filePath.value)
    expect(s.flush).not.toHaveBeenCalled()
  })

  it.each([
    [
      '/project/main.kcl',
      '/project/components/main.kcl',
      'components/main.kcl',
    ],
  ])(
    'updates entrypoint metadata when moving %s',
    async (source, destination, relative) => {
      const s = setup()
      await s.session.rename(source, destination)
      expect(s.writeFile).toHaveBeenCalledWith(
        '/project/project.toml',
        expect.stringContaining(`default_file = "${relative}"`)
      )
    }
  )

  it('keeps the old path while a cloud move takes seven seconds, then rebinds before persistence', async () => {
    vi.useFakeTimers()
    const gate = Promise.withResolvers<undefined>()
    const persisted = Promise.withResolvers<undefined>()
    const rename = vi.fn(async () => {
      await gate.promise
    })
    const batch = vi.fn(
      async (
        _path: string,
        run: (operations: FileOperationsRegistryService) => Promise<void>
      ) => {
        await run({ rename } as unknown as FileOperationsRegistryService)
        await persisted.promise
      }
    )
    const s = setup({ root: '/cloud', batch } as unknown as CloudStorageService)
    s.filePath.value = '/cloud/project/parts/main.kcl'
    s.project.executingEditor.peek()!.path = s.filePath.value
    const moving = s.session.rename(
      '/cloud/project/parts',
      '/cloud/project/components'
    )
    await vi.advanceTimersByTimeAsync(7_000)
    expect(rename).toHaveBeenCalledOnce()
    expect(s.project.executingEditor.peek()!.path).toBe(
      '/cloud/project/parts/main.kcl'
    )
    gate.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(s.project.executingEditor.peek()!.path).toBe(
      '/cloud/project/components/main.kcl'
    )
    expect(s.filePath.value).toBe('/cloud/project/components/main.kcl')
    persisted.resolve(undefined)
    await moving
    vi.useRealTimers()
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
    s.rename.mockRejectedValueOnce(
      new FileAlreadyExists({
        operation: 'rename',
        path: '/project/parts',
        cause: { code: 'EEXIST' },
        message: 'Name already exists.',
      })
    )
    await expect(
      s.session.rename('/project/parts', '/project/existing')
    ).rejects.toThrow('already exists')
    expect(s.filePath.value).toBe('/project/parts/main.kcl')
  })

  it('rebinds the live editor after a case-only rename on a case-insensitive backing', async () => {
    const memory = createMemoryFileSystem({
      ...noopfs.impl,
      ...posix,
      resolve: (...parts) =>
        posix
          .resolve(...parts)
          .normalize('NFD')
          .toLowerCase(),
    })
    await memory.mkdir('/project/parts', { recursive: true })
    await memory.writeFile('/project/parts/main.kcl', new Uint8Array([42]))
    const scheduler = createFileOperationsScheduler({
      ...memory,
      resolve: (...parts) => posix.resolve(...parts),
    })
    const s = setup()
    s.exists.mockResolvedValue(true)
    s.rename.mockImplementation((...args) =>
      scheduler.operations.rename(...args)
    )
    try {
      await s.session.rename(
        '/project/parts/main.kcl',
        '/project/parts/Main.kcl'
      )
      expect(s.filePath.value).toBe('/project/parts/Main.kcl')
      expect(s.project.executingEditor.peek()?.path).toBe(
        '/project/parts/Main.kcl'
      )
      expect(
        await scheduler.operations.readFile('/project/parts/Main.kcl')
      ).toEqual(new Uint8Array([42]))
    } finally {
      await scheduler.dispose()
    }
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
  it('keeps the editor at the renamed memory path if cloud persistence fails', async () => {
    const error = new Error('Save failed')
    const batch = vi.fn(
      async (
        _path: string,
        run: (operations: FileOperationsRegistryService) => Promise<void>
      ) => {
        await run({
          rename: vi.fn(async () => {}),
        } as unknown as FileOperationsRegistryService)
        return Promise.reject(error)
      }
    )
    const s = setup({ root: '/cloud', batch } as unknown as CloudStorageService)
    s.filePath.value = '/cloud/project/parts/main.kcl'
    s.project.executingEditor.peek()!.path = s.filePath.value
    await expect(
      s.session.rename('/cloud/project/parts', '/cloud/project/renamed')
    ).rejects.toBe(error)
    expect(s.filePath.value).toBe('/cloud/project/renamed/main.kcl')
    expect(s.rename).not.toHaveBeenCalled()
  })
})
