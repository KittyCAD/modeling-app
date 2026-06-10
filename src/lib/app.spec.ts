import { pluginsValueSpec } from '@kittycad/registry'
import { zookeeperEditPatchHistoryEvent } from '@src/editor/plugins/zookeeper'
import { File, type KclManager } from '@src/lang/KclManager'
import { App } from '@src/lib/app'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { getChangedSettingsAtLevel } from '@src/lib/settings/settingsUtils'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { loadWasm } from '@src/unitTestUtils'
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

function disposeApp(app: App) {
  app.closeProject()
  app.systemIOActor.stop()
  app.settings.actor.stop()
  app.commands.actor.stop()
  app.auth.actor.stop()
  app.billing.actor.stop()
  app.userFeatures.actor.stop()
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

      const telemetryPlugin = app.registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === 'telemetry')
      expect(telemetryPlugin).toBeDefined()

      const telemetryToggle = app.registry.get(telemetryPlugin!.service)
      expect(telemetryToggle.active.value).toBe(true)

      app.settings.actor.send({
        type: 'set.plugins.telemetry',
        data: {
          level: 'user',
          value: false,
        },
        doNotPersist: true,
      } as never)

      await waitForSettingsIdle(app)

      expect(telemetryToggle.active.value).toBe(false)
      expect(
        getChangedSettingsAtLevel(app.settings.get(), 'user').plugins
      ).toEqual({
        telemetry: false,
      })

      app.settings.actor.send({
        type: 'set.plugins.telemetry',
        data: {
          level: 'user',
          value: true,
        },
        doNotPersist: true,
      } as never)

      await waitForSettingsIdle(app)

      expect(telemetryToggle.active.value).toBe(true)
      expect(
        getChangedSettingsAtLevel(app.settings.get(), 'user').plugins?.telemetry
      ).toBeUndefined()
    } finally {
      disposeApp(app)
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
      disposeApp(app)
    }
  })

  it('reloads settings without dropping extension-backed plugin settings', async () => {
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

    try {
      await waitForSettingsIdle(app)

      const telemetryPlugin = app.registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === 'telemetry')
      expect(telemetryPlugin).toBeDefined()

      app.settings.actor.send({ type: 'reload.settings' } as never)

      await waitForSettingsIdle(app)

      expect(app.settings.get().plugins.telemetry.current).toBe(true)
      expect(app.registry.get(telemetryPlugin!.service).active.value).toBe(true)
    } finally {
      disposeApp(app)
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

      app.settings.actor.send({ type: 'reload.settings' } as never)

      await waitForSettingsIdle(app)

      const modelingSettings = app.settings.get().modeling as Record<
        string,
        { current: unknown }
      >
      expect(modelingSettings.executionIndicator.current).toBe(false)
      expect(app.settings.get().plugins['execution-indicator']).toBeUndefined()
      expect(
        app.registry.get(executionIndicatorPlugin!.service).active.value
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
        app.registry.get(executionIndicatorPlugin!.service).active.value
      ).toBe(true)
    } finally {
      disposeApp(app)
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
    File.ioImplementations.read = () => Promise.resolve('')
    File.ioImplementations.write = () => Promise.resolve()

    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

    try {
      const project = await app.openProject(mockProject)

      expect(app.project).toBeDefined()
      expect(app.project?.executingPath).toBeNull()
      expect(app.project?.executingFileEntry.value.name).toEqual('')

      await project.openEditor(mockProject.children![0].path)
      expect(app.project?.executingPath).toEqual('/some-dir/test/main.kcl')
      expect(app.project?.executingFileEntry.value.name).toEqual('main.kcl')

      app.closeProject()

      expect(app.project).toBeUndefined()
    } finally {
      disposeApp(app)
    }
  })
})
