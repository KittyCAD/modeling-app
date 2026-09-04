import { signal } from '@preact/signals-core'
import type { KclManager, ZDSProject } from '@src/lang/KclManager'
import type { BillingRegistryService } from '@src/lib/billing'
import type { FileEntry, Project } from '@src/lib/project'
import type {
  ZookeeperSessionController,
  ZookeeperSessionControllerDependencies,
} from '@src/lib/zookeeper/registry/controller'
import { createZookeeperRuntime } from '@src/lib/zookeeper/registry/runtime'
import type { AuthRegistryService } from '@src/registry/contracts/auth'
import type { ProjectSessionService } from '@src/registry/contracts/projectSession'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import type { SystemIORegistryService } from '@src/registry/contracts/systemIO'
import { describe, expect, it, vi } from 'vitest'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createProject(
  path: string,
  ready = true,
  providedKclManager?: KclManager
) {
  const filePath = `${path}/main.kcl`
  const editorPath = signal(filePath)
  const kclManager =
    providedKclManager ??
    ({
      get path() {
        return editorPath.value
      },
      set path(nextPath: string) {
        editorPath.value = nextPath
      },
    } as KclManager)
  const executingEditor = signal<KclManager | undefined>(
    ready ? kclManager : undefined
  )
  const executingFileEntry = signal<FileEntry | undefined>(
    ready ? ({ path: filePath } as FileEntry) : undefined
  )
  const project = {
    executingEditor,
    executingFileEntry,
    projectIORefSignal: signal({ path } as Project),
  } as ZDSProject

  return { executingEditor, executingFileEntry, kclManager, project }
}

function createServices({
  apiToken = 'token',
  projectPath = '/project',
}: {
  apiToken?: string
  projectPath?: string
} = {}) {
  const token = signal(apiToken)
  const isLoggedIn = signal(true)
  const projectFixture = createProject(projectPath)
  const currentProject = signal<ZDSProject | undefined>(projectFixture.project)
  const projectSession = {
    project: currentProject,
  } as ProjectSessionService

  return {
    currentProject,
    projectFixture,
    services: {
      auth: signal({ isLoggedIn, token } as AuthRegistryService),
      billing: signal({} as BillingRegistryService),
      projectSession: signal(projectSession),
      settings: signal({} as SettingsRegistryService),
      systemIO: signal({} as SystemIORegistryService),
    },
    isLoggedIn,
    token,
  }
}

function createController(
  projectPath: string,
  disposal: Promise<void> = Promise.resolve()
) {
  const dispose = vi.fn(() => disposal)
  const updateAuthToken = vi.fn()
  const controller = {
    dispose,
    projectPath,
    updateAuthToken,
  } as unknown as ZookeeperSessionController

  return { controller, dispose, updateAuthToken }
}

function createControllerLoader(
  getDisposal: (index: number) => Promise<void> = () => Promise.resolve()
) {
  const controllers: ReturnType<typeof createController>[] = []
  const createZookeeperSessionController = vi.fn(
    (deps: ZookeeperSessionControllerDependencies) => {
      const controller = createController(
        deps.projectPath,
        getDisposal(controllers.length)
      )
      controllers.push(controller)
      return controller.controller
    }
  )
  const loadController = vi.fn(async () => ({
    createZookeeperSessionController,
  }))

  return { controllers, createZookeeperSessionController, loadController }
}

