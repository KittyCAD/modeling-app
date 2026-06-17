import path from 'node:path'
import type { UserFeature } from '@kittycad/lib'
import { pluginsValueSpec } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { zookeeperEditPatchHistoryEvent } from '@src/editor/plugins/zookeeper'
import { File, type KclManager } from '@src/lang/KclManager'
import { App } from '@src/lib/app'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { getChangedSettingsAtLevel } from '@src/lib/settings/settingsUtils'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import type { UserFeaturesContext } from '@src/machines/userFeaturesMachine'
import { UserFeaturesState } from '@src/machines/userFeaturesMachine'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { projectSessionService } from '@src/registry/contracts/projectSession'
import { loadWasm } from '@src/unitTestUtils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mockProjectDirectoryPath = path.join(
  process.cwd(),
  '.tmp',
  'zds-app-spec-project-system'
)
const mockProjectPath = path.join(mockProjectDirectoryPath, 'test')
const mockProjectMainFilePath = `${mockProjectPath}/main.kcl`
const mockOtherProjectPath = path.join(mockProjectDirectoryPath, 'other-test')
const mockOtherProjectMainFilePath = `${mockOtherProjectPath}/main.kcl`

const mockProject: Project = {
  name: 'test',
  default_file: mockProjectMainFilePath,
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
  path: mockProjectPath,
  readWriteAccess: true,
  children: [
    {
      name: 'main.kcl',
      path: mockProjectMainFilePath,
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
  await fsZds.rm(mockProjectDirectoryPath, { recursive: true, force: true })
  await fsZds.mkdir(mockProjectPath, { recursive: true })
  await fsZds.writeFile(mockProjectMainFilePath, new TextEncoder().encode(''))
  await fsZds.rm(mockOtherProjectPath, { recursive: true, force: true })
  await fsZds.mkdir(mockOtherProjectPath, { recursive: true })
  await fsZds.writeFile(
    mockOtherProjectMainFilePath,
    new TextEncoder().encode('')
  )
})

afterAll(async () => {
  await fsZds.rm(mockProjectDirectoryPath, { recursive: true, force: true })
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

async function disposeApp(app: App) {
  await app.projectSession.setOpenedProjectHandle(undefined)
  app.systemIOActor.stop()
  app.settings.actor.stop()
  app.commands.actor.stop()
  app.auth.actor.stop()
  app.billing.actor.stop()
  app.userFeatures.actor.stop()
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
    contextSignal,
    has: (featureFlagId: UserFeature, defaultValue: boolean) =>
      contextSignal.value.featureIds.has(featureFlagId) ? true : defaultValue,
    useContext: () => contextSignal.value,
    useHas: (featureFlagId: UserFeature, defaultValue: boolean) =>
      userFeatures.has(featureFlagId, defaultValue),
    setFeatureIds: (nextFeatureIds: UserFeaturesContext['featureIds']) => {
      contextSignal.value = {
        featureIds: nextFeatureIds,
      }
      snapshot = {
        context: contextSignal.value,
        matches: snapshot.matches,
      }
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
    if (!kclManager.historyOperationInProgress.value) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('History operation did not settle')
}

describe('project system', () => {
  it('syncs plugin settings into plugin activation and only persists overrides', async () => {
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

    try {
      await waitForSettingsIdle(app)

      const pluginId = 'code-editor'
      const plugin = app.registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === pluginId)
      expect(plugin).toBeDefined()
      if (!plugin) {
        throw new Error(`Expected ${pluginId} plugin to be registered.`)
      }

      const pluginToggle = app.registry.get(plugin.service)
      expect(pluginToggle.active.value).toBe(true)

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
      expect(
        getChangedSettingsAtLevel(app.settings.get(), 'user').plugins?.[
          pluginId
        ]
      ).toBeUndefined()
    } finally {
      await disposeApp(app)
    }
  })

  it('selects the create project command from the app command system', async () => {
    const userFeatures = createUserFeaturesForTest(new Set())
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
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
      await disposeApp(app)
    }
  })

  it('loads the code editor automatically render plugin setting enabled by default', async () => {
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

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
      await disposeApp(app)
    }
  })

  it('reloads settings without dropping extension-backed plugin settings', async () => {
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

    try {
      await waitForSettingsIdle(app)

      const pluginId = 'code-editor'
      const plugin = app.registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === pluginId)
      expect(plugin).toBeDefined()
      if (!plugin) {
        throw new Error(`Expected ${pluginId} plugin to be registered.`)
      }

      app.settings.actor.send({ type: 'reload.settings' } as never)

      await waitForSettingsIdle(app)

      expect(app.settings.get().plugins[pluginId].current).toBe(true)
      expect(app.registry.get(plugin.service).active.value).toBe(true)
    } finally {
      await disposeApp(app)
    }
  })

  it('syncs a declared plugin activation setting after reload', async () => {
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

    try {
      await waitForSettingsIdle(app)

      const executionIndicatorPlugin = app.registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === 'execution-indicator')
      expect(executionIndicatorPlugin).toBeDefined()
      if (!executionIndicatorPlugin) {
        throw new Error('Expected execution-indicator plugin to be registered.')
      }

      app.settings.actor.send({ type: 'reload.settings' } as never)

      await waitForSettingsIdle(app)

      const modelingSettings = app.settings.get().modeling as Record<
        string,
        { current: unknown }
      >
      expect(modelingSettings.executionIndicator.current).toBe(false)
      expect(app.settings.get().plugins['execution-indicator']).toBeUndefined()
      expect(
        app.registry.get(executionIndicatorPlugin.service).active.value
      ).toBe(false)

      app.settings.actor.send({
        type: 'set.modeling.executionIndicator',
        data: {
          level: 'user',
          value: true,
        },
        doNotPersist: true,
      } as never)

      await waitForSettingsIdle(app)

      expect(
        app.registry.get(executionIndicatorPlugin.service).active.value
      ).toBe(true)
    } finally {
      await disposeApp(app)
    }
  })

  it('refreshes project folders after Zookeeper undo and redo changes the file set', async () => {
    const projectPath = `/tmp/app-zookeeper-folder-refresh-${crypto.randomUUID()}`
    const mainPath = fsZds.join(projectPath, 'main.kcl')
    const createdPath = fsZds.join(projectPath, 'created.kcl')
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

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
      disposeApp(app)
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('can open, close project', async () => {
    // Stub out File read and write implementations
    File.ioImplementations.read = (path) =>
      Promise.resolve(
        new Map([
          ['/some-dir/test/main.kcl', 'main = 1'],
          ['/some-dir/test/other.kcl', 'other = 2'],
        ]).get(path) ?? ''
      )
    File.ioImplementations.write = () => Promise.resolve()

    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

    try {
      const projectSession = app.registry.get(projectSessionService)
      const project = await projectSession.setOpenedProjectHandle({
        projectPath: mockProject.path,
      })
      expect(project).toBeDefined()
      if (!project) {
        throw new Error('Expected project session to open the mock project.')
      }

      expect(app.project).toBeDefined()
      expect(app.project).toBe(project)
      expect(projectSession.openedProject.value).toBe(project)
      expect(projectSession.openedProjectHandle.value).toEqual({
        projectPath: mockProject.path,
      })
      expect(
        app.systemIOActor.getSnapshot().context.projectDirectoryPath
      ).toEqual(mockProjectDirectoryPath)
      expect(app.project?.executingPath).toBeNull()
      expect(app.project?.executingFileEntry.value.name).toEqual('')

      const mainFile = mockProject.children?.[0]
      expect(mainFile).toBeDefined()
      if (!mainFile) {
        throw new Error('Expected mock project to include a main file.')
      }

      await projectSession.setExecutingEditorHandle({
        projectPath: mockProject.path,
        filePath: mainFile.path,
      })
      expect(app.project?.executingPath).toEqual(mockProjectMainFilePath)
      expect(app.project?.executingFileEntry.value.name).toEqual('main.kcl')
      expect(projectSession.executingEditorHandle.value).toEqual({
        projectPath: mockProject.path,
        filePath: mainFile.path,
      })

      const otherFilePath = `${mockProjectPath}/other.kcl`
      await projectSession.setExecutingEditorHandle({
        projectPath: mockProject.path,
        filePath: otherFilePath,
      })
      expect(app.project?.executingPath).toEqual(otherFilePath)

      await projectSession.setExecutingEditorHandle({
        projectPath: mockProject.path,
        filePath: mainFile.path,
      })
      expect(app.project?.executingPath).toEqual(mockProjectMainFilePath)
      expect(app.project?.executingFileEntry.value.name).toEqual('main.kcl')
      expect(projectSession.executingEditorHandle.value).toEqual({
        projectPath: mockProject.path,
        filePath: mainFile.path,
      })

      await projectSession.setOpenedProjectHandle({
        projectPath: mockOtherProjectPath,
      })
      expect(projectSession.openedProjectHandle.value).toEqual({
        projectPath: mockOtherProjectPath,
      })
      expect(projectSession.executingEditorHandle.value).toBeUndefined()

      await projectSession.setOpenedProjectHandle(undefined)

      expect(app.project).toBeUndefined()
      expect(projectSession.openedProjectHandle.value).toBeUndefined()
      expect(projectSession.executingEditorHandle.value).toBeUndefined()
    } finally {
      await disposeApp(app)
    }
  })
})
