import { act, cleanup, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useApp: vi.fn(),
  useSingletons: vi.fn(),
  loading: vi.fn(),
}))

vi.mock('@src/lib/boot', () => ({
  useApp: mocks.useApp,
  useSingletons: mocks.useSingletons,
}))
vi.mock('@src/hooks/useNetworkContext', () => ({
  useNetworkContext: () => ({ overallState: 'Ok' }),
}))
vi.mock('@src/hooks/useMenu', () => ({ useMenuListener: vi.fn() }))
vi.mock('@src/hooks/useSketchModeMenuEnableDisable', () => ({
  useSketchModeMenuEnableDisable: vi.fn(),
}))

import { ModelingMachineProvider } from '@src/components/ModelingMachineProvider'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { createKclManagerTestHarness } from '@src/lang/testHelpers/kclManagerTestHarness'
import type { Project } from '@src/lib/project'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type { Actor } from 'xstate'
import type { modelingMachine } from '@src/machines/modelingMachine'
import { projectSession } from '@src/registry/contracts/projectSession'

const projectInfo: Project = {
  name: 'test',
  path: '/test',
  default_file: 'main.kcl',
  children: [],
  directory_count: 0,
  kcl_file_count: 2,
  metadata: null,
  readWriteAccess: true,
}

function Loading() {
  mocks.loading()
  return <div>Loading Design Studio...</div>
}

function ModelingContents() {
  const { actor } = useModelingContext()
  return <div>Editing {actor.getSnapshot().context.fileName}</div>
}

function ModelingView() {
  return (
    <Suspense fallback={<Loading />}>
      <ModelingMachineProvider>
        <ModelingContents />
      </ModelingMachineProvider>
    </Suspense>
  )
}

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

it('renders project opens and file switches without showing the full-app loading fallback', async () => {
  const { app, kclManager } = createKclManagerTestHarness()
  mocks.useApp.mockReturnValue(app)
  mocks.useSingletons.mockReturnValue({ kclManager })
  vi.spyOn(
    app.registry.get(projectSession).textFileIO,
    'read'
  ).mockResolvedValue('')
  try {
    const project = await app.openProject(projectInfo)
    await project.openEditor('/test/main.kcl', kclManager, '')
    render(<ModelingView />)
    expect(screen.getByText('Editing main.kcl')).toBeVisible()
    expect(mocks.loading).not.toHaveBeenCalled()

    // File routes currently replace the project session even within one project.
    // Hold actor initialization open to exercise rendering during that gap.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let initializing!: () => void
    const started = new Promise<void>((resolve) => {
      initializing = resolve
    })
    const initialize = vi.spyOn(kclManager, 'modelingActorPromise', 'get')
    let readyActor: Actor<typeof modelingMachine> | undefined
    initialize.mockImplementation(() => {
      initializing()
      return gate
        .then(() => {
          initialize.mockRestore()
          return kclManager.modelingActorPromise
        })
        .then((actor) => {
          readyActor = actor
          return actor
        })
    })
    let opened = false
    const switching = (async () => {
      const nextProject = await app.openProject(projectInfo)
      await nextProject.openEditor('/test/other.kcl', kclManager, '')
      opened = true
    })()
    await act(async () => {
      await started
    })
    expect(opened).toBe(false)
    expect(screen.getByText('Editing main.kcl')).toBeVisible()
    expect(mocks.loading).not.toHaveBeenCalled()
    await act(async () => {
      release()
      await switching
    })
    expect(readyActor?.getSnapshot().status).toBe('active')
    expect(screen.getByText('Editing other.kcl')).toBeVisible()
    const exportCommand = app.commands.actor
      .getSnapshot()
      .context.commands.find(
        (command) => command.groupId === 'modeling' && command.name === 'Export'
      )
    expect(exportCommand).toBeDefined()
    expect(exportCommand?.machineActor === readyActor).toBe(true)
    expect(mocks.loading).not.toHaveBeenCalled()
  } finally {
    cleanup()
    app.dispose()
  }
})