describe('Zookeeper runtime', () => {
  it('starts without waiting for the pane once auth is hydrated', async () => {
    const { services, token } = createServices({ apiToken: '' })
    const { createZookeeperSessionController, loadController } =
      createControllerLoader()
    const runtime = createZookeeperRuntime(services, loadController)

    await Promise.resolve()
    expect(loadController).not.toHaveBeenCalled()

    token.value = 'hydrated-token'

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })
    expect(createZookeeperSessionController).toHaveBeenCalledWith(
      expect.objectContaining({
        apiToken: 'hydrated-token',
        projectPath: '/project',
      })
    )

    await runtime.dispose()
  })

  it('waits for the executing editor and file before starting', async () => {
    const { projectFixture, services } = createServices()
    const { createZookeeperSessionController, loadController } =
      createControllerLoader()
    projectFixture.executingEditor.value = undefined
    projectFixture.executingFileEntry.value = undefined
    const runtime = createZookeeperRuntime(services, loadController)

    await Promise.resolve()
    expect(loadController).not.toHaveBeenCalled()

    projectFixture.executingEditor.value = projectFixture.kclManager
    await Promise.resolve()
    expect(loadController).not.toHaveBeenCalled()

    projectFixture.executingFileEntry.value = {
      path: projectFixture.kclManager.path,
    } as FileEntry

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })
    expect(createZookeeperSessionController).toHaveBeenCalledWith(
      expect.objectContaining({
        kclManager: projectFixture.kclManager,
        projectPath: '/project',
      })
    )
    expect(
      createZookeeperSessionController.mock.calls[0]?.[0].project.value
    ).toBe(projectFixture.project)

    await runtime.dispose()
  })

  it('updates auth in place without replacing the controller', async () => {
    const { services, token } = createServices()
    const { controllers, createZookeeperSessionController, loadController } =
      createControllerLoader()
    const runtime = createZookeeperRuntime(services, loadController)

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })
    expect(runtime.session.value).toBe(controllers[0]?.controller)
    const session = runtime.session.value

    token.value = 'rotated-token'

    await vi.waitFor(() => {
      expect(controllers[0]?.updateAuthToken).toHaveBeenCalledWith(
        'rotated-token'
      )
    })
    expect(runtime.session.value).toBe(session)
    expect(createZookeeperSessionController).toHaveBeenCalledOnce()

    await runtime.dispose()
  })

  it('replaces the controller when the executing editor is replaced', async () => {
    const { projectFixture, services } = createServices()
    const { controllers, createZookeeperSessionController, loadController } =
      createControllerLoader()
    const runtime = createZookeeperRuntime(services, loadController)

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })

    const replacement = {
      path: projectFixture.kclManager.path,
    } as KclManager
    projectFixture.executingEditor.value = replacement

    await vi.waitFor(() => {
      expect(controllers[0]?.dispose).toHaveBeenCalledOnce()
      expect(createZookeeperSessionController).toHaveBeenCalledTimes(2)
    })
    expect(createZookeeperSessionController).toHaveBeenLastCalledWith(
      expect.objectContaining({ kclManager: replacement })
    )

    await runtime.dispose()
  })

  it('retains the controller while the same editor switches files', async () => {
    const { projectFixture, services } = createServices()
    const { controllers, createZookeeperSessionController, loadController } =
      createControllerLoader()
    const runtime = createZookeeperRuntime(services, loadController)

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })

    projectFixture.kclManager.path = '/project/other.kcl'
    await Promise.resolve()

    expect(controllers[0]?.dispose).not.toHaveBeenCalled()
    expect(createZookeeperSessionController).toHaveBeenCalledOnce()

    projectFixture.executingFileEntry.value = {
      path: projectFixture.kclManager.path,
    } as FileEntry

    expect(runtime.session.value).toBe(controllers[0]?.controller)
    expect(loadController).toHaveBeenCalledOnce()

    await runtime.dispose()
  })

  it('retains the controller through a temporary executing editor gap', async () => {
    const { projectFixture, services } = createServices()
    const { controllers, createZookeeperSessionController, loadController } =
      createControllerLoader()
    const runtime = createZookeeperRuntime(services, loadController)

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })

    projectFixture.executingEditor.value = undefined
    await Promise.resolve()

    expect(runtime.session.value).toBe(controllers[0]?.controller)
    expect(controllers[0]?.dispose).not.toHaveBeenCalled()

    projectFixture.executingEditor.value = projectFixture.kclManager

    expect(runtime.session.value).toBe(controllers[0]?.controller)
    expect(loadController).toHaveBeenCalledOnce()

    await runtime.dispose()
  })

  it('retains the controller when a file route republishes the same project', async () => {
    const { currentProject, projectFixture, services } = createServices()
    const { controllers, createZookeeperSessionController, loadController } =
      createControllerLoader()
    const runtime = createZookeeperRuntime(services, loadController)

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })

    currentProject.value = createProject(
      '/project',
      true,
      projectFixture.kclManager
    ).project

    expect(runtime.session.value).toBe(controllers[0]?.controller)
    expect(controllers[0]?.dispose).not.toHaveBeenCalled()
    expect(loadController).toHaveBeenCalledOnce()

    await runtime.dispose()
  })

  it('retains the controller when the project session signal is rewrapped', async () => {
    const { projectFixture, services } = createServices()
    const { controllers, createZookeeperSessionController, loadController } =
      createControllerLoader()
    const runtime = createZookeeperRuntime(services, loadController)

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })

    const replacementProject = createProject(
      '/project',
      true,
      projectFixture.kclManager
    ).project
    services.projectSession.value = {
      project: signal(replacementProject),
    } as ProjectSessionService

    expect(runtime.session.value).toBe(controllers[0]?.controller)
    expect(controllers[0]?.dispose).not.toHaveBeenCalled()
    expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    expect(
      createZookeeperSessionController.mock.calls[0]?.[0].project.value
    ).toBe(replacementProject)

    await runtime.dispose()
  })

  it('retains an active controller through a transient blank token', async () => {
    const { services, token } = createServices()
    const { controllers, createZookeeperSessionController, loadController } =
      createControllerLoader()
    const runtime = createZookeeperRuntime(services, loadController)

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })
    const session = runtime.session.value

    token.value = ''
    await vi.waitFor(() => {
      expect(controllers[0]?.updateAuthToken).toHaveBeenCalledWith('')
    })
    expect(runtime.session.value).toBe(session)
    expect(controllers[0]?.dispose).not.toHaveBeenCalled()

    token.value = 'refreshed-token'
    await vi.waitFor(() => {
      expect(controllers[0]?.updateAuthToken).toHaveBeenLastCalledWith(
        'refreshed-token'
      )
    })
    expect(runtime.session.value).toBe(session)
    expect(createZookeeperSessionController).toHaveBeenCalledOnce()

    await runtime.dispose()
  })

  it('stops on auth loss and starts fresh after login', async () => {
    const { isLoggedIn, services } = createServices()
    const { controllers, createZookeeperSessionController, loadController } =
      createControllerLoader()
    const runtime = createZookeeperRuntime(services, loadController)

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })

    isLoggedIn.value = false
    await vi.waitFor(() => {
      expect(controllers[0]?.dispose).toHaveBeenCalledOnce()
    })
    expect(runtime.session.value).toBeUndefined()

    isLoggedIn.value = true
    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledTimes(2)
    })
    expect(runtime.session.value).toBe(controllers[1]?.controller)

    await runtime.dispose()
  })

  it('stops a stale project and starts its replacement', async () => {
    const { currentProject, services } = createServices({
      projectPath: '/first',
    })
    const { controllers, createZookeeperSessionController, loadController } =
      createControllerLoader()
    const runtime = createZookeeperRuntime(services, loadController)

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })
    expect(runtime.session.value).toBe(controllers[0]?.controller)
    currentProject.value = createProject('/second').project

    await vi.waitFor(() => {
      expect(controllers[0]?.dispose).toHaveBeenCalledOnce()
      expect(createZookeeperSessionController).toHaveBeenCalledTimes(2)
    })
    expect(runtime.session.value).toBe(controllers[1]?.controller)

    await runtime.dispose()
    expect(controllers[1]?.dispose).toHaveBeenCalledOnce()
  })

  it('waits for a shared editor to drain before starting another project', async () => {
    const { currentProject, projectFixture, services } = createServices({
      projectPath: '/first',
    })
    const drain = deferred<undefined>()
    const { controllers, createZookeeperSessionController, loadController } =
      createControllerLoader((index) =>
        index === 0 ? drain.promise : Promise.resolve()
      )
    const runtime = createZookeeperRuntime(services, loadController)

    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    })

    projectFixture.kclManager.path = '/second/main.kcl'
    currentProject.value = createProject(
      '/second',
      true,
      projectFixture.kclManager
    ).project

    await vi.waitFor(() => {
      expect(controllers[0]?.dispose).toHaveBeenCalledOnce()
    })
    expect(createZookeeperSessionController).toHaveBeenCalledOnce()
    expect(runtime.session.value).toBeUndefined()

    drain.resolve(undefined)
    await vi.waitFor(() => {
      expect(createZookeeperSessionController).toHaveBeenCalledTimes(2)
    })
    expect(runtime.session.value).toBe(controllers[1]?.controller)

    await runtime.dispose()
  })

  it('does not create a controller when disposed during its lazy load', async () => {
    const { services } = createServices()
    const controllerModule = deferred<{
      createZookeeperSessionController: (
        deps: ZookeeperSessionControllerDependencies
      ) => ZookeeperSessionController
    }>()
    const createZookeeperSessionController = vi.fn(
      (deps: ZookeeperSessionControllerDependencies) =>
        createController(deps.projectPath).controller
    )
    const loadController = vi.fn(() => controllerModule.promise)
    const runtime = createZookeeperRuntime(services, loadController)

    await Promise.resolve()
    expect(loadController).toHaveBeenCalledOnce()

    await runtime.dispose()
    controllerModule.resolve({ createZookeeperSessionController })
    await Promise.resolve()
    await Promise.resolve()

    expect(createZookeeperSessionController).not.toHaveBeenCalled()
    expect(runtime.session.value).toBeUndefined()
  })

  it('retries a failed controller load after a delay', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const { services } = createServices()
      const { controller } = createController('/project')
      const createZookeeperSessionController = vi.fn(() => controller)
      const loadController = vi
        .fn()
        .mockRejectedValueOnce(new Error('first load failed'))
        .mockRejectedValueOnce(new Error('second load failed'))
        .mockResolvedValue({ createZookeeperSessionController })
      const runtime = createZookeeperRuntime(services, loadController)

      await vi.advanceTimersByTimeAsync(0)
      expect(loadController).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(999)
      expect(loadController).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(1_000)
      expect(loadController).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(1)
      expect(loadController).toHaveBeenCalledTimes(3)
      expect(createZookeeperSessionController).toHaveBeenCalledOnce()
      expect(runtime.session.value).toBe(controller)

      await runtime.dispose()
    } finally {
      consoleError.mockRestore()
      vi.useRealTimers()
    }
  })

  it('cancels a pending controller load retry when disposed', async () => {
    vi.useFakeTimers()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const { services } = createServices()
      const loadController = vi.fn().mockRejectedValue(new Error('load failed'))
      const runtime = createZookeeperRuntime(services, loadController)

      await vi.advanceTimersByTimeAsync(0)
      expect(loadController).toHaveBeenCalledOnce()

      await runtime.dispose()
      await vi.runAllTimersAsync()

      expect(loadController).toHaveBeenCalledOnce()
    } finally {
      consoleError.mockRestore()
      vi.useRealTimers()
    }
  })

  it('returns an in-progress project drain and gates the next runtime by editor', async () => {
    const { currentProject, projectFixture, services } = createServices({
      projectPath: '/first',
    })
    const drain = deferred<undefined>()
    const firstController = createController('/first', drain.promise)
    const firstFactory = vi.fn(() => firstController.controller)
    const firstRuntime = createZookeeperRuntime(
      services,
      vi.fn(async () => ({
        createZookeeperSessionController: firstFactory,
      }))
    )

    await vi.waitFor(() => expect(firstFactory).toHaveBeenCalledOnce())
    projectFixture.kclManager.path = '/second/main.kcl'
    currentProject.value = createProject(
      '/second',
      true,
      projectFixture.kclManager
    ).project
    await vi.waitFor(() => expect(firstController.dispose).toHaveBeenCalled())

    const firstDisposal = firstRuntime.dispose()
    let firstDisposalFinished = false
    void firstDisposal.then(() => {
      firstDisposalFinished = true
    })
    await Promise.resolve()
    expect(firstDisposalFinished).toBe(false)

    const secondLoader = createControllerLoader()
    const secondRuntime = createZookeeperRuntime(
      services,
      secondLoader.loadController
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(secondLoader.loadController).not.toHaveBeenCalled()

    drain.resolve(undefined)
    await firstDisposal
    expect(firstDisposalFinished).toBe(true)
    await vi.waitFor(() => {
      expect(
        secondLoader.createZookeeperSessionController
      ).toHaveBeenCalledOnce()
    })

    await secondRuntime.dispose()
  })
})
