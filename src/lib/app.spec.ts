import type { Feature } from '@kittycad/lib'
import { pluginsValueSpec } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { File, type KclManager } from '@src/lang/KclManager'
import { App } from '@src/lib/app'
import {
  KCL_NEW_LEXER_PARSER_FEATURE_FLAG,
  OPFS_CLOUD_FEATURE_FLAG,
} from '@src/lib/constants'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { rustContextService } from '@src/lib/rustContext/registry/contract'
import {
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  getDefaultCloudProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import { getChangedSettingsAtLevel } from '@src/lib/settings/settingsUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { notifyActiveWasmInstance } from '@src/lib/wasmLifecycle'
import { zookeeperEditPatchHistoryEvent } from '@src/lib/zookeeper/editorPlugin'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import type { UserFeaturesContext } from '@src/machines/userFeaturesMachine'
import { UserFeaturesState } from '@src/machines/userFeaturesMachine'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { billingService } from '@src/registry/contracts/billing'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { engineConnectionService } from '@src/registry/contracts/engineConnection'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { projectLibrariesValueSpec } from '@src/registry/contracts/projectLibraries'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { createTestWasmRegistryItem } from '@src/unitTestUtils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mockProject: Project = {
  name: 'test',
  default_file: 'main.kcl',
  directory_count: 0,
  kcl_file_count: 1,
  metadata: {
    accessed: null,
    created: null,
    modified: null,
    permission: null,
    size: 100,
    type: null,
  },
  path: '/some-dir/test',
  readWriteAccess: true,
  children: [
    {
      name: 'main.kcl',
      path: '/some-dir/test/main.kcl',
      children: [],
    },
  ],
}

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

afterAll(() => {
  vi.restoreAllMocks()
})

async function waitForSettingsIdle(app: App) {
  if (app.settings.actor.getSnapshot().matches('idle')) {
    return
  }

  await new Promise<void>((resolve) => {
    const subscription = app.settings.actor.subscribe((snapshot) => {
      if (!snapshot.matches('idle')) {
        return
      }

      subscription.unsubscribe()
      resolve()
    })
  })
}

async function waitForAuthSettled(app: App) {
  if (!app.auth.actor.getSnapshot().matches('checkIfLoggedIn')) {
    return
  }

  await new Promise<void>((resolve) => {
    const subscription = app.auth.actor.subscribe((snapshot) => {
      if (snapshot.matches('checkIfLoggedIn')) {
        return
      }

      subscription.unsubscribe()
      resolve()
    })
  })
}

function createUserFeaturesForTest(
  featureIds: UserFeaturesContext['featureIds']
) {
  const contextSignal = signal<UserFeaturesContext>({
    featureIds,
  })
  let snapshot = {
    context: contextSignal.value,
    matches: (state: string) => state === UserFeaturesState.Ready,
  }
  const stateSignal = signal(snapshot)
  const readySignal = signal(true)
  const listeners = new Set<(nextSnapshot: typeof snapshot) => void>()

  const userFeatures = {
    actor: {
      getSnapshot: () => snapshot,
      subscribe: (listener: (nextSnapshot: typeof snapshot) => void) => {
        listeners.add(listener)
        return {
          unsubscribe: () => listeners.delete(listener),
        }
      },
      stop: vi.fn(),
    },
    send: vi.fn(),
    state: stateSignal,
    context: contextSignal,
    contextSignal,
    ready: readySignal,
    has: (featureFlagId: Feature, defaultValue: boolean) =>
      contextSignal.value.featureIds.has(featureFlagId) ? true : defaultValue,
    useContext: () => contextSignal.value,
    useHas: (featureFlagId: Feature, defaultValue: boolean) =>
      userFeatures.has(featureFlagId, defaultValue),
    setFeatureIds: (nextFeatureIds: UserFeaturesContext['featureIds']) => {
      contextSignal.value = {
        featureIds: nextFeatureIds,
      }
      snapshot = {
        context: contextSignal.value,
        matches: snapshot.matches,
      }
      stateSignal.value = snapshot
      for (const listener of listeners) {
        listener(snapshot)
      }
    },
  }

  return userFeatures as unknown as ReturnType<
    typeof App.getDefaultSystems
  >['userFeatures'] & {
    setFeatureIds: (nextFeatureIds: UserFeaturesContext['featureIds']) => void
  }
}

async function writeText(path: string, contents: string) {
  await fsZds.mkdir(fsZds.dirname(path), { recursive: true })
  await fsZds.writeFile(path, new TextEncoder().encode(contents))
}

