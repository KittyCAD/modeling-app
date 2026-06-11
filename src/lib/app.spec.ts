import { pluginsValueSpec } from '@kittycad/registry'
import { File } from '@src/lang/KclManager'
import { App } from '@src/lib/app'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { getChangedSettingsAtLevel } from '@src/lib/settings/settingsUtils'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { projectSessionService } from '@src/registry/contracts/projectSession'
import { loadWasm } from '@src/unitTestUtils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mockProjectPath = '/private/tmp/zds-app-spec-project-system/test'
const mockProjectMainFilePath = `${mockProjectPath}/main.kcl`
const mockProjectDirectoryPath = '/private/tmp/zds-app-spec-project-system'

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
  await fsZds.rm(mockProjectPath, { recursive: true, force: true })
  await fsZds.mkdir(mockProjectPath, { recursive: true })
  await fsZds.writeFile(mockProjectMainFilePath, new TextEncoder().encode(''))
})

afterAll(async () => {
  await fsZds.rm(mockProjectPath, { recursive: true, force: true })
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

async function disposeApp(app: App) {
  await app.projectSession.setOpenedProjectHandle(undefined)
  app.systemIOActor.stop()
  app.settings.actor.stop()
  app.commands.actor.stop()
  app.auth.actor.stop()
  app.billing.actor.stop()
  app.userFeatures.actor.stop()
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

  it('can open, close project', async () => {
    // Stub out File read and write implementations
    File.ioImplementations.read = () => Promise.resolve('')
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

      await projectSession.setOpenedProjectHandle(undefined)

      expect(app.project).toBeUndefined()
      expect(projectSession.openedProjectHandle.value).toBeUndefined()
      expect(projectSession.executingEditorHandle.value).toBeUndefined()
    } finally {
      await disposeApp(app)
    }
  })
})
