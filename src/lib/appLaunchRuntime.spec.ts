import { signal } from '@preact/signals-core'
import type { App } from '@src/lib/app'
import { createAppLaunchDependencies } from '@src/lib/appLaunchRuntime'
import { parseLaunchRequest } from '@src/lib/launchRequest'
import { PERSONAL_CLOUD_PROJECT_LIBRARY_ID } from '@src/lib/projectLibraries'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import type { AppLaunchInput } from '@src/registry/contracts/appLaunch'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { appUrlService } from '@src/registry/contracts/appUrl'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, createMachine, fromTransition } from 'xstate'

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  getProjectName: vi.fn(),
  downloadProject: vi.fn(),
  downloadSample: vi.fn(),
  isDesktop: vi.fn(() => false),
  toastError: vi.fn(),
}))

vi.mock('@src/lib/initializeApplication', () => ({
  restoreApplicationDestination: mocks.restore,
}))
vi.mock('@src/lib/routeInit', () => ({
  DEFAULT_WEB_PROJECT_NAME: 'demo-project',
}))
vi.mock('@src/lib/downloadProject', () => ({
  getPublicProjectNameById: mocks.getProjectName,
  downloadProjectById: mocks.downloadProject,
}))
vi.mock('@src/lib/kclSamples', () => ({
  downloadKclSample: mocks.downloadSample,
}))
vi.mock('@src/lib/isDesktop', () => ({ isDesktop: mocks.isDesktop }))
vi.mock('@src/lib/fs-zds', () => ({
  default: {
    basename: (path: string) => path.slice(path.lastIndexOf('/') + 1),
  },
}))
vi.mock('@src/lib/trap', () => ({
  isErr: (value: unknown) => value instanceof Error,
  err: (value: unknown) => value instanceof Error,
}))
vi.mock('react-hot-toast', () => ({ default: { error: mocks.toastError } }))

type CommandEntry = { name: string; groupId: string }

const stopActors: (() => void)[] = []

function harness({
  commands = [{ name: 'set-layout', groupId: 'application' }],
  initialProject = '/existing',
  promptService = true,
}: {
  commands?: CommandEntry[]
  initialProject?: string
  promptService?: boolean
} = {}) {
  let projectPath = initialProject
  const commandActor = createActor(
    fromTransition(
      (
        _state: { commands: CommandEntry[] },
        event: { type: 'register'; commands: CommandEntry[] }
      ) => ({
        commands: event.commands,
      }),
      { commands }
    )
  ).start()
  const settingsActor = createActor(
    createMachine({ initial: 'idle', states: { idle: {} } })
  ).start()
  const systemActor = createActor(
    createMachine({ initial: 'idle', states: { idle: {} } })
  ).start()
  stopActors.push(
    () => commandActor.stop(),
    () => settingsActor.stop(),
    () => systemActor.stop()
  )
  const sendCommand = vi.fn()
  const seedPrompt = vi.fn(() => true)
  const createDirectory = vi.fn(async () => ({
    name: 'demo-project',
    path: '/directory/demo-project',
    default_file: '/directory/demo-project/main.kcl',
  }))
  const createCloud = vi.fn(async () => ({
    name: 'demo-project',
    path: '/cloud/demo-project',
    default_file: '/cloud/demo-project/main.kcl',
  }))
  const sync = vi.fn(async () => undefined)
  const navigate = vi.fn(async () => undefined)
  const openProject = vi.fn(async ({ target }: { target: string }) => {
    projectPath = target.slice(0, target.lastIndexOf('/'))
    return { kind: 'opened' as const, data: { code: '' } }
  })
  const systemSend = vi.fn()
  const app = {
    auth: { isLoggedIn: signal(true) },
    commands: { actor: commandActor, send: sendCommand },
    get project() {
      return projectPath
        ? { projectIORefSignal: signal({ path: projectPath }) }
        : undefined
    },
    settings: {
      actor: {
        ...settingsActor,
        getSnapshot: () => ({
          ...settingsActor.getSnapshot(),
          context: {
            currentProject: projectPath ? { name: 'existing' } : undefined,
          },
        }),
      },
    },
    systemIOActor: {
      ...systemActor,
      getSnapshot: () => ({
        ...systemActor.getSnapshot(),
        context: {
          projectDirectoryPath: '/directory',
          folders:
            projectPath === '/directory/demo-project'
              ? [{ name: 'demo-project' }]
              : [],
        },
      }),
      send: systemSend,
    },
    getCreateProjectLibraryTargets: () => [
      {
        library: { id: 'directory', type: 'directory', path: '/directory' },
        createProject: { run: createDirectory },
      },
      {
        library: {
          id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
          type: 'cloud',
          path: '/cloud',
        },
        createProject: { run: createCloud },
      },
    ],
    registry: {
      get: (contract: unknown) => {
        if (contract === appNavigationService)
          return { intentRevision: signal(0), openProject }
        if (contract === cloudSyncService)
          return { status: signal({ enabled: true }), syncNow: sync }
        if (contract === appUrlService)
          return {
            navigate,
            getLocation: () => ({
              pathname: '/home',
              search: '?ask-open-desktop&ttc-prompt=Cube&pool=alpha',
              hash: '#anchor',
            }),
          }
        return undefined
      },
      optional: () => (promptService ? { seedPrompt } : undefined),
    },
  } as unknown as App
  const deps = createAppLaunchDependencies(app)
  return {
    deps,
    openProject,
    sendCommand,
    seedPrompt,
    commandActor,
    createDirectory,
    createCloud,
    sync,
    navigate,
    systemSend,
  }
}

