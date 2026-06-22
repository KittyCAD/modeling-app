import path from 'node:path'
import { undoDepth } from '@codemirror/commands'
import type { UserFeature } from '@kittycad/lib'
import { pluginsValueSpec } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { fsArchiveFile } from '@src/editor/plugins/fs'
import { File, KclManager } from '@src/lang/KclManager'
import { App } from '@src/lib/app'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { getChangedSettingsAtLevel } from '@src/lib/settings/settingsUtils'
import type { UserFeaturesContext } from '@src/machines/userFeaturesMachine'
import { UserFeaturesState } from '@src/machines/userFeaturesMachine'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { projectSessionService } from '@src/registry/contracts/projectSession'
import { loadWasm } from '@src/unitTestUtils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/resetCameraPosition', () => ({
  resetCameraPosition: vi.fn().mockResolvedValue(undefined),
}))

const mockProjectDirectoryPath = path.join(
  process.cwd(),
  '.tmp',
  'zds-app-spec-project-system'
)
const mockProjectPath = path.join(mockProjectDirectoryPath, 'test')
const mockProjectMainFilePath = `${mockProjectPath}/main.kcl`

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
  await fsZds.writeFile(
    `${mockProjectPath}/project.toml`,
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

async function flushPromises(count = 2) {
  for (let i = 0; i < count; i += 1) {
    await Promise.resolve()
  }
}

function setEngineConnectionReady(app: App) {
  app.engineCommandManager.started = true
  app.engineCommandManager.connection = {
    deferredConnection: {
      promise: Promise.resolve(),
      resolve: vi.fn(),
      reject: vi.fn(),
    },
    isUsingUnitTestingConnection: false,
    connected: true,
    websocket: {
      readyState: WebSocket.OPEN,
    },
  } as never
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
          'share.open',
          'publish.open',
        ])
      )
      expect(app.registry.optional(executingEditorService)).toBeUndefined()

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
      expect(app.registry.optional(executingEditorService)).toBeUndefined()

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
      expect(app.registry.optional(executingEditorService)?.code.value).toBe('')
      expect(projectSession.executingEditorHandle.value).toEqual({
        projectPath: mockProject.path,
        filePath: mainFile.path,
      })

      const mainEditor = app.project?.executingEditor.value
      expect(mainEditor).toBeDefined()
      if (!mainEditor) {
        throw new Error('Expected main executing editor to be available.')
      }
      expect(app.commands.actor.getSnapshot().context.kclManager).toBe(
        mainEditor
      )
      const closeMainEditor = vi.spyOn(mainEditor, 'close')

      const otherFilePath = `${mockProjectPath}/other.kcl`
      await projectSession.setExecutingEditorHandle({
        projectPath: mockProject.path,
        filePath: otherFilePath,
      })
      expect(app.project?.executingPath).toEqual(otherFilePath)
      expect(closeMainEditor).toHaveBeenCalled()

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

      const finalEditor = app.project?.executingEditor.value
      expect(finalEditor).toBeDefined()
      if (!finalEditor) {
        throw new Error('Expected final executing editor to be available.')
      }
      const closeFinalEditor = vi.spyOn(finalEditor, 'close')

      await projectSession.setExecutingEditorHandle(undefined)

      expect(closeFinalEditor).toHaveBeenCalled()
      expect(app.project?.executingPath).toBeNull()
      expect(projectSession.executingEditorHandle.value).toBeUndefined()
      expect(app.registry.optional(executingEditorService)).toBeUndefined()
      expect(
        app.commands.actor.getSnapshot().context.kclManager
      ).toBeUndefined()

      await projectSession.setOpenedProjectHandle(undefined)

      expect(app.project).toBeUndefined()
      expect(projectSession.openedProjectHandle.value).toBeUndefined()
      expect(projectSession.executingEditorHandle.value).toBeUndefined()
    } finally {
      await disposeApp(app)
    }
  })

  it('executes the selected editor when the executing file changes while the engine is started', async () => {
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })
    const otherFilePath = `${mockProjectPath}/other.kcl`
    const readSpy = vi
      .spyOn(File.ioImplementations, 'read')
      .mockImplementation((path) =>
        Promise.resolve(path === otherFilePath ? 'other code' : 'main code')
      )
    const resetCameraPositionSpy = vi.mocked(resetCameraPosition)
    resetCameraPositionSpy.mockClear()
    const executeCodeSpy = vi
      .spyOn(KclManager.prototype, 'executeCode')
      .mockResolvedValue(undefined)

    try {
      setEngineConnectionReady(app)
      const projectSession = app.registry.get(projectSessionService)
      await projectSession.setOpenedProjectHandle({
        projectPath: mockProject.path,
      })

      await projectSession.setExecutingEditorHandle({
        projectPath: mockProject.path,
        filePath: mockProjectMainFilePath,
      })
      await flushPromises()

      expect(executeCodeSpy).toHaveBeenCalledTimes(1)
      expect(resetCameraPositionSpy).toHaveBeenCalledTimes(1)
      expect(resetCameraPositionSpy).toHaveBeenLastCalledWith({
        sceneInfra: expect.any(Object),
        engineCommandManager: app.engineCommandManager,
        settingsActor: app.settings.actor,
      })

      await projectSession.setExecutingEditorHandle({
        projectPath: mockProject.path,
        filePath: otherFilePath,
      })
      await flushPromises()

      expect(executeCodeSpy).toHaveBeenCalledTimes(2)
      expect(resetCameraPositionSpy).toHaveBeenCalledTimes(2)
      expect(resetCameraPositionSpy).toHaveBeenLastCalledWith({
        sceneInfra: expect.any(Object),
        engineCommandManager: app.engineCommandManager,
        settingsActor: app.settings.actor,
      })
    } finally {
      readSpy.mockRestore()
      resetCameraPositionSpy.mockClear()
      executeCodeSpy.mockRestore()
      await disposeApp(app)
    }
  })

  it('keeps project history when replacing executing editor instances', async () => {
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })
    const otherFilePath = `${mockProjectPath}/other.kcl`
    const readSpy = vi
      .spyOn(File.ioImplementations, 'read')
      .mockImplementation((path) =>
        Promise.resolve(path === otherFilePath ? 'other code' : 'main code')
      )

    try {
      const projectSession = app.registry.get(projectSessionService)
      await projectSession.setOpenedProjectHandle({
        projectPath: mockProject.path,
      })

      await projectSession.setExecutingEditorHandle({
        projectPath: mockProject.path,
        filePath: mockProjectMainFilePath,
      })

      const project = app.project
      const firstEditor = project?.executingEditor.value
      expect(project).toBeDefined()
      expect(firstEditor).toBeDefined()
      if (!project || !firstEditor) {
        throw new Error(
          'Expected project and executing editor to be available.'
        )
      }

      const projectHistory = project.projectHistory
      const closeFirstEditor = vi.spyOn(firstEditor, 'close')
      firstEditor.addProjectHistoryEvent(
        fsArchiveFile({
          src: `${mockProjectPath}/old.kcl`,
          target: `${mockProjectPath}/.trash/old.kcl`,
          requestedProjectName: mockProject.name,
        })
      )

      expect(firstEditor.projectHistory).toBe(projectHistory)
      expect(undoDepth(projectHistory.state)).toBe(1)

      await projectSession.setExecutingEditorHandle({
        projectPath: mockProject.path,
        filePath: otherFilePath,
      })

      const secondEditor = project.executingEditor.value
      expect(closeFirstEditor).toHaveBeenCalled()
      expect(secondEditor).toBeDefined()
      expect(secondEditor).not.toBe(firstEditor)
      expect(secondEditor?.projectHistory).toBe(projectHistory)
      expect(undoDepth(projectHistory.state)).toBe(1)
    } finally {
      readSpy.mockRestore()
      await disposeApp(app)
    }
  })

  it('leaves initial connection execution to the engine connection setup path', async () => {
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })
    const readSpy = vi
      .spyOn(File.ioImplementations, 'read')
      .mockResolvedValue('main code')
    const resetCameraPositionSpy = vi.mocked(resetCameraPosition)
    resetCameraPositionSpy.mockClear()
    const executeCodeSpy = vi
      .spyOn(KclManager.prototype, 'executeCode')
      .mockResolvedValue(undefined)
    const websocket: { readyState: number } = {
      readyState: WebSocket.CONNECTING,
    }

    try {
      app.engineCommandManager.started = true
      app.engineCommandManager.connection = {
        deferredConnection: {
          promise: new Promise(() => {}),
          resolve: vi.fn(),
          reject: vi.fn(),
        },
        isUsingUnitTestingConnection: false,
        connected: false,
        websocket,
      } as never
      const projectSession = app.registry.get(projectSessionService)
      await projectSession.setOpenedProjectHandle({
        projectPath: mockProject.path,
      })

      await projectSession.setExecutingEditorHandle({
        projectPath: mockProject.path,
        filePath: mockProjectMainFilePath,
      })
      await flushPromises()

      expect(executeCodeSpy).not.toHaveBeenCalled()
      expect(resetCameraPositionSpy).not.toHaveBeenCalled()
    } finally {
      readSpy.mockRestore()
      resetCameraPositionSpy.mockClear()
      executeCodeSpy.mockRestore()
      await disposeApp(app)
    }
  })

  it('accepts project-only route handles without opening a default file', async () => {
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

    try {
      const projectSession = app.registry.get(projectSessionService)
      const result = await projectSession.setProjectRouteHandles({
        routeId: mockProject.path,
        requestUrl: `http://localhost/file/${encodeURIComponent(
          mockProject.path
        )}`,
        usesHashRouter: false,
      })

      expect(result).toEqual({})
      expect(projectSession.openedProjectHandle.value).toEqual({
        projectPath: mockProject.path,
      })
      expect(projectSession.executingEditorHandle.value).toBeUndefined()
      expect(app.project?.executingPath).toBeNull()
      expect(app.registry.optional(executingEditorService)).toBeUndefined()
    } finally {
      await disposeApp(app)
    }
  })
})
