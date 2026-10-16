import type { App } from '@src/lib/app'
import { createApplicationCommands } from '@src/lib/commandBarConfigs/applicationCommandConfig'
import type { ProjectLibraryCreateProjectInput } from '@src/registry/contracts/projectLibraries'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lang/project', () => ({
  newKclFile: vi.fn(
    (code: string | undefined) => code ?? '@settings(kclVersion = 3.0)\n'
  ),
}))
vi.mock('@src/lib/desktop', () => ({
  writeEnvironmentConfigurationKittycadWebSocketUrl: vi.fn(),
  writeEnvironmentConfigurationZookeeperWebSocketUrl: vi.fn(),
  writeEnvironmentFile: vi.fn(),
}))
vi.mock('@src/lib/desktopFS', () => ({
  getNextFileName: vi.fn(async () => ({ path: '/projects/existing/part.bin' })),
  getUniqueProjectName: vi.fn((name: string) => name),
}))
vi.mock('@src/lib/exportProjectZip', () => ({ exportProjectZip: vi.fn() }))
vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('node:path')).posix,
}))
vi.mock('@src/lib/kclSamples', () => ({
  everyKclSample: [],
  findKclSample: vi.fn(),
  downloadKclSample: vi.fn(),
}))
vi.mock('@src/lib/layout', () => ({
  isUserLoadableLayoutKey: () => false,
  userLoadableLayouts: {},
}))
vi.mock('@src/machines/systemIO/snapshotContext', () => ({
  getAllSubDirectoriesAtProjectRoot: () => [],
}))
vi.mock('@src/machines/systemIO/utils', async () => ({
  SystemIOMachineEvents: (await import('@src/machines/systemIO/events'))
    .SystemIOMachineEvents,
}))

const wasmInstance = {} as ModuleType

function createCommands() {
  const navigate = vi.fn(async () => {})
  const send = vi.fn()
  const libraries = [
    {
      id: 'local',
      title: 'Local Projects',
      path: '/projects',
      type: 'directory',
    },
    { id: 'cloud', title: 'Personal Cloud', path: '/cloud', type: 'cloud' },
  ]
  const targets = libraries.map((library) => ({
    library,
    createProject: {
      run: vi.fn(async (input: ProjectLibraryCreateProjectInput) => ({
        default_file: `${library.path}/${input.requestedProjectName}/${input.initialProject?.entrypointFilePath ?? 'main.kcl'}`,
      })),
    },
  }))
  const app = {
    getCreateProjectLibraryTargets: () => targets,
    registry: { get: () => ({ navigate }) },
    project: { name: 'existing' },
    systemIOActor: {
      getSnapshot: () => ({
        context: {
          defaultProjectFolderName: 'untitled',
          projectDirectoryPath: '/projects',
          folders: [],
        },
      }),
      send,
    },
    settings: {
      actor: {
        getSnapshot: () => ({
          context: { modeling: { defaultUnit: { current: 'mm' } } },
        }),
      },
    },
    fileOperations: {},
    layout: { reset: vi.fn() },
  } as unknown as App
  const command = createApplicationCommands({ app, wasmInstance }).find(
    (command) => command.name === 'add-kcl-file-to-project'
  )
  if (!command) throw new Error('Missing Add file to project command')
  return { command, targets, navigate, send }
}

describe('Add file to project', () => {
  it('creates a complete binary project in the selected library', async () => {
    const { command, targets, navigate } = createCommands()
    const bytes = new Uint8Array([0, 255, 128, 10])
    await command.onSubmit({
      source: 'local',
      method: 'newProject',
      newProjectName: 'Binary Reference',
      libraryId: 'cloud',
      files: new File([bytes], 'part.bin'),
    })

    expect(targets[1].createProject.run).toHaveBeenCalledExactlyOnceWith({
      library: targets[1].library,
      requestedProjectName: 'binary-reference',
      requestedProjectTitle: 'Binary Reference',
      initialProject: {
        entrypointFilePath: 'main.kcl',
        files: [
          {
            requestedFileName: 'main.kcl',
            requestedData: new TextEncoder().encode(
              '@settings(kclVersion = 3.0)\n'
            ),
          },
          { requestedFileName: 'part.bin', requestedData: bytes },
        ],
      },
    })
    expect(navigate).toHaveBeenCalledWith(
      '/file/%2Fcloud%2Fbinary-reference%2Fmain.kcl'
    )
  })

  it('uses the existing project when a previous new-project title remains in the arguments', async () => {
    const { command, send } = createCommands()
    const code = '@settings(kclVersion = 3.0)\nwidth = 10mm\n'
    await command.onSubmit({
      source: 'local',
      method: 'existingProject',
      projectName: 'existing',
      newProjectName: 'Stale Project Title',
      libraryId: 'cloud',
      files: new File([code], 'part.kcl'),
    })

    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: SystemIOMachineEvents.importFileFromURL,
      data: {
        requestedProjectName: 'existing',
        requestedFileNameWithExtension: 'part.kcl',
        requestedCode: code,
      },
    })
  })
})
