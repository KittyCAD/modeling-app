import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  DEFAULT_PROJECT_LIBRARY_ID,
  getDefaultProjectLibrarySettings,
} from '@src/lib/projectLibraries'
import type { ZDSProject } from '@src/lib/projectSession'
import {
  homeProjectActionsService,
  type HomeProjectEntry,
} from '@src/registry/contracts/homeProjects'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'
import {
  projectSession,
  type ProjectSessionService,
} from '@src/registry/contracts/projectSession'
import {
  settingsService,
  type SettingsRegistryService,
} from '@src/registry/contracts/settings'
import homeProjectsExtension from '@src/registry/extensions/homeProjects'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

describe('renaming the open project', () => {
  it.each([false, true])(
    'refreshes metadata after persistence without refreshing a replacement session (switched: %s)',
    async (switched) => {
      const project: HomeProjectEntry = {
        id: 'local:/projects/original',
        source: 'local',
        status: 'local',
        libraryIds: [DEFAULT_PROJECT_LIBRARY_ID],
        name: 'original',
        localProjectName: 'original',
        localProjectPath: '/projects/original',
        readWriteAccess: true,
      }
      const current = signal({ path: project.localProjectPath } as ZDSProject)
      const refreshProject = vi.fn(async () => undefined)
      const gate = Promise.withResolvers<undefined>()
      const rename = vi.fn(async () => {
        await gate.promise
      })
      const registry = new Registry()
      registry.configure([
        homeProjectsExtension,
        defineRegistryItem({
          provides: [
            provide(projectLibraryTypesValueSpec, {
              type: 'directory',
              title: 'Directory',
              operations: { renameProject: { run: rename } },
            }),
          ],
          providesServices: [
            provideService(settingsService, {
              current: signal({
                app: {
                  libraries: {
                    current: getDefaultProjectLibrarySettings('/projects'),
                  },
                },
              }),
            } as unknown as SettingsRegistryService),
            provideService(projectSession, {
              project: current,
              refreshProject,
            } as unknown as ProjectSessionService),
          ],
        }),
      ])
      try {
        const renamed = registry
          .get(homeProjectActionsService)
          .rename(project, 'New title', { notify: false })
        expect(rename).toHaveBeenCalledOnce()
        expect(refreshProject).not.toHaveBeenCalled()
        if (switched)
          current.value = { path: '/projects/replacement' } as ZDSProject
        gate.resolve(undefined)
        await renamed
        expect(refreshProject).toHaveBeenCalledTimes(switched ? 0 : 1)
      } finally {
        gate.resolve(undefined)
        registry[Symbol.dispose]()
      }
    }
  )
})
