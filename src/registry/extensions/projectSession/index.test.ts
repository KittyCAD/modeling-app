import {
  Registry,
  defineRegistryItem,
  provide,
  provideService,
  type RegistryItem,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { KclManager, ZDSProject } from '@src/lang/KclManager'
import type { Project } from '@src/lib/project'
import {
  cloudSyncService,
  type CloudSyncRegistryService,
} from '@src/registry/contracts/cloudSync'
import { fsOperationQueue } from '@src/registry/contracts/fsOperationQueue'
import { projectSession } from '@src/registry/contracts/projectSession'
import {
  type ProjectLibraryRealizationContribution,
  projectLibraryRealizationsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import type { RouterRegistryService } from '@src/registry/contracts/router'
import { routerService } from '@src/registry/contracts/router'
import {
  type SystemIORegistryService,
  systemIOService,
} from '@src/registry/contracts/systemIO'
import projectSessionRegistryItem from '@src/registry/extensions/projectSession'
import { SystemIOMachineStates } from '@src/machines/systemIO/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lang/KclManager', () => ({
  ZDSProject: {
    open: vi.fn(),
  },
}))
vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

describe('project session extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  function configureProjectSession(items: RegistryItem[] = []) {
    registry = new Registry()
    registry.configure([...items, projectSessionRegistryItem])
    return registry.get(projectSession)
  }

  function createCloudSyncService() {
    return {
      setOpenedProject: vi.fn(),
    } as unknown as CloudSyncRegistryService & {
      setOpenedProject: ReturnType<typeof vi.fn>
    }
  }

  async function flushMicrotasks() {
    await Promise.resolve()
    await Promise.resolve()
  }

  function createProjectTree(name = 'bracket'): Project {
    return {
      name,
      path: `/projects/${name}`,
      children: [],
      default_file: `/projects/${name}/main.kcl`,
      directory_count: 0,
      kcl_file_count: 1,
      metadata: null,
      readWriteAccess: true,
    }
  }

  function createProjectRealization({
    path = '/projects/bracket',
    title = 'Bracket',
    libraryPath = '/projects',
  }: {
    path?: string
    title?: string
    libraryPath?: string
  } = {}): ProjectLibraryRealizationContribution {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return {
      name,
      title,
      localProjectPath: path,
      localProjectName: name,
      defaultFile: `${path}/main.kcl`,
      kclFileCount: 1,
      directoryCount: 0,
      readWriteAccess: true,
      libraryRefs: [
        {
          id: 'default',
          title: 'Projects',
          path: libraryPath,
          type: 'directory',
        },
      ],
    }
  }

  function createFakeProject(
    projectTree = createProjectTree(),
    refreshedProjectTree = createProjectTree(`${projectTree.name}-fresh`)
  ) {
    const mocks = {
      refreshProjectTree: vi.fn(async () => refreshedProjectTree),
      openEditor: vi.fn(async () => ({}) as KclManager),
      closeEditor: vi.fn(),
      closeAllEditors: vi.fn(),
      createFile: vi.fn(async ({ path }: { path: string }) => path),
      writeFile: vi.fn(async ({ path }: { path: string }) => path),
      createFolder: vi.fn(async ({ path }: { path: string }) => path),
      renameEntry: vi.fn(async ({ newPath }: { newPath: string }) => newPath),
      deleteEntry: vi.fn(async ({ path }: { path: string }) => path),
      copyEntry: vi.fn(
        async ({ targetPath }: { targetPath: string }) => targetPath
      ),
      moveEntry: vi.fn(
        async ({ targetPath }: { targetPath: string }) => targetPath
      ),
      archiveEntry: vi.fn(async () => ({ archivedPath: '/archive/main.kcl' })),
      applyFilePatch: vi.fn(async () => undefined),
      close: vi.fn(),
    }
    return {
      path: projectTree.path,
      name: projectTree.name,
      projectIORefSignal: signal(projectTree),
      ...mocks,
      mocks,
    } as unknown as ZDSProject & { mocks: typeof mocks }
  }

  function createSystemIOService() {
    type SystemIOSnapshot = {
      context: {
        folders?: Project[]
        lastOperation: SystemIOMachineStates
        requestedProjectName: { name: string; title?: string }
      }
      matches: (state: string) => boolean
    }

    const subscribers = new Set<(snapshot: SystemIOSnapshot) => void>()
    const createSnapshot = (
      state: SystemIOMachineStates,
      context: Partial<SystemIOSnapshot['context']> = {}
    ): SystemIOSnapshot => ({
      context: {
        lastOperation: SystemIOMachineStates.idle,
        requestedProjectName: { name: 'bracket' },
        ...context,
      },
      matches: (candidateState: string) => candidateState === state,
    })

    const service: SystemIORegistryService = {
      actor: {
        getSnapshot: () => createSnapshot(SystemIOMachineStates.idle),
        send: vi.fn(),
        subscribe: vi.fn((listener: (snapshot: SystemIOSnapshot) => void) => {
          subscribers.add(listener)
          return {
            unsubscribe: vi.fn(() => subscribers.delete(listener)),
          }
        }),
      } as unknown as SystemIORegistryService['actor'],
    }

    return {
      service,
      emit: (
        state: SystemIOMachineStates,
        context: Partial<SystemIOSnapshot['context']> = {}
      ) => {
        const snapshot = createSnapshot(state, context)
        for (const subscriber of subscribers) {
          subscriber(snapshot)
        }
      },
    }
  }

  it('provides the opened project session through registry signals', () => {
    const projectSession = configureProjectSession()
    const project = createFakeProject()

    expect(projectSession.getProject()).toBeUndefined()
    expect(projectSession.project.value).toBeUndefined()
    expect(projectSession.getProjectTree()).toBeUndefined()
    expect(projectSession.projectTree.value).toBeUndefined()

    projectSession.setProject(project)

    expect(projectSession.getProject()).toBe(project)
    expect(projectSession.project.value).toBe(project)
    expect(projectSession.getProjectTree()).toBe(
      project.projectIORefSignal.value
    )
    expect(projectSession.projectTree.value).toBe(
      project.projectIORefSignal.value
    )

    projectSession.clearProject()

    expect(projectSession.getProject()).toBeUndefined()
    expect(projectSession.project.value).toBeUndefined()
    expect(projectSession.getProjectTree()).toBeUndefined()
    expect(projectSession.projectTree.value).toBeUndefined()
  })

  it('reuses the active project when opening the same project path', async () => {
    const cloudSync = createCloudSyncService()
    const projectSession = configureProjectSession([
      defineRegistryItem({
        id: 'test-cloud-sync-active-project',
        providesServices: [provideService(cloudSyncService, cloudSync)],
      }),
    ])
    const projectTree = createProjectTree()
    const project = createFakeProject(projectTree)
    const updatedProjectTree: Project = {
      ...projectTree,
      children: [
        {
          name: 'main.kcl',
          path: '/projects/bracket/main.kcl',
          children: null,
        },
        {
          name: 'nested.kcl',
          path: '/projects/bracket/nested.kcl',
          children: null,
        },
      ],
      kcl_file_count: 2,
    }
    projectSession.setProject(project)

    const reopenedProject = await projectSession.openProject(updatedProjectTree)

    expect(reopenedProject).toBe(project)
    expect(projectSession.getProject()).toBe(project)
    expect(projectSession.getProjectTree()).toEqual(updatedProjectTree)
    expect(project.mocks.close).not.toHaveBeenCalled()
  })

  it('mirrors external updates from the opened project tree signal', () => {
    const projectSession = configureProjectSession()
    const project = createFakeProject()
    const updatedProjectTree = createProjectTree('bracket-updated')

    projectSession.setProject(project)

    project.projectIORefSignal.value = updatedProjectTree

    expect(projectSession.getProjectTree()).toBe(updatedProjectTree)
    expect(projectSession.projectTree.value).toBe(updatedProjectTree)

    projectSession.clearProject()
    project.projectIORefSignal.value = createProjectTree('after-clear')

    expect(projectSession.getProjectTree()).toBeUndefined()
    expect(projectSession.projectTree.value).toBeUndefined()
  })

  it('syncs opened project metadata from project library realizations', async () => {
    const realizations = signal<ProjectLibraryRealizationContribution[]>([])
    const projectSession = configureProjectSession([
      defineRegistryItem({
        id: 'test.project-library-realizations',
        provides: [
          provide(projectLibraryRealizationsValueSpec, realizations, {
            key: 'test.project-library-realizations',
          }),
        ],
      }),
    ])
    const projectTree = createProjectTree()
    const project = createFakeProject(projectTree)
    projectSession.setProject(project)

    realizations.value = [
      createProjectRealization({
        path: projectTree.path,
        title: 'Renamed Bracket',
      }),
    ]
    await flushMicrotasks()

    expect(project.projectIORefSignal.value).toEqual(
      expect.objectContaining({
        name: 'bracket',
        path: '/projects/bracket',
        title: 'Renamed Bracket',
        default_file: '/projects/bracket/main.kcl',
      })
    )
    expect(projectSession.projectTree.value).toBe(
      project.projectIORefSignal.value
    )
  })

  it('navigates to a moved project realization that matches the opened project title', async () => {
    const realizations = signal<ProjectLibraryRealizationContribution[]>([])
    const navigate = vi.fn()
    const router: Pick<RouterRegistryService, 'isReady' | 'navigate'> = {
      isReady: signal(true),
      navigate,
    }
    const projectSession = configureProjectSession([
      defineRegistryItem({
        id: 'test.project-library-realizations',
        provides: [
          provide(projectLibraryRealizationsValueSpec, realizations, {
            key: 'test.project-library-realizations',
          }),
        ],
      }),
      defineRegistryItem({
        id: 'test.router',
        providesServices: [
          provideService(
            routerService,
            router as unknown as RouterRegistryService
          ),
        ],
      }),
    ])
    const projectTree = {
      ...createProjectTree(),
      title: 'Renamed Bracket',
      libraryPath: '/projects',
      libraryType: 'directory',
    }
    const project = createFakeProject(projectTree)
    projectSession.setProject(project)

    realizations.value = [
      createProjectRealization({
        path: '/projects/renamed-bracket',
        title: 'Renamed Bracket',
      }),
    ]
    await flushMicrotasks()

    expect(navigate).toHaveBeenCalledWith(
      '/file/%2Fprojects%2Frenamed-bracket%2Fmain.kcl'
    )
  })

  it('syncs opened project metadata from completed SystemIO folder reads', async () => {
    const systemIO = createSystemIOService()
    const projectSession = configureProjectSession([
      defineRegistryItem({
        id: 'test.system-io',
        providesServices: [provideService(systemIOService, systemIO.service)],
      }),
    ])
    const projectTree = createProjectTree()
    const project = createFakeProject(projectTree)
    const refreshedProjectTree = {
      ...projectTree,
      title: 'Renamed Bracket',
      kcl_file_count: 2,
    }
    projectSession.setProject(project)

    systemIO.emit(SystemIOMachineStates.readingFolders)
    systemIO.emit(SystemIOMachineStates.idle, {
      folders: [refreshedProjectTree],
    })
    await flushMicrotasks()

    expect(project.mocks.refreshProjectTree).not.toHaveBeenCalled()
    expect(project.projectIORefSignal.value).toEqual(refreshedProjectTree)
    expect(projectSession.projectTree.value).toBe(
      project.projectIORefSignal.value
    )
  })

  it('refreshes the opened project when a completed SystemIO folder read omits it', async () => {
    const systemIO = createSystemIOService()
    const projectSession = configureProjectSession([
      defineRegistryItem({
        id: 'test.system-io',
        providesServices: [provideService(systemIOService, systemIO.service)],
      }),
    ])
    const projectTree = createProjectTree()
    const refreshedProjectTree = {
      ...projectTree,
      children: [
        {
          name: 'new.kcl',
          path: '/projects/bracket/new.kcl',
          children: null,
        },
      ],
      kcl_file_count: 2,
    }
    const project = createFakeProject(projectTree, refreshedProjectTree)
    projectSession.setProject(project)

    systemIO.emit(SystemIOMachineStates.readingFolders)
    systemIO.emit(SystemIOMachineStates.idle, {
      folders: [],
    })
    await flushMicrotasks()

    expect(project.mocks.refreshProjectTree).toHaveBeenCalledOnce()
    expect(project.projectIORefSignal.value).toEqual(refreshedProjectTree)
    expect(projectSession.projectTree.value).toBe(
      project.projectIORefSignal.value
    )
  })

  it('tracks the current project library id', () => {
    const projectSession = configureProjectSession()

    expect(projectSession.getCurrentProjectLibraryId()).toBeUndefined()
    expect(projectSession.currentProjectLibraryId.value).toBeUndefined()

    projectSession.setCurrentProjectLibraryId('directory:projects')

    expect(projectSession.getCurrentProjectLibraryId()).toBe(
      'directory:projects'
    )
    expect(projectSession.currentProjectLibraryId.value).toBe(
      'directory:projects'
    )

    projectSession.setCurrentProjectLibraryId(undefined)

    expect(projectSession.getCurrentProjectLibraryId()).toBeUndefined()
    expect(projectSession.currentProjectLibraryId.value).toBeUndefined()
  })

  it('provides queue-backed filesystem operations for opened projects', () => {
    const projectSession = configureProjectSession()

    expect(projectSession.getFileSystemOperations()).toEqual(
      expect.objectContaining({
        cp: expect.any(Function),
        batch: expect.any(Function),
        mkdir: expect.any(Function),
        rename: expect.any(Function),
        rm: expect.any(Function),
        writeFile: expect.any(Function),
      })
    )
  })

  it('reuses the opened project when opening the same project path', async () => {
    const cloudSync = createCloudSyncService()
    const projectSession = configureProjectSession([
      defineRegistryItem({
        id: 'test-cloud-sync',
        providesServices: [provideService(cloudSyncService, cloudSync)],
      }),
    ])
    const projectTree = {
      ...createProjectTree(),
      libraryPath: '/projects',
    }
    const project = createFakeProject(projectTree)
    projectSession.setProject(project)

    const reseededProject = {
      ...createProjectTree(),
      title: 'Bracket',
      default_file: '/projects/bracket/other.kcl',
    }
    const openedProject = await projectSession.openProject(reseededProject)

    expect(openedProject).toBe(project)
    expect(project.mocks.closeAllEditors).not.toHaveBeenCalled()
    expect(project.projectIORefSignal.value).toEqual(
      expect.objectContaining({
        title: 'Bracket',
        default_file: '/projects/bracket/other.kcl',
        libraryPath: '/projects',
      })
    )
    expect(cloudSync.setOpenedProject).toHaveBeenCalledWith({
      projectPath: '/projects/bracket',
      libraryPath: '/projects',
    })
  })

  it('refreshes the hydrated project tree through the opened project', async () => {
    const projectSession = configureProjectSession()
    const project = createFakeProject()
    projectSession.setProject(project)

    const refreshedProjectTree = await projectSession.refreshProjectTree()

    expect(project.mocks.refreshProjectTree).toHaveBeenCalledOnce()
    expect(refreshedProjectTree).toBe(projectSession.projectTree.value)
    expect(projectSession.getProjectTree()).toBe(refreshedProjectTree)
    expect(projectSession.mutation.value).toEqual({
      pending: false,
      operation: 'refresh-project-tree',
      lastTargetPath: project.path,
    })
  })

  it('delegates editor management through the opened project', async () => {
    const projectSession = configureProjectSession()
    const project = createFakeProject()
    projectSession.setProject(project)

    const editor = {} as KclManager
    await projectSession.openEditor({
      path: '/projects/bracket/main.kcl',
      editor,
      code: 'cube(1)',
      isExecuting: false,
    })
    projectSession.closeEditor({ path: '/projects/bracket/main.kcl' })
    projectSession.closeAllEditors()

    expect(project.mocks.openEditor).toHaveBeenCalledWith(
      '/projects/bracket/main.kcl',
      editor,
      'cube(1)',
      false
    )
    expect(project.mocks.closeEditor).toHaveBeenCalledWith(
      '/projects/bracket/main.kcl'
    )
    expect(project.mocks.closeAllEditors).toHaveBeenCalledOnce()
  })

  it('delegates file management through the opened project and refreshes projectTree', async () => {
    const projectSession = configureProjectSession()
    const project = createFakeProject()
    projectSession.setProject(project)

    await projectSession.createFile({ path: '/projects/bracket/new.kcl' })
    await projectSession.writeFile({
      path: '/projects/bracket/main.kcl',
      contents: 'cube(1)',
    })
    await projectSession.createFolder({ path: '/projects/bracket/parts' })
    await projectSession.renameEntry({
      oldPath: '/projects/bracket/old.kcl',
      newPath: '/projects/bracket/new.kcl',
    })
    await projectSession.copyEntry({
      sourcePath: '/projects/bracket/new.kcl',
      targetPath: '/projects/bracket/copy.kcl',
    })
    await projectSession.moveEntry({
      sourcePath: '/projects/bracket/copy.kcl',
      targetPath: '/projects/bracket/parts/copy.kcl',
    })
    await projectSession.deleteEntry({
      path: '/projects/bracket/parts/copy.kcl',
    })
    await projectSession.archiveEntry({ path: '/projects/bracket/new.kcl' })
    await projectSession.applyFilePatch({
      files: [{ path: '/projects/bracket/main.kcl', contents: 'cube(2)' }],
    })

    const batchFacade = expect.objectContaining({
      id: expect.any(String),
      run: expect.any(Function),
      writeFile: expect.any(Function),
    })
    expect(project.mocks.createFile).toHaveBeenCalledWith(
      { path: '/projects/bracket/new.kcl' },
      batchFacade
    )
    expect(project.mocks.writeFile).toHaveBeenCalledWith(
      {
        path: '/projects/bracket/main.kcl',
        contents: 'cube(1)',
      },
      batchFacade
    )
    expect(project.mocks.createFolder).toHaveBeenCalledWith(
      { path: '/projects/bracket/parts' },
      batchFacade
    )
    expect(project.mocks.renameEntry).toHaveBeenCalledWith(
      {
        oldPath: '/projects/bracket/old.kcl',
        newPath: '/projects/bracket/new.kcl',
      },
      batchFacade
    )
    expect(project.mocks.copyEntry).toHaveBeenCalledWith(
      {
        sourcePath: '/projects/bracket/new.kcl',
        targetPath: '/projects/bracket/copy.kcl',
      },
      batchFacade
    )
    expect(project.mocks.moveEntry).toHaveBeenCalledWith(
      {
        sourcePath: '/projects/bracket/copy.kcl',
        targetPath: '/projects/bracket/parts/copy.kcl',
      },
      batchFacade
    )
    expect(project.mocks.deleteEntry).toHaveBeenCalledWith(
      { path: '/projects/bracket/parts/copy.kcl' },
      batchFacade
    )
    expect(project.mocks.archiveEntry).toHaveBeenCalledWith(
      { path: '/projects/bracket/new.kcl' },
      batchFacade
    )
    expect(project.mocks.applyFilePatch).toHaveBeenCalledWith(
      {
        files: [{ path: '/projects/bracket/main.kcl', contents: 'cube(2)' }],
      },
      batchFacade
    )
    expect(project.mocks.refreshProjectTree).toHaveBeenCalledTimes(9)
    expect(projectSession.projectTree.value?.name).toBe('bracket-fresh')
    expect(projectSession.mutation.value).toEqual({
      pending: false,
      operation: 'apply-file-patch',
      lastTargetPath: '/projects/bracket/main.kcl',
    })
  })

  it('tracks pending mutation state while a file operation is in flight', async () => {
    const projectSession = configureProjectSession()
    const project = createFakeProject()
    let finishCreateFile: (() => void) | undefined
    project.mocks.createFile = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishCreateFile = () => resolve('/projects/bracket/new.kcl')
        })
    )
    project.createFile = project.mocks.createFile
    projectSession.setProject(project)

    const pendingCreate = projectSession.createFile({
      path: '/projects/bracket/new.kcl',
    })
    await flushMicrotasks()

    expect(projectSession.mutation.value).toEqual({
      pending: true,
      operation: 'create-file',
      targetPath: '/projects/bracket/new.kcl',
    })

    finishCreateFile?.()
    await pendingCreate

    expect(projectSession.mutation.value).toEqual({
      pending: false,
      operation: 'create-file',
      lastTargetPath: '/projects/bracket/new.kcl',
    })
  })

  it('keeps project mutations exclusive through their tree refresh', async () => {
    const projectSession = configureProjectSession()
    const project = createFakeProject()
    let finishCreateFile: (() => void) | undefined
    const order: string[] = []
    project.mocks.createFile = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          order.push('create:start')
          finishCreateFile = () => {
            order.push('create:end')
            resolve('/projects/bracket/new.kcl')
          }
        })
    )
    project.mocks.writeFile = vi.fn(async () => {
      order.push('write')
      return '/projects/bracket/main.kcl'
    })
    project.createFile = project.mocks.createFile
    project.writeFile = project.mocks.writeFile
    projectSession.setProject(project)

    const create = projectSession.createFile({
      path: '/projects/bracket/new.kcl',
    })
    const write = projectSession.writeFile({
      path: '/projects/bracket/main.kcl',
      contents: 'cube(1)',
    })
    await flushMicrotasks()

    expect(order).toEqual(['create:start'])
    expect(projectSession.mutation.value.operation).toBe('create-file')

    finishCreateFile?.()
    await Promise.all([create, write])

    expect(order).toEqual(['create:start', 'create:end', 'write'])
    const queue = registry?.get(fsOperationQueue)
    expect(
      queue?.getJournal().map(({ kind, status }) => ({ kind, status }))
    ).toEqual([
      { kind: 'create-file', status: 'completed' },
      { kind: 'write-file', status: 'completed' },
    ])
  })

  it('rejects mutating methods when no project is open', async () => {
    const projectSession = configureProjectSession()

    await expect(
      projectSession.createFile({ path: '/projects/bracket/main.kcl' })
    ).rejects.toThrow('No project is currently open.')
    await expect(projectSession.refreshProjectTree()).resolves.toBeUndefined()
    expect(projectSession.projectTree.value).toBeUndefined()
  })
})
