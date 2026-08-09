import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'
import type { ZDSProject } from '@src/lang/KclManager'
import type { Project } from '@src/lib/project'
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
    return {
      path: projectTree.path,
      name: projectTree.name,
      projectIORefSignal: signal(projectTree),
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
    } as unknown as ZDSProject
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

    expect(project.refreshProjectTree).toHaveBeenCalledOnce()
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

    expect(project.openEditor).toHaveBeenCalledWith(
      '/projects/bracket/main.kcl',
      editor,
      'cube(1)',
      false
    )
    expect(project.closeEditor).toHaveBeenCalledWith(
      '/projects/bracket/main.kcl'
    )
    expect(project.closeAllEditors).toHaveBeenCalledOnce()
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

    expect(project.createFile).toHaveBeenCalledWith({
      path: '/projects/bracket/new.kcl',
    })
    expect(project.writeFile).toHaveBeenCalledWith({
      path: '/projects/bracket/main.kcl',
      contents: 'cube(1)',
    })
    expect(project.createFolder).toHaveBeenCalledWith({
      path: '/projects/bracket/parts',
    })
    expect(project.renameEntry).toHaveBeenCalledWith({
      oldPath: '/projects/bracket/old.kcl',
      newPath: '/projects/bracket/new.kcl',
    })
    expect(project.copyEntry).toHaveBeenCalledWith({
      sourcePath: '/projects/bracket/new.kcl',
      targetPath: '/projects/bracket/copy.kcl',
    })
    expect(project.moveEntry).toHaveBeenCalledWith({
      sourcePath: '/projects/bracket/copy.kcl',
      targetPath: '/projects/bracket/parts/copy.kcl',
    })
    expect(project.deleteEntry).toHaveBeenCalledWith({
      path: '/projects/bracket/parts/copy.kcl',
    })
    expect(project.archiveEntry).toHaveBeenCalledWith({
      path: '/projects/bracket/new.kcl',
    })
    expect(project.applyFilePatch).toHaveBeenCalledWith({
      files: [{ path: '/projects/bracket/main.kcl', contents: 'cube(2)' }],
    })
    expect(project.refreshProjectTree).toHaveBeenCalledTimes(9)
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
    project.createFile = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finishCreateFile = () => resolve('/projects/bracket/new.kcl')
        })
    )
    projectSession.setProject(project)

    const pendingCreate = projectSession.createFile({
      path: '/projects/bracket/new.kcl',
    })

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
