import type { UserFeature } from '@kittycad/lib'
import { pluginsValueSpec } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { File } from '@src/lang/KclManager'
import { App } from '@src/lib/app'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import { getChangedSettingsAtLevel } from '@src/lib/settings/settingsUtils'
import type { UserFeaturesContext } from '@src/machines/userFeaturesMachine'
import { UserFeaturesState } from '@src/machines/userFeaturesMachine'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { commandsValueSpec } from '@src/registry/contracts/commands'
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

function disposeApp(app: App) {
  app.closeProject()
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

      const pluginToggle = app.registry.get(plugin!.service)
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
      disposeApp(app)
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

      const pluginId = 'code-editor'
      const plugin = app.registry
        .get(pluginsValueSpec)
        .find((plugin) => plugin.id === pluginId)
      expect(plugin).toBeDefined()

      app.settings.actor.send({ type: 'reload.settings' } as never)

      await waitForSettingsIdle(app)

      expect(app.settings.get().plugins[pluginId].current).toBe(true)
      expect(app.registry.get(plugin!.service).active.value).toBe(true)
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
