import { signal } from '@preact/signals-core'
import { posix } from '@chainner/node-path'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import type { ProjectLibrary } from '@src/lib/projectLibraries'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  projectLibraryFromSetting,
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
import {
  projectSession,
  type ProjectSessionService,
} from '@src/registry/contracts/projectSession'
import homeProjectsExtension from '@src/registry/extensions/homeProjects'
import { createFileOperationsExtension } from '@src/registry/extensions/fileOperations'
import { contribute, type InputOf, provide, Registry } from 'plankton'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))
vi.mock('@src/lib/fs-zds', () => ({ default: posix }))
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
  it('offers the source library alongside other compatible destinations', async () => {
    const destination = projectLibraryFromSetting({
      ...library,
      source: 'other-server',
      title: 'Other library',
    })
    const registry = new Registry()
    const settings = signal({
      app: { libraries: { current: [destination, library] } },
    })
    const source = {
      localProjectPath: '/source/project',
      localProjectName: 'Bracket',
    }
    const memory = createMemoryFileSystem({ ...noopfs.impl, ...posix })
    await memory.mkdir(source.localProjectPath, { recursive: true })
    const data = new TextEncoder().encode('saved contents')
    await memory.writeFile('/source/project/main.kcl', data)
    const copy = vi.fn(async () => ({ defaultFile: '/source/copy/main.kcl' }))
    await registry.configure([
      homeProjectsExtension,
      createFileOperationsExtension(memory),
      contribute(projectLibraryTypesFacet, () => ({
        type: library.type,
        title: library.title,
        operations: {
          cloneProjectFrom: { run: async () => source },
          cloneProjectTo: { run: copy },
        },
      })),
      provide(settingsService, {
        current: settings,
        get: () => settings.value,
      } as unknown as SettingsRegistryService),
    ])
    try {
      const actions = registry.required(homeProjectActionsService)
      expect(
        actions
          .getDuplicateToLibraryTargets(project)
          .map((target) => target.library.id)
      ).toEqual([destination.id, library.id])
      await actions.duplicateToLibrary(project, library.id)
      expect(copy).toHaveBeenCalledWith(
        expect.objectContaining({
          library: expect.objectContaining(library),
          sourceLibrary: expect.objectContaining(library),
          project,
          source: {
            ...source,
            files: [{ relativePath: 'main.kcl', data }],
          },
        })
      )
    } finally {
      await registry.dispose()
    }
  })
  it.each([true, false])(
    'flushes the open editor before copying and stops when saving fails: %s',
    async (saved) => {
      const registry = new Registry()
      const entry = { ...project, projectPath: '/source/project' }
      const settings = signal({ app: { libraries: { current: [library] } } })
      const gate = Promise.withResolvers<boolean>()
      const memory = createMemoryFileSystem({ ...noopfs.impl, ...posix })
      await memory.mkdir(entry.projectPath, { recursive: true })
      await memory.writeFile(
        '/source/project/main.kcl',
        new TextEncoder().encode('previous contents')
      )
      let copiedCode: string | undefined
      const flushWriteToFile = vi.fn(async () => {
        const success = await gate.promise
        if (success) {
          await memory.writeFile(
            '/source/project/main.kcl',
            new TextEncoder().encode('latest editor contents')
          )
        }
        return success
      })
      const openProject = {
        path: entry.projectPath,
        executingEditor: signal({ flushWriteToFile }),
        editors: new Map(),
      }
      await registry.configure([
        homeProjectsExtension,
        createFileOperationsExtension(memory),
        contribute(projectLibraryTypesFacet, () => ({
          type: library.type,
          title: library.title,
          operations: {
            cloneProjectFrom: {
              run: async () => ({
                localProjectPath: '/source/project',
                localProjectName: 'Bracket',
              }),
            },
            cloneProjectTo: {
              run: async ({ source }) => {
                copiedCode = new TextDecoder().decode(
                  source.files?.find((file) => file.relativePath === 'main.kcl')
                    ?.data
                )
                return undefined
              },
            },
          },
        })),
        provide(settingsService, {
          current: settings,
          get: () => settings.value,
        } as unknown as SettingsRegistryService),
        provide(projectSession, {
          project: signal(openProject),
          getProject: () => openProject,
        } as unknown as ProjectSessionService),
      ])
      try {
        const copying = registry
          .required(homeProjectActionsService)
          .duplicateToLibrary(entry, library.id)
        expect(copiedCode).toBeUndefined()
        expect(flushWriteToFile).toHaveBeenCalledOnce()
        gate.resolve(saved)
        if (saved) {
          await copying
          expect(copiedCode).toBe('latest editor contents')
        } else {
          await expect(copying).rejects.toThrow(
            'Save the project before duplicating it'
          )
          expect(copiedCode).toBeUndefined()
        }
      } finally {
        gate.resolve(false)
        await registry.dispose()
      }
    }
  )
})
