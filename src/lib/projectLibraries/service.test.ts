import { signal } from '@preact/signals-core'
import { FileNotFound } from '@src/lib/fileSystem/fileOperations'
import { createProjectLibraries } from '@src/lib/projectLibraries/service'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))
vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('@chainner/node-path')).posix,
}))

function setup() {
  const project = {
    projectIORefSignal: signal<{ path: string; libraryPath?: string }>({
      path: '/outside/part',
      libraryPath: undefined,
    }),
  }
  let current: typeof project | undefined = project
  const dependencies = {
    getProject: () => current,
    getLibraries: () => [
      { title: 'Projects', type: 'directory', path: '/configured' },
    ],
    getDefaultProjectName: () => 'untitled',
    listProjects: vi.fn(async (_directory: string) => []),
    refreshProject: vi.fn(async () => undefined),
    navigateHome: vi.fn(async () => {}),
  }
  return {
    project,
    setProject: (next: typeof current) => {
      current = next
    },
    dependencies,
    service: createProjectLibraries(dependencies),
  }
}

function missingProject() {
  return new FileNotFound({
    operation: 'stat',
    path: '/outside/part',
    cause: 'ENOENT',
    message: 'Removed',
  })
}

describe('project library selection and refresh', () => {
  it('uses the owning library, then the project parent, then the configured directory', () => {
    const { project, service, setProject } = setup()
    expect(service.projectDirectoryPath).toBe('/outside')
    project.projectIORefSignal.value = {
      path: '/outside/part',
      libraryPath: '/owner',
    }
    expect(service.projectDirectoryPath).toBe('/owner')
    setProject(undefined)
    expect(service.projectDirectoryPath).toBe('/configured')
  })

  it('refreshes the selected library listing and current project tree', async () => {
    const { service, dependencies } = setup()
    await service.refreshProjects()
    expect(dependencies.listProjects).toHaveBeenCalledWith('/outside')
    expect(dependencies.refreshProject).toHaveBeenCalledOnce()
  })

  it('still refreshes the session when there is no directory library', async () => {
    const { dependencies, setProject } = setup()
    setProject(undefined)
    const service = createProjectLibraries({
      ...dependencies,
      getLibraries: () => [],
    })
    await service.refreshProjects()
    expect(dependencies.listProjects).not.toHaveBeenCalled()
    expect(dependencies.refreshProject).toHaveBeenCalledOnce()
  })

  it('returns home when the current project disappears', async () => {
    const { dependencies, service } = setup()
    dependencies.refreshProject.mockRejectedValueOnce(missingProject())
    await service.refreshProjects()
    expect(dependencies.navigateHome).toHaveBeenCalledOnce()
  })

  it('reports refresh failures without navigating away from an accessible project', async () => {
    const { dependencies, service } = setup()
    const error = new Error('Permission denied')
    dependencies.refreshProject.mockRejectedValueOnce(error)
    await expect(service.refreshProjects()).rejects.toBe(error)
    expect(dependencies.navigateHome).not.toHaveBeenCalled()
  })

  it.each(['switched', 'closed'])(
    'does not navigate away when the missing project was %s during refresh',
    async (action) => {
      const { dependencies, service, setProject } = setup()
      let rejectRefresh: (error: Error) => void = () => {}
      dependencies.refreshProject.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectRefresh = reject
          })
      )
      const refreshing = service.refreshProjects()
      setProject(
        action === 'closed'
          ? undefined
          : {
              projectIORefSignal: signal({
                path: '/other/project',
                libraryPath: undefined,
              }),
            }
      )
      const error = missingProject()
      rejectRefresh(error)
      await expect(refreshing).rejects.toBe(error)
      expect(dependencies.navigateHome).not.toHaveBeenCalled()
    }
  )
})