async function waitForHistoryIdle(kclManager: KclManager) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!kclManager.historyOperationInProgress.value) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('History operation did not settle')
}

function createAppForTest(
  provided: Parameters<typeof App.fromProvided>[0] = {}
) {
  return App.fromProvided({
    ...provided,
    registryOverrides: [
      ...(provided.registryOverrides ?? []),
      createTestWasmRegistryItem(),
    ],
  })
}

function createRuntimeFlagsWasmInstance() {
  return {
    set_kcl_runtime_flags: vi.fn(),
  } as unknown as ModuleType & {
    set_kcl_runtime_flags: ReturnType<typeof vi.fn>
  }
}

function expectedRuntimeFlags(useNewLexerParser: 'On' | 'Off') {
  return JSON.stringify({
    use_new_lexer_parser: useNewLexerParser,
  })
}

function getCloudSyncPluginSetting(app: App) {
  return (
    app.settings.get().plugins as
      | Record<
          string,
          {
            current?: unknown
            user?: unknown
          }
        >
      | undefined
  )?.['cloud-sync']
}

function getPluginToggle(app: App, pluginId: string) {
  const plugin = app.registry
    .get(pluginsValueSpec)
    .find((plugin) => plugin.id === pluginId)
  expect(plugin).toBeDefined()
  if (!plugin) {
    throw new Error(`Missing ${pluginId} plugin registry item`)
  }

  return app.registry.get(plugin.service)
}

function hasPersonalCloudLibrarySetting(app: App) {
  const defaultCloudLibrary = getDefaultCloudProjectLibrarySetting()
  return app.settings
    .get()
    .app.libraries.current.some(
      (library) =>
        library.type === defaultCloudLibrary.type &&
        library.path === defaultCloudLibrary.path
    )
}

function hasDefaultDirectoryLibrarySetting(app: App) {
  const projectDirectory = app.settings.get().app.projectDirectory.current
  return app.settings
    .get()
    .app.libraries.current.some(
      (library) =>
        library.type === DIRECTORY_PROJECT_LIBRARY_TYPE &&
        library.path === projectDirectory
    )
}

