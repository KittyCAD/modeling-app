import { signal } from '@preact/signals-core'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  PERSONAL_CLOUD_PROJECT_LIBRARY_TITLE,
} from '@src/lib/projectLibraries'
import {
  type HomeProjectEntry,
  homeProjectActionsService,
  homeProjectEntriesFacet,
} from '@src/registry/contracts/homeProjects'
import { projectLibraryTypesFacet } from '@src/registry/contracts/projectLibraries'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import homeProjectsExtension from '@src/registry/extensions/homeProjects'
import { contribute, type InputOf, provide, Registry } from 'plankton'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))
const library = {
  id: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  title: PERSONAL_CLOUD_PROJECT_LIBRARY_TITLE,
  path: DEFAULT_PERSONAL_CLOUD_PROJECT_LIBRARY_LOCAL_PATH,
  type: CLOUD_PROJECT_LIBRARY_TYPE,
} satisfies ProjectLibrary
const project = {
  id: 'remote:remote-project-123',
  source: 'remote',
  status: 'cloud-only',
  libraryIds: [library.id],
  name: 'Bracket',
  title: 'Bracket',
  remoteProjectId: 'remote-project-123',
  readWriteAccess: true,
} satisfies HomeProjectEntry
describe('home project actions', () => {
  it('connects visible Home cards to their provider thumbnail watcher', async () => {
    const stop = vi.fn()
    const watchThumbnail = vi.fn(() => stop)
    const registry = new Registry()
    const _homeProjectEntriesContribution: InputOf<
      typeof homeProjectEntriesFacet
    > = {
      ...project,
      watchThumbnail,
    } satisfies InputOf<typeof homeProjectEntriesFacet>
    await registry.configure([
      homeProjectsExtension,
      [
        contribute(
          homeProjectEntriesFacet,
          () => _homeProjectEntriesContribution
        ),
      ],
    ])
    try {
      const stopWatching = registry
        .required(homeProjectActionsService)
        .watchRemoteThumbnail(project.remoteProjectId)
      expect(watchThumbnail).toHaveBeenCalledOnce()
      expect(stop).not.toHaveBeenCalled()
      if (!stopWatching) throw new Error('Missing thumbnail watcher cleanup')
      stopWatching()
      expect(stop).toHaveBeenCalledOnce()
    } finally {
      await registry.dispose()
    }
  })
  it('allows a project library to duplicate a remote-only project', async () => {
    const registry = new Registry()
    const settings = signal({
      app: {
        libraries: {
          current: [library],
        },
      },
    })
    const _projectLibraryTypesContribution: InputOf<
      typeof projectLibraryTypesFacet
    > = {
      type: library.type,
      title: library.title,
      operations: {
        duplicateProject: {
          run: async () => undefined,
        },
      },
    } satisfies InputOf<typeof projectLibraryTypesFacet>
    await registry.configure([
      homeProjectsExtension,
      [
        contribute(
          projectLibraryTypesFacet,
          () => _projectLibraryTypesContribution
        ),
        provide(settingsService, {
          current: settings,
          get: () => settings.value,
        } as unknown as SettingsRegistryService),
      ],
    ])
    try {
      expect(
        registry.required(homeProjectActionsService).canDuplicate(project)
      ).toBe(true)
    } finally {
      await registry.dispose()
    }
  })
})
