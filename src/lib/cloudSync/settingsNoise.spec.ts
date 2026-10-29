import 'fake-indexeddb/auto'
import { join } from 'node:path'
import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import {
  cloudSyncStatus,
  disableCloudSyncEngineForTest,
  installCloudSyncFileSystemObserver,
  setCloudSyncOpenedProject,
} from '@src/lib/cloudSync'
import type * as CloudSyncModule from '@src/lib/cloudSync'
import {
  normalizeProjectArchiveFilesForCloudSync,
  projectManifestFromFiles,
} from '@src/lib/cloudSync/projectArchive'
import { cloudSyncService } from '@src/lib/cloudSync/registry/contract'
import { cloudSyncExtension } from '@src/lib/cloudSync/registry/extension'
import {
  getAllOutboxEntries,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import {
  createCloudSyncTestFs,
  deleteCloudSyncTestDatabase,
  getFetchMethod,
  getFetchUrl,
  jsonResponse,
} from '@src/lib/cloudSync/testUtils'
import { getAppSettingsFilePath } from '@src/lib/desktop'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import fsZds from '@src/lib/fs-zds'
import { createLayoutWithMetadata, defaultLayout } from '@src/lib/layout/utils'
import { MachineManager } from '@src/lib/MachineManager'
import { projectLibrariesSettingsContribution } from '@src/lib/projectLibraries/settings/setting'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import { createSettings } from '@src/lib/settings/initialSettings'
import { saveSettings } from '@src/lib/settings/settingsUtils'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import {
  getOnlySettingsFromContext,
  settingsMachine,
} from '@src/machines/settingsMachine'
import {
  runtimeService,
  type RuntimeInfo,
} from '@src/registry/contracts/runtime'
import { settingsService } from '@src/registry/contracts/settings'
import { expect, it, vi } from 'vitest'
import { createActor, fromCallback, fromPromise, waitFor } from 'xstate'

// Observe the test filesystem explicitly rather than the global app backing.
vi.mock('@src/lib/cloudSync', async (importOriginal) => {
  const original = await importOriginal<typeof CloudSyncModule>()
  return { ...original, configureCloudSync: original.configureCloudSyncEngine }
})

it('persists pane sizes without fetching the cloud project and still syncs project settings edits', async () => {
  await disableCloudSyncEngineForTest()
  await deleteCloudSyncTestDatabase()
  const projectPath = '/cloud-projects/bracket'
  const remote = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'bracket',
    revision: 'rev-1',
    description: '',
    category_ids: [],
  }
  const detailUrl = `https://example.test/user/projects/${remote.id}`
  const files = new Map([
    [`${projectPath}/main.kcl`, '@settings(kclVersion = 3.0)\nx = 1\n'],
    [
      `${projectPath}/project.toml`,
      `title = "bracket"\ndefault_file = "main.kcl"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remote.id}"\n`,
    ],
  ])
  const backing = createCloudSyncTestFs(files, {
    projectDirectory: '/cloud-projects',
  })
  const originalFs = { ...fsZds }
  Object.assign(fsZds, backing)
  const fileOperations = createFileOperationsRuntime(backing)
  const extensionSettings = {
    ...projectLibrariesSettingsContribution,
    plugins: {
      'cloud-sync': defineBooleanExtensionSetting({
        defaultValue: true,
        description: 'Cloud sync',
        hideOnLevel: 'project',
      }),
    },
  }
  const initialSettings = createSettings(extensionSettings)
  initialSettings.app.libraries.user = [
    { title: 'Cloud', path: '/cloud-projects', type: 'cloud' },
  ]
  const wasmInstancePromise = loadAndInitialiseWasmInstance(
    join(process.cwd(), 'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm')
  )
  const commandBarActor = createActor(commandBarMachine, {
    input: {
      commands: [],
      wasmInstancePromise,
      machineManager: new MachineManager(),
    },
  }).start()
  const actor = createActor(
    settingsMachine.provide({
      actors: {
        loadUserSettings: fromPromise(async () => initialSettings),
        registerCommands: fromCallback(() => () => {}),
        watchSystemTheme: fromCallback(() => () => {}),
      },
    }),
    {
      input: {
        ...initialSettings,
        commandBarActor,
        defaultProjectLibraries: [],
        projectLibrarySettingDefaultPolicies: [],
        extensionSettings,
        fileOperations: fileOperations.operations,
        wasmInstancePromise,
        currentProject: {
          path: projectPath,
          name: 'bracket',
          metadata: null,
          children: [],
          kcl_file_count: 1,
          directory_count: 0,
          default_file: `${projectPath}/main.kcl`,
          readWriteAccess: true,
        },
      },
    }
  ).start()
  const registry = new Registry()
  try {
    await waitFor(actor, (snapshot) => snapshot.matches('idle'))
    await saveSettings(
      fileOperations.operations,
      wasmInstancePromise,
      initialSettings,
      extensionSettings,
      projectPath
    )
    const baseManifest = await projectManifestFromFiles(
      normalizeProjectArchiveFilesForCloudSync(
        [...files]
          .filter(([path]) => path.startsWith(`${projectPath}/`))
          .map(([path, contents]) => ({
            relativePath: backing.relative(projectPath, path),
            data: new TextEncoder().encode(contents),
          }))
      )
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId: remote.id,
      remoteRevision: remote.revision,
      baseManifest,
    })
    installCloudSyncFileSystemObserver(backing)
    let revision = 1
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(new URL(getFetchUrl(input)).pathname).toBe(
        new URL(detailUrl).pathname
      )
      if (getFetchMethod(input, init) === 'PUT') {
        remote.revision = `rev-${++revision}`
      }
      return jsonResponse(remote)
    })
    vi.stubGlobal('fetch', fetchMock)
    const settings = signal(
      getOnlySettingsFromContext(actor.getSnapshot().context)
    )
    actor.subscribe((snapshot) => {
      settings.value = getOnlySettingsFromContext(snapshot.context)
    })
    const runtime = signal<RuntimeInfo>({
      target: 'web',
      hasWindow: true,
      isDesktop: false,
      isWeb: true,
      isServer: false,
      isPlaywright: false,
      environmentName: 'dev.zoo.dev',
      apiBaseUrl: 'https://example.test',
    })
    registry.configure([
      defineRegistryItem({
        id: 'test.settings',
        providesServices: [
          provideService(settingsService, {
            actor,
            current: settings,
            get: () => settings.value,
            send: (event) => actor.send(event),
            useSettings: () => settings.value,
          }),
        ],
      }),
      defineRegistryItem({
        id: 'test.runtime',
        providesServices: [
          provideService(runtimeService, {
            current: runtime,
            get: () => runtime.value,
            refresh: () => runtime.value,
          }),
        ],
      }),
      cloudSyncExtension,
    ])
    setCloudSyncOpenedProject({
      projectPath,
      libraryPath: '/cloud-projects',
      libraryType: 'cloud',
    })
    registry.get(cloudSyncService).configure({ token: 'test-token' })
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
      expect(
        cloudSyncStatus.value.state,
        cloudSyncStatus.value.lastFailure
      ).toBe('idle')
    })
    fetchMock.mockClear()
    const previousRevision = remote.revision
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const projectToml = files.get(`${projectPath}/project.toml`)
    actor.send({
      type: 'set.layout.configs',
      data: {
        level: 'user',
        value: { resized: createLayoutWithMetadata(defaultLayout) },
      },
    })
    await waitFor(actor, (snapshot) => snapshot.matches('idle'))
    await vi.advanceTimersByTimeAsync(3000)

    expect(actor.getSnapshot().context.layout.configs.user).toHaveProperty(
      'resized'
    )
    expect(files.get(await getAppSettingsFilePath())).toContain('resized')
    expect(files.get(`${projectPath}/project.toml`)).toBe(projectToml)
    expect(await getAllOutboxEntries()).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()

    actor.send({
      type: 'set.modeling.defaultUnit',
      data: { level: 'project', value: 'cm' },
    })
    await waitFor(actor, (snapshot) => snapshot.matches('idle'))
    expect(files.get(`${projectPath}/project.toml`)).toContain(
      'base_unit = "cm"'
    )
    expect(await getAllOutboxEntries()).not.toEqual([])
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => {
      expect(remote.revision).not.toBe(previousRevision)
      expect(cloudSyncStatus.value.state).toBe('idle')
    })
    expect(
      fetchMock.mock.calls.map(([input, init]) => getFetchMethod(input, init))
    ).toEqual(['GET', 'PUT'])
    expect(await getAllOutboxEntries()).toEqual([])
  } finally {
    registry[Symbol.dispose]()
    actor.stop()
    commandBarActor.stop()
    await disableCloudSyncEngineForTest()
    setCloudSyncOpenedProject(undefined)
    await fileOperations.dispose()
    Object.assign(fsZds, originalFs)
    vi.useRealTimers()
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  }
})