function input(search: string): AppLaunchInput {
  const parsed = parseLaunchRequest(search)
  if (!parsed.request) throw new Error('The fixture needs a launch request')
  return {
    destination: { type: 'home' },
    urlState: { search, hash: '#anchor' },
    ...parsed,
    request: parsed.request,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isDesktop.mockReturnValue(false)
  mocks.restore.mockResolvedValue(undefined)
  mocks.getProjectName.mockResolvedValue('Shared project')
  mocks.downloadProject.mockResolvedValue({
    files: [],
    entrypointFilePath: 'main.kcl',
  })
})

afterEach(() => {
  for (const stop of stopActors.splice(0)) stop()
  vi.useRealTimers()
})

describe('application launch runtime', () => {
  it('creates the cloud layout project before delivering its retained prompt', async () => {
    const h = harness({ initialProject: '' })
    await h.deps.execute(
      input(
        '?cmd=set-layout&groupId=application&layoutId=zookeeper&ttc-prompt=Cube&pool=alpha'
      ),
      { signal: new AbortController().signal, openProject: h.openProject }
    )
    expect(h.createDirectory).not.toHaveBeenCalled()
    expect(h.createCloud).toHaveBeenCalledOnce()
    expect(h.openProject).toHaveBeenCalledWith({
      target: '/cloud/demo-project/main.kcl',
      startup: { search: '?pool=alpha', hash: '#anchor' },
    })
    expect(h.seedPrompt).toHaveBeenCalledWith('/cloud/demo-project', 'Cube')
    expect(h.openProject).toHaveBeenCalledBefore(h.seedPrompt)
    expect(h.sendCommand).toHaveBeenCalledOnce()
  })

  it('prefills while command registration is pending, then dispatches once', async () => {
    const h = harness({ commands: [] })
    const done = h.deps.execute(
      input('?cmd=set-layout&groupId=application&ttc-prompt=Cube'),
      { signal: new AbortController().signal, openProject: h.openProject }
    )
    await vi.waitFor(() =>
      expect(h.seedPrompt).toHaveBeenCalledWith('/existing', 'Cube')
    )
    expect(h.sendCommand).not.toHaveBeenCalled()
    h.commandActor.send({
      type: 'register',
      commands: [{ name: 'set-layout', groupId: 'application' }],
    })
    await done
    expect(h.sendCommand).toHaveBeenCalledOnce()
  })

  it('never dispatches a canceled command after registration', async () => {
    const h = harness({ commands: [] })
    const abort = new AbortController()
    const done = h.deps.execute(
      input('?cmd=set-layout&groupId=application&ttc-prompt=Cube'),
      { signal: abort.signal, openProject: h.openProject }
    )
    await vi.waitFor(() => expect(h.seedPrompt).toHaveBeenCalledOnce())
    abort.abort()
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    h.commandActor.send({
      type: 'register',
      commands: [{ name: 'set-layout', groupId: 'application' }],
    })
    expect(h.sendCommand).not.toHaveBeenCalled()
  })

  it('reports an unavailable prompt capability without blocking the command', async () => {
    const h = harness({ promptService: false })
    await h.deps.execute(
      input('?cmd=set-layout&groupId=application&ttc-prompt=Cube'),
      { signal: new AbortController().signal, openProject: h.openProject }
    )
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Unable to prefill Zookeeper for this project.'
    )
    expect(h.sendCommand).toHaveBeenCalledOnce()
  })

  it('stops a stale shared-project download before creating or opening its project', async () => {
    let finishDownload!: (value: { files: never[] }) => void
    mocks.downloadProject.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDownload = resolve
        })
    )
    const h = harness()
    const abort = new AbortController()
    const done = h.deps.execute(input('?project-id=shared&ttc-prompt=Cube'), {
      signal: abort.signal,
      openProject: h.openProject,
    })
    await vi.waitFor(() => expect(mocks.downloadProject).toHaveBeenCalledOnce())
    abort.abort()
    finishDownload({ files: [] })
    await expect(done).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.createDirectory).not.toHaveBeenCalled()
    expect(h.openProject).not.toHaveBeenCalled()
    expect(h.seedPrompt).not.toHaveBeenCalled()
  })

  it('creates a legacy default project through owned navigation before seeding', async () => {
    const h = harness({
      initialProject: '',
      commands: [{ name: 'add-kcl-file-to-project', groupId: 'application' }],
    })
    await h.deps.execute(
      input(
        '?cmd=add-kcl-file-to-project&groupId=application&projectName=browser&ttc-prompt=Cube'
      ),
      { signal: new AbortController().signal, openProject: h.openProject }
    )
    expect(h.createDirectory).toHaveBeenCalledOnce()
    expect(h.createCloud).not.toHaveBeenCalled()
    expect(h.seedPrompt).toHaveBeenCalledWith('/directory/demo-project', 'Cube')
    expect(h.systemSend).toHaveBeenCalledExactlyOnceWith({
      type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
    })
    expect(h.sendCommand).toHaveBeenCalledWith({
      type: 'Find and select command',
      data: {
        name: 'add-kcl-file-to-project',
        groupId: 'application',
        argDefaultValues: {
          projectName: 'demo-project',
          method: 'existingProject',
        },
      },
    })
  })

  it('imports sample links directly without also dispatching their command', async () => {
    mocks.downloadSample.mockResolvedValue({
      requestedProjectName: 'cube',
      sample: { title: 'Cube' },
      initialProject: { files: [], entrypointFilePath: 'main.kcl' },
    })
    const h = harness()
    await h.deps.execute(
      input(
        '?cmd=add-kcl-file-to-project&groupId=application&source=kcl-samples&sample=cube&projectName=browser&ttc-prompt=Cube'
      ),
      { signal: new AbortController().signal, openProject: h.openProject }
    )
    expect(mocks.downloadSample).toHaveBeenCalledWith('cube')
    expect(h.createDirectory).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedProjectName: 'cube',
        requestedProjectTitle: 'Cube',
      })
    )
    expect(h.openProject).toHaveBeenCalledBefore(h.seedPrompt)
    expect(h.sendCommand).not.toHaveBeenCalled()
  })

  it('preserves legacy desktop import defaults and decodes base64 once', async () => {
    mocks.isDesktop.mockReturnValue(true)
    const h = harness({
      commands: [{ groupId: 'projects', name: 'Import file from URL' }],
    })
    await h.deps.execute(input('?create-file&code=YWI%3D&name=ignored.kcl'), {
      signal: new AbortController().signal,
      openProject: h.openProject,
    })
    expect(h.sendCommand).toHaveBeenCalledExactlyOnceWith({
      type: 'Find and select command',
      data: {
        groupId: 'projects',
        name: 'Import file from URL',
        argDefaultValues: { name: 'main.kcl', code: 'ab', method: undefined },
      },
    })
  })

  it('names the unavailable command when registration times out', async () => {
    vi.useFakeTimers()
    const h = harness({ commands: [] })
    const done = h.deps.execute(input('?cmd=missing&groupId=plugin'), {
      signal: new AbortController().signal,
      openProject: h.openProject,
    })
    const rejected = expect(done).rejects.toThrow(
      'The command "plugin/missing" is unavailable.'
    )
    await vi.advanceTimersByTimeAsync(30_001)
    await rejected
    expect(h.sendCommand).not.toHaveBeenCalled()
  })
})
