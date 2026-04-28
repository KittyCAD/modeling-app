import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pluginsFacet } from '@kittycad/extensions'
import { App } from '@src/lib/app'
import { File } from '@src/lang/KclManager'
import type { Project } from '@src/lib/project'
import { getChangedSettingsAtLevel } from '@src/lib/settings/settingsUtils'
import { loadWasm } from '@src/unitTestUtils'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'

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
}

describe('project system', () => {
  it('syncs plugin settings into plugin activation and only persists overrides', async () => {
    const app = App.fromProvided({
      wasmPromise: loadWasm(),
    })

    try {
      await waitForSettingsIdle(app)

      const telemetryPlugin = app.extensions.host
        .get(pluginsFacet)
        .find((plugin) => plugin.id === 'telemetry')
      expect(telemetryPlugin).toBeDefined()

      const telemetryToggle = app.extensions.host.get(telemetryPlugin!.service)
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
