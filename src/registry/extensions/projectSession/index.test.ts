import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'
import type { ZDSProject } from '@src/lang/KclManager'
import type { Project } from '@src/lib/project'
import { fsOperationQueue } from '@src/registry/contracts/fsOperationQueue'
import { projectSession } from '@src/registry/contracts/projectSession'
import projectSessionRegistryItem from '@src/registry/extensions/projectSession'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('project session extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  function configureProjectSession() {
    registry = new Registry()
    registry.configure([projectSessionRegistryItem])
    return registry.get(projectSession)
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

  function createFakeProject(projectTree = createProjectTree()) {
    const refreshedProjectTree = createProjectTree(`${projectTree.name}-fresh`)
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
      restoreEntry: vi.fn(
        async ({ targetPath }: { targetPath: string }) => targetPath
      ),
      applyFilePatch: vi.fn(async () => undefined),
    }
    return {
      path: projectTree.path,
      name: projectTree.name,
      projectIORefSignal: signal(projectTree),
      ...mocks,
      mocks,
    } as unknown as ZDSProject & { mocks: typeof mocks }
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
    await projectSession.openFile({
      path: '/projects/bracket/other.kcl',
      editor,
      code: 'cube(2)',
      isExecuting: true,
    })
    projectSession.closeEditor({ path: '/projects/bracket/main.kcl' })
    projectSession.closeAllEditors()

    expect(project.mocks.openEditor).toHaveBeenCalledWith(
      '/projects/bracket/main.kcl',
      editor,
      'cube(1)',
      false
    )
    expect(project.mocks.openEditor).toHaveBeenCalledWith(
      '/projects/bracket/other.kcl',
      editor,
      'cube(2)',
      true
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
    await projectSession.restoreEntry({
      archivedPath: '/archive/main.kcl',
      targetPath: '/projects/bracket/main.kcl',
    })
    await projectSession.applyFilePatch({
      files: [{ path: '/projects/bracket/main.kcl', contents: 'cube(2)' }],
    })

    expect(project.mocks.createFile).toHaveBeenCalledWith({
      path: '/projects/bracket/new.kcl',
    })
    expect(project.mocks.writeFile).toHaveBeenCalledWith({
      path: '/projects/bracket/main.kcl',
      contents: 'cube(1)',
    })
    expect(project.mocks.createFolder).toHaveBeenCalledWith({
      path: '/projects/bracket/parts',
    })
    expect(project.mocks.renameEntry).toHaveBeenCalledWith({
      oldPath: '/projects/bracket/old.kcl',
      newPath: '/projects/bracket/new.kcl',
    })
    expect(project.mocks.copyEntry).toHaveBeenCalledWith({
      sourcePath: '/projects/bracket/new.kcl',
      targetPath: '/projects/bracket/copy.kcl',
    })
    expect(project.mocks.moveEntry).toHaveBeenCalledWith({
      sourcePath: '/projects/bracket/copy.kcl',
      targetPath: '/projects/bracket/parts/copy.kcl',
    })
    expect(project.mocks.deleteEntry).toHaveBeenCalledWith({
      path: '/projects/bracket/parts/copy.kcl',
    })
    expect(project.mocks.archiveEntry).toHaveBeenCalledWith({
      path: '/projects/bracket/new.kcl',
    })
    expect(project.mocks.restoreEntry).toHaveBeenCalledWith({
      archivedPath: '/archive/main.kcl',
      targetPath: '/projects/bracket/main.kcl',
    })
    expect(project.mocks.applyFilePatch).toHaveBeenCalledWith({
      files: [{ path: '/projects/bracket/main.kcl', contents: 'cube(2)' }],
    })
    expect(project.mocks.refreshProjectTree).toHaveBeenCalledTimes(10)
    expect(projectSession.projectTree.value?.name).toBe('bracket-fresh')
    expect(registry?.get(fsOperationQueue).getJournal()).toEqual([
      expect.objectContaining({ kind: 'create-file', status: 'completed' }),
      expect.objectContaining({ kind: 'write-file', status: 'completed' }),
      expect.objectContaining({ kind: 'create-folder', status: 'completed' }),
      expect.objectContaining({ kind: 'rename-entry', status: 'completed' }),
      expect.objectContaining({ kind: 'copy-entry', status: 'completed' }),
      expect.objectContaining({ kind: 'move-entry', status: 'completed' }),
      expect.objectContaining({ kind: 'delete-entry', status: 'completed' }),
      expect.objectContaining({ kind: 'archive-entry', status: 'completed' }),
      expect.objectContaining({ kind: 'restore-entry', status: 'completed' }),
      expect.objectContaining({
        kind: 'apply-file-patch',
        status: 'completed',
      }),
    ])
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

  it('rejects mutating methods when no project is open', async () => {
    const projectSession = configureProjectSession()

    await expect(
      projectSession.createFile({ path: '/projects/bracket/main.kcl' })
    ).rejects.toThrow('No project is currently open.')
    await expect(projectSession.refreshProjectTree()).resolves.toBeUndefined()
    expect(projectSession.projectTree.value).toBeUndefined()
  })
})