describe('project system', () => {
  it('uses registry runtime dependencies by default', () => {
    const app = createAppForTest()

    try {
      const registryUserFeatures = app.registry.get(userFeaturesService)
      const registryMachineManager = app.registry.get(machineManagerService)
      const registryEngineConnectionManager = app.registry.get(
        engineConnectionService
      )
      const registryBilling = app.registry.get(billingService)
      const registryRustContext = app.registry.get(rustContextService)

      expect(app.wasmPromise).toBe(app.registry.get(wasmPromiseValueSpec))
      expect(app.machineManager).toBe(registryMachineManager.manager)
      expect(app.userFeatures.actor).toBe(registryUserFeatures.actor)
      expect(app.engineCommandManager).toBe(
        registryEngineConnectionManager.manager
      )
      expect(app.billing.actor).toBe(registryBilling.actor)
      expect(app.rustContext).toBe(registryRustContext.context)
    } finally {
      app.dispose()
    }
  })

  it('sets KCL runtime flags when the app wasm instance becomes active', async () => {
    const userFeatures = createUserFeaturesForTest(new Set())
    const wasmInstance = createRuntimeFlagsWasmInstance()
    const wasmPromise = Promise.resolve(wasmInstance)
    const app = createAppForTest({
      userFeatures,
      wasmPromise,
      registryOverrides: [createTestWasmRegistryItem(wasmPromise)],
    })

    try {
      await wasmPromise

      expect(wasmInstance.set_kcl_runtime_flags).toHaveBeenCalledWith(
        expectedRuntimeFlags('Off')
      )
    } finally {
      app.dispose()
    }
  })

  it('updates KCL runtime flags when user features change', async () => {
    const userFeatures = createUserFeaturesForTest(new Set())
    const wasmInstance = createRuntimeFlagsWasmInstance()
    const wasmPromise = Promise.resolve(wasmInstance)
    const app = createAppForTest({
      userFeatures,
      wasmPromise,
      registryOverrides: [createTestWasmRegistryItem(wasmPromise)],
    })

    try {
      await wasmPromise
      wasmInstance.set_kcl_runtime_flags.mockClear()

      userFeatures.setFeatureIds(new Set([KCL_NEW_LEXER_PARSER_FEATURE_FLAG]))

      expect(wasmInstance.set_kcl_runtime_flags).toHaveBeenCalledWith(
        expectedRuntimeFlags('On')
      )
    } finally {
      app.dispose()
    }
  })

  it('sets KCL runtime flags on lifecycle-announced wasm instances', async () => {
    const userFeatures = createUserFeaturesForTest(
      new Set([KCL_NEW_LEXER_PARSER_FEATURE_FLAG])
    )
    const initialWasmInstance = createRuntimeFlagsWasmInstance()
    const nextWasmInstance = createRuntimeFlagsWasmInstance()
    const wasmPromise = Promise.resolve(initialWasmInstance)
    const app = createAppForTest({
      userFeatures,
      wasmPromise,
      registryOverrides: [createTestWasmRegistryItem(wasmPromise)],
    })

    try {
      await wasmPromise

      await notifyActiveWasmInstance(nextWasmInstance)

      expect(nextWasmInstance.set_kcl_runtime_flags).toHaveBeenCalledWith(
        expectedRuntimeFlags('On')
      )
    } finally {
      app.dispose()
    }
  })

  it('syncs plugin settings into plugin activation and only persists overrides', async () => {
    const previousElectron = window.electron
    const syncActivePlugins = vi.fn().mockResolvedValue(undefined)
    window.electron = {
      pluginIpc: {
        invoke: vi.fn(),
        syncActivePlugins,
      },
    } as unknown as typeof window.electron
    const app = createAppForTest()

    try {
      await waitForSettingsIdle(app)

      const pluginId = 'code-editor'
      const plugin = app.registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === pluginId)
      expect(plugin).toBeDefined()
      if (!plugin) {
        throw new Error(`Missing ${pluginId} plugin registry item`)
      }

      const pluginToggle = app.registry.get(plugin.service)
      expect(pluginToggle.active.value).toBe(true)
      expect(syncActivePlugins).toHaveBeenCalledWith(
        expect.arrayContaining([pluginId])
      )

      app.settings.actor.send({
        type: `set.plugins.${pluginId}`,
        data: {
          level: 'user',
          value: false,
        },
        doNotPersist: true,
      } as never)

      await waitForSettingsIdle(app)

      expect(pluginToggle.active.value).toBe(false)
      expect(syncActivePlugins.mock.calls.at(-1)?.[0]).not.toContain(pluginId)
      expect(
        getChangedSettingsAtLevel(app.settings.get(), 'user').plugins
      ).toEqual({
        [pluginId]: false,
      })

      app.settings.actor.send({
        type: `set.plugins.${pluginId}`,
        data: {
          level: 'user',
          value: true,
        },
        doNotPersist: true,
      } as never)

      await waitForSettingsIdle(app)

      expect(pluginToggle.active.value).toBe(true)
      expect(syncActivePlugins.mock.calls.at(-1)?.[0]).toContain(pluginId)
      expect(
        getChangedSettingsAtLevel(app.settings.get(), 'user').plugins?.[
          pluginId
        ]
      ).toBeUndefined()
    } finally {
      app.dispose()
      window.electron = previousElectron
    }
  })

  it('keeps cloud sync disabled by default without the cloud projects feature', async () => {
    const userFeatures = createUserFeaturesForTest(new Set())
    const app = createAppForTest({
      userFeatures,
    })

    try {
      await waitForSettingsIdle(app)

      expect(getCloudSyncPluginSetting(app)?.current).toBe(false)
      expect(getCloudSyncPluginSetting(app)?.user).toBeUndefined()
      expect(getPluginToggle(app, 'cloud-sync').active.value).toBe(false)
      expect(hasPersonalCloudLibrarySetting(app)).toBe(false)
      expect(hasDefaultDirectoryLibrarySetting(app)).toBe(true)
      expect(
        app.registry
          .get(projectLibrariesValueSpec)
          .some((library) => library.id === PERSONAL_CLOUD_PROJECT_LIBRARY_ID)
      ).toBe(false)
    } finally {
      app.dispose()
    }
  })

  it('auto-enables cloud sync for feature-flagged users and materializes Personal Cloud', async () => {
    const userFeatures = createUserFeaturesForTest(
      new Set([OPFS_CLOUD_FEATURE_FLAG])
    )
    const app = createAppForTest({
      userFeatures,
    })

    try {
      await expect
        .poll(() => ({
          active: getPluginToggle(app, 'cloud-sync').active.value,
          current: getCloudSyncPluginSetting(app)?.current,
          user: getCloudSyncPluginSetting(app)?.user,
          hasPersonalCloudLibrarySetting: hasPersonalCloudLibrarySetting(app),
          hasDefaultDirectoryLibrarySetting:
            hasDefaultDirectoryLibrarySetting(app),
          hasPersonalCloudLibrary: app.registry
            .get(projectLibrariesValueSpec)
            .some(
              (library) => library.id === PERSONAL_CLOUD_PROJECT_LIBRARY_ID
            ),
        }))
        .toEqual({
          active: true,
          current: true,
          user: true,
          hasPersonalCloudLibrarySetting: true,
          hasDefaultDirectoryLibrarySetting: false,
          hasPersonalCloudLibrary: true,
        })

      // On web, cloud sync is the project storage layer, not an optional
      // feature: a disable attempt is overridden, the plugin stays active, and
      // a usable library plus a create target remain (the strand-repro fix).
      app.settings.actor.send({
        type: 'set.plugins.cloud-sync',
        data: {
          level: 'user',
          value: false,
        },
        doNotPersist: true,
      } as never)

      await expect
        .poll(() => ({
          current: getCloudSyncPluginSetting(app)?.current,
          active: getPluginToggle(app, 'cloud-sync').active.value,
          hasPersonalCloudLibrary: app.registry
            .get(projectLibrariesValueSpec)
            .some(
              (library) => library.id === PERSONAL_CLOUD_PROJECT_LIBRARY_ID
            ),
          canCreateInPersonalCloud: app
            .getCreateProjectLibraryTargets()
            .some(
              (target) =>
                target.library.id === PERSONAL_CLOUD_PROJECT_LIBRARY_ID
            ),
        }))
        .toEqual({
          current: true,
          active: true,
          hasPersonalCloudLibrary: true,
          canCreateInPersonalCloud: true,
        })
    } finally {
      app.dispose()
    }
  })

  it('respects an explicit cloud sync opt-out on desktop', async () => {
    const previousElectron = window.electron
    window.electron = {
      os: { isMac: false },
      pluginIpc: {
        invoke: vi.fn(),
        syncActivePlugins: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as typeof window.electron
    const userFeatures = createUserFeaturesForTest(
      new Set([OPFS_CLOUD_FEATURE_FLAG])
    )
    const app = createAppForTest({ userFeatures })

    try {
      // Cloud sync auto-enables for the flag on desktop too.
      await expect
        .poll(() => getPluginToggle(app, 'cloud-sync').active.value)
        .toBe(true)

      // Unlike web (where the disable attempt is overridden), desktop keeps
      // cloud sync optional and honors the opt-out.
      app.settings.actor.send({
        type: 'set.plugins.cloud-sync',
        data: {
          level: 'user',
          value: false,
        },
        doNotPersist: true,
      } as never)

      await waitForSettingsIdle(app)

      expect(getCloudSyncPluginSetting(app)?.current).toBe(false)
      expect(getCloudSyncPluginSetting(app)?.user).toBe(false)
      expect(getPluginToggle(app, 'cloud-sync').active.value).toBe(false)
    } finally {
      app.dispose()
      window.electron = previousElectron
    }
  })

  it('selects the create project command from the app command system', async () => {
    const userFeatures = createUserFeaturesForTest(new Set())
    const app = createAppForTest({
      userFeatures,
    })

    try {
      expect(
        app.registry
          .get(commandsValueSpec)
          .some(
            (command) =>
              command.groupId === 'projects' &&
              command.name === 'Create project'
          )
      ).toBe(false)

      userFeatures.setFeatureIds(new Set([OPFS_CLOUD_FEATURE_FLAG]))

      expect(
        app.registry
          .get(commandsValueSpec)
          .some(
            (command) =>
              command.groupId === 'projects' &&
              command.name === 'Create project'
          )
      ).toBe(true)
      expect(
        app.commands.actor
          .getSnapshot()
          .context.commands.some(
            (command) =>
              command.groupId === 'projects' &&
              command.name === 'Create project'
          )
      ).toBe(true)

      app.commands.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Create project',
        },
      })

      const snapshot = app.commands.actor.getSnapshot()
      expect(snapshot.matches('Gathering arguments')).toBe(true)
      expect(snapshot.context.selectedCommand?.name).toBe('Create project')
      expect(snapshot.context.currentArgument?.name).toBe('name')
    } finally {
      await waitForAuthSettled(app)
      app.dispose()
    }
  })

  it('loads the code editor automatically render plugin setting enabled by default', async () => {
    const app = createAppForTest()

    try {
      await waitForSettingsIdle(app)

      const codeEditorPlugin = app.registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === 'code-editor')
      expect(codeEditorPlugin).toBeDefined()
      expect(
        app.registry.get(appHeaderItemsValueSpec).map((item) => item.id)
      ).toEqual(
        expect.arrayContaining([
          'command-bar.open',
          'code-editor.render',
          'publish.open',
        ])
      )
      expect(
        app.registry.get(executingEditorService).hasEditsSinceLastExecution
          .value
      ).toBe(false)
      expect(app.registry.get(executingEditorService).code.value).toBe('')

      const textEditorSettings = app.settings.get().textEditor as Record<
        string,
        { current: unknown; hideOnLevel?: unknown }
      >
      expect(textEditorSettings.automaticallyRender.current).toBe(true)
      expect(textEditorSettings.automaticallyRender.hideOnLevel).toBe('project')
    } finally {
      app.dispose()
    }
  })

  it('reloads settings without dropping extension-backed plugin settings', async () => {
    const app = createAppForTest()

    try {
      await waitForSettingsIdle(app)

      const pluginId = 'code-editor'
      const plugin = app.registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === pluginId)
      expect(plugin).toBeDefined()
      if (!plugin) {
        throw new Error(`Missing ${pluginId} plugin registry item`)
      }

      app.settings.actor.send({ type: 'reload.settings' } as never)

      await waitForSettingsIdle(app)

      expect(app.settings.get().plugins[pluginId].current).toBe(true)
      expect(app.registry.get(plugin.service).active.value).toBe(true)
    } finally {
      app.dispose()
    }
  })

  it('refreshes project folders after Zookeeper undo and redo changes the file set', async () => {
    const projectPath = `/tmp/app-zookeeper-folder-refresh-${crypto.randomUUID()}`
    const mainPath = fsZds.join(projectPath, 'main.kcl')
    const createdPath = fsZds.join(projectPath, 'created.kcl')
    const app = createAppForTest()

    try {
      await writeText(mainPath, 'main = true\n')
      const project: Project = {
        name: fsZds.basename(projectPath),
        default_file: mainPath,
        directory_count: 0,
        kcl_file_count: 1,
        metadata: null,
        path: projectPath,
        readWriteAccess: true,
        children: [
          {
            name: 'main.kcl',
            path: mainPath,
            children: null,
          },
        ],
      }
      const openedProject = await app.openProject(project)
      const kclManager = await openedProject.openEditor(mainPath)
      await Promise.resolve()

      await writeText(createdPath, 'created = true\n')
      kclManager.addGlobalHistoryEvent(
        zookeeperEditPatchHistoryEvent({
          projectPath,
          activeFilePath: mainPath,
          patch: {
            run_id: 'create-file-refresh',
            changed_files: [
              {
                path: 'created.kcl',
                status: 'created',
                contents: 'created = true\n',
              },
            ],
          },
        })
      )
      const send = vi.spyOn(app.systemIOActor, 'send')

      kclManager.undo()
      await waitForHistoryIdle(kclManager)
      expect(send).toHaveBeenCalledWith({
        type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
      })
      await expect(fsZds.readFile(createdPath, 'utf8')).rejects.toThrow()

      send.mockClear()
      kclManager.redo()
      await waitForHistoryIdle(kclManager)
      expect(send).toHaveBeenCalledWith({
        type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
      })
      await expect(fsZds.readFile(createdPath, 'utf8')).resolves.toBe(
        'created = true\n'
      )
    } finally {
      app.dispose()
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('can open, close project', async () => {
    // Stub out File read and write implementations
    File.ioImplementations.read = () => Promise.resolve('')
    File.ioImplementations.write = () => Promise.resolve()

    const app = createAppForTest()

    try {
      const project = await app.openProject(mockProject)

      expect(app.project).toBeDefined()
      expect(app.project?.executingPath).toBeNull()
      expect(app.project?.executingFileEntry.value.name).toEqual('')

      const [mainEntry] = mockProject.children ?? []
      expect(mainEntry).toBeDefined()
      if (!mainEntry) {
        throw new Error('Missing main project file entry')
      }

      await project.openEditor(mainEntry.path)
      expect(app.project?.executingPath).toEqual('/some-dir/test/main.kcl')
      expect(app.project?.executingFileEntry.value.name).toEqual('main.kcl')

      app.closeProject()

      expect(app.project).toBeUndefined()
    } finally {
      app.dispose()
    }
  })
})
