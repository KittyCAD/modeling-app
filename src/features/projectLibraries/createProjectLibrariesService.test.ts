import { computed, signal } from '@preact/signals'
import type { AuthStatus } from '@src/contracts/auth'
import type {
  ProjectLibraryContext,
  ProjectLibraryTypeContribution,
} from '@src/contracts/projectLibraries'
import { readDirectoryLibraryRealizations } from '@src/features/directoryLibrary/directoryScanner'
import { createDirectoryLibraryOperations } from '@src/features/directoryLibrary/operations'
import { createProjectLibrariesService } from '@src/features/projectLibraries/createProjectLibrariesService'
import {
  CLOUD_LIBRARY_TYPE,
  DEFAULT_LIBRARY_ID,
  DIRECTORY_LIBRARY_TYPE,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import {
  createFakeFileSystem,
  type FakeFileSystem,
} from '@src/test/fakeFileSystem'
import { beforeEach, describe, expect, it } from 'vitest'

const DEFAULT_ROOT = '/projects'
const BROWSER_ROOT = '/documents/zoo-design-studio-projects'

function createHarness(
  files: Record<string, string> = {},
  defaults: readonly ProjectLibrarySetting[] = [
    {
      title: 'Local Projects',
      path: DEFAULT_ROOT,
      type: DIRECTORY_LIBRARY_TYPE,
    },
  ],
  /** What a new project's entry file contains. Empty, as it is with no policy. */
  initialKclContents = ''
) {
  const fileSystem = createFakeFileSystem(files) as FakeFileSystem & {
    defaultRoot: ReturnType<typeof computed<string>>
  }
  const root = signal(DEFAULT_ROOT)
  Object.defineProperty(fileSystem, 'defaultRoot', {
    value: computed(() => root.value),
  })

  const directoryType: ProjectLibraryTypeContribution = {
    type: DIRECTORY_LIBRARY_TYPE,
    title: 'Folder',
    icon: 'folder',
    description: 'On this device.',
    locationLabel: 'Folder',
    newLibrarySetting: ({ defaultRoot }) => ({
      title: 'Project Library',
      path: defaultRoot,
      type: DIRECTORY_LIBRARY_TYPE,
    }),
    operations: createDirectoryLibraryOperations(() => fileSystem),
    readRealizations: ({ library, signal, excludePaths }) =>
      readDirectoryLibraryRealizations({
        fileSystem,
        libraryPath: library.path,
        signal,
        excludePaths,
      }),
  }

  const types = computed(
    () => new Map([[DIRECTORY_LIBRARY_TYPE, directoryType]])
  )
  const defaultFactories = computed(() => [() => defaults])

  return {
    fileSystem,
    root,
    service: createProjectLibrariesService(
      fileSystem,
      types,
      defaultFactories,
      undefined,
      undefined,
      async () => initialKclContents
    ),
  }
}

function createBrowserHarness(
  stored: readonly ProjectLibrarySetting[],
  initialAuthStatus: AuthStatus = 'signedIn'
) {
  localStorage.setItem('zds.libraries', JSON.stringify(stored))
  const fileSystem = createFakeFileSystem() as FakeFileSystem & {
    defaultRoot: ReturnType<typeof computed<string>>
    defaultCloudRoot: ReturnType<typeof computed<string>>
  }
  Object.defineProperties(fileSystem, {
    defaultRoot: { value: computed(() => BROWSER_ROOT) },
    defaultCloudRoot: { value: computed(() => BROWSER_ROOT) },
  })
  const directoryType: ProjectLibraryTypeContribution = {
    type: DIRECTORY_LIBRARY_TYPE,
    title: 'Folder',
    icon: 'folder',
    description: 'On this device.',
    locationLabel: 'Folder',
    platforms: ['desktop', 'web'],
    isAvailable: ({ isAuthenticated }) => !isAuthenticated,
    maximumInstances: { web: 1 },
    normalizeSetting: (setting, context) => ({
      ...setting,
      path: context.defaultRoot,
      source: undefined,
    }),
  }
  const cloudType: ProjectLibraryTypeContribution = {
    type: CLOUD_LIBRARY_TYPE,
    title: 'Cloud',
    icon: 'cloud',
    description: 'Personal Cloud.',
    locationLabel: 'Local storage',
    platforms: ['desktop', 'web'],
    isAvailable: ({ isAuthenticated }) => isAuthenticated,
    maximumInstances: { web: 1 },
    normalizeSetting: (setting, context) => ({
      ...setting,
      path: context.defaultRoot,
      source: undefined,
    }),
  }
  const types = computed(
    () =>
      new Map([
        [DIRECTORY_LIBRARY_TYPE, directoryType],
        [CLOUD_LIBRARY_TYPE, cloudType],
      ])
  )
  const defaults = computed(() => [
    (context: ProjectLibraryContext) =>
      context.isAuthenticated
        ? [
            {
              title: 'Personal Cloud',
              path: BROWSER_ROOT,
              type: CLOUD_LIBRARY_TYPE,
            },
          ]
        : [
            {
              title: 'Local Projects',
              path: BROWSER_ROOT,
              type: DIRECTORY_LIBRARY_TYPE,
            },
          ],
  ])
  const authStatus = signal<AuthStatus>(initialAuthStatus)
  return {
    authStatus,
    service: createProjectLibrariesService(
      fileSystem,
      types,
      defaults,
      'web',
      authStatus
    ),
  }
}

function createDesktopCloudOnlyHarness() {
  localStorage.setItem(
    'zds.libraries',
    JSON.stringify([
      {
        title: 'Personal Cloud',
        path: '/cloud',
        type: CLOUD_LIBRARY_TYPE,
      },
    ])
  )
  const fileSystem = createFakeFileSystem() as FakeFileSystem & {
    defaultRoot: ReturnType<typeof computed<string>>
    defaultCloudRoot: ReturnType<typeof computed<string>>
  }
  Object.defineProperties(fileSystem, {
    defaultRoot: { value: computed(() => DEFAULT_ROOT) },
    defaultCloudRoot: { value: computed(() => '/cloud') },
  })
  const directoryType: ProjectLibraryTypeContribution = {
    type: DIRECTORY_LIBRARY_TYPE,
    title: 'Folder',
    icon: 'folder',
    description: 'On this device.',
    locationLabel: 'Folder',
  }
  const cloudType: ProjectLibraryTypeContribution = {
    type: CLOUD_LIBRARY_TYPE,
    title: 'Cloud',
    icon: 'cloud',
    description: 'Personal Cloud.',
    locationLabel: 'Local storage',
    removable: ({ isWeb }) => !isWeb,
  }
  const types = computed(
    () =>
      new Map([
        [DIRECTORY_LIBRARY_TYPE, directoryType],
        [CLOUD_LIBRARY_TYPE, cloudType],
      ])
  )
  const defaults = computed(() => [
    () => [
      {
        title: 'Local Projects',
        path: DEFAULT_ROOT,
        type: DIRECTORY_LIBRARY_TYPE,
      },
    ],
  ])
  return createProjectLibrariesService(fileSystem, types, defaults, 'desktop')
}

describe('project libraries service', () => {
  let harness: ReturnType<typeof createHarness>

  beforeEach(() => {
    harness = createHarness({
      '/projects/bracket/main.kcl': 'thickness = 4',
      '/projects/enclosure/main.kcl': '',
    })
  })

  it('seeds from contributed defaults', () => {
    const { service } = harness
    expect(service.libraries.value.map((l) => l.title)).toEqual([
      'Local Projects',
    ])
    expect(service.libraries.value[0].id).toBe(DEFAULT_LIBRARY_ID)
  })

  it('waits for a default root before seeding', () => {
    const { service, root } = createHarness()
    root.value = ''
    // Seeding at the wrong root would persist the mistake, so nothing is
    // seeded until the filesystem reports one.
    expect(service.libraries.value).toHaveLength(0)
  })

  it('discovers projects in a library', async () => {
    const { service } = harness
    await service.refresh()

    expect(service.realizations.value.map((r) => r.name).toSorted()).toEqual([
      'bracket',
      'enclosure',
    ])
    expect(service.state.value).toBe('ready')
  })

  it('reports realizations per library', async () => {
    const { service } = harness
    await service.refresh()

    const libraryId = service.libraries.value[0].id
    expect(service.realizationsFor(libraryId)).toHaveLength(2)
    expect(service.realizationsFor('nonexistent')).toHaveLength(0)
  })

  it('stamps library membership so a type does not have to', async () => {
    const { service } = harness
    await service.refresh()

    const libraryId = service.libraries.value[0].id
    for (const realization of service.realizations.value) {
      expect(realization.libraryIds).toContain(libraryId)
    }
  })

  it('keeps other libraries when refreshing just one', async () => {
    const { service, fileSystem } = harness
    await fileSystem.writeTextFile('/other/widget/main.kcl', '')

    const added = service.addLibrary({
      title: 'Other',
      path: '/other',
      type: DIRECTORY_LIBRARY_TYPE,
    })
    await service.refresh()
    expect(service.realizations.value).toHaveLength(3)

    // Refreshing one library must not discard what is known about the rest.
    await service.refresh(added?.id)
    expect(service.realizations.value).toHaveLength(3)
  })

  it('merges a project seen through two overlapping libraries', async () => {
    const { service } = harness
    service.addLibrary({
      title: 'Nested',
      // The same folder, reached through a second library.
      path: DEFAULT_ROOT,
      type: DIRECTORY_LIBRARY_TYPE,
      source: 'second',
    })
    await service.refresh()

    const bracket = service.realizations.value.filter(
      (r) => r.name === 'bracket'
    )
    expect(bracket).toHaveLength(1)
    expect(bracket[0].libraryIds.length).toBe(2)
  })

  it('drops realizations from a removed library', async () => {
    const { service, fileSystem } = harness
    await fileSystem.writeTextFile('/other/widget/main.kcl', '')

    const added = service.addLibrary({
      title: 'Other',
      path: '/other',
      type: DIRECTORY_LIBRARY_TYPE,
    })
    await service.refresh()
    expect(service.realizations.value).toHaveLength(3)

    service.removeLibrary(added?.id ?? '')
    expect(service.realizations.value.map((r) => r.name).toSorted()).toEqual([
      'bracket',
      'enclosure',
    ])
  })

  it('refuses to remove the last library', () => {
    const { service } = harness
    const libraryId = service.libraries.value[0].id

    // With no libraries there is nowhere for a new project to go, and no way
    // back except editing storage.
    expect(service.canRemoveLibrary(libraryId)).toBe(false)
    service.removeLibrary(libraryId)
    expect(service.libraries.value).toHaveLength(1)
  })

  it('persists configuration across instances', () => {
    harness.service.addLibrary({
      title: 'Work',
      path: '/work',
      type: DIRECTORY_LIBRARY_TYPE,
    })

    const { service } = createHarness()
    expect(service.libraries.value.map((l) => l.title)).toContain('Work')
  })

  it('migrates the legacy browser directory to Personal Cloud in place', async () => {
    const { service } = createBrowserHarness([
      {
        title: 'Local Projects',
        path: BROWSER_ROOT,
        type: DIRECTORY_LIBRARY_TYPE,
      },
    ])

    expect([...service.types.value.keys()]).toEqual([CLOUD_LIBRARY_TYPE])
    expect(service.settings.value).toEqual([
      {
        title: 'Personal Cloud',
        path: BROWSER_ROOT,
        type: CLOUD_LIBRARY_TYPE,
      },
    ])
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem('zds.libraries') ?? '[]')).toEqual(
      service.settings.value
    )
    service.dispose()
  })

  it('enforces one Cloud library and rejects Folder libraries on web', () => {
    const { service } = createBrowserHarness([
      {
        title: 'First Cloud',
        path: '/old/cloud',
        type: CLOUD_LIBRARY_TYPE,
      },
      {
        title: 'Second Cloud',
        path: '/other/cloud',
        type: CLOUD_LIBRARY_TYPE,
      },
    ])

    expect(service.libraries.value).toHaveLength(1)
    expect(service.libraries.value[0].path).toBe(BROWSER_ROOT)
    expect(service.canRemoveLibrary(service.libraries.value[0].id)).toBe(false)
    expect(
      service.addLibrary({
        title: 'Folder',
        path: '/folder',
        type: DIRECTORY_LIBRARY_TYPE,
      })
    ).toBeUndefined()
    expect(
      service.addLibrary({
        title: 'Another Cloud',
        path: '/cloud-2',
        type: CLOUD_LIBRARY_TYPE,
      })
    ).toBeUndefined()
    service.dispose()
  })

  it('replaces a removed lone desktop Cloud library with the default Folder', () => {
    const service = createDesktopCloudOnlyHarness()
    const cloud = service.libraries.value[0]

    expect(service.canRemoveLibrary(cloud.id)).toBe(true)
    service.removeLibrary(cloud.id)

    expect(service.settings.value).toEqual([
      {
        title: 'Local Projects',
        path: DEFAULT_ROOT,
        type: DIRECTORY_LIBRARY_TYPE,
      },
    ])
    service.dispose()
  })

  it('boots signed-out web users into one local Folder library', () => {
    const { service } = createBrowserHarness([], 'signedOut')

    expect([...service.types.value.keys()]).toEqual([DIRECTORY_LIBRARY_TYPE])
    expect(service.settings.value).toEqual([
      {
        title: 'Local Projects',
        path: BROWSER_ROOT,
        type: DIRECTORY_LIBRARY_TYPE,
      },
    ])
    expect(
      service.addLibrary({
        title: 'Cloud',
        path: BROWSER_ROOT,
        type: CLOUD_LIBRARY_TYPE,
      })
    ).toBeUndefined()
    service.dispose()
  })

  it('does not persist a provider migration while authentication is checking', async () => {
    const stored = [
      {
        title: 'Personal Cloud',
        path: BROWSER_ROOT,
        type: CLOUD_LIBRARY_TYPE,
      },
    ]
    const { service } = createBrowserHarness(stored, 'checking')

    // Local storage remains usable during token resolution, but this temporary
    // interpretation must not overwrite the authenticated durable setting.
    expect(service.libraries.value[0].type).toBe(DIRECTORY_LIBRARY_TYPE)
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem('zds.libraries') ?? '[]')).toEqual(
      stored
    )
    service.dispose()
  })

  it('promotes and demotes the browser library in place with authentication', async () => {
    const { authStatus, service } = createBrowserHarness(
      [
        {
          title: 'Local Projects',
          path: BROWSER_ROOT,
          type: DIRECTORY_LIBRARY_TYPE,
        },
      ],
      'signedOut'
    )

    authStatus.value = 'signedIn'
    expect(service.libraries.value).toHaveLength(1)
    expect(service.libraries.value[0]).toMatchObject({
      path: BROWSER_ROOT,
      title: 'Personal Cloud',
      type: CLOUD_LIBRARY_TYPE,
    })

    authStatus.value = 'signedOut'
    expect(service.libraries.value).toHaveLength(1)
    expect(service.libraries.value[0]).toMatchObject({
      path: BROWSER_ROOT,
      title: 'Local Projects',
      type: DIRECTORY_LIBRARY_TYPE,
    })
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem('zds.libraries') ?? '[]')).toEqual(
      service.settings.value
    )
    service.dispose()
  })

  it('records an error when a library cannot be read', async () => {
    const { service, fileSystem } = harness
    fileSystem.readDirectory = async () => {
      throw new Error('permission denied')
    }

    await service.refresh()
    expect(service.state.value).toBe('error')
    expect(service.error.value).toContain('permission denied')
  })

  it('creates a project in a library and finds it', async () => {
    const { service } = harness
    const libraryId = service.libraries.value[0].id

    const created = await service.createProject(libraryId, 'New Bracket')
    expect(created).toBeDefined()
    expect(created?.path).toBe('/projects/new-bracket')
    expect(created?.title).toBe('New Bracket')
    expect(service.realization(created?.id ?? '')).toBeDefined()
  })

  it('gives a created project an entry file, so it is never empty', async () => {
    const { service, fileSystem } = harness
    const libraryId = service.libraries.value[0].id
    const created = await service.createProject(libraryId, 'fresh')

    expect(fileSystem.files.has(`${created?.path}/main.kcl`)).toBe(true)
  })

  /*
   * The same policy a file created *inside* a project gets — the annotation is
   * decided in one place, because two places deciding what a new KCL file says
   * is two places to get it wrong.
   */
  it('writes the entry file with whatever the KCL policy says', async () => {
    const { fileSystem, service } = createHarness(
      {},
      undefined,
      '@settings(defaultLengthUnit = in, kclVersion = 2.0)\n'
    )
    const libraryId = service.libraries.value[0].id

    const created = await service.createProject(libraryId, 'inches')

    expect(fileSystem.files.get(`${created?.path}/main.kcl`)).toBe(
      '@settings(defaultLengthUnit = in, kclVersion = 2.0)\n'
    )
    service.dispose()
  })

  it('does not collide with an existing folder', async () => {
    const { service } = harness
    const libraryId = service.libraries.value[0].id

    const created = await service.createProject(libraryId, 'bracket')
    expect(created?.path).toBe('/projects/bracket-2')
  })

  it('renames a project, moving the folder to follow the title', async () => {
    const { service, fileSystem } = harness
    await service.refresh()

    const bracket = service.realizations.value.find((r) => r.name === 'bracket')
    await service.renameProject(bracket?.id ?? '', 'Big Bracket')

    expect(fileSystem.files.has('/projects/big-bracket/main.kcl')).toBe(true)
    expect(fileSystem.files.has('/projects/bracket/main.kcl')).toBe(false)
  })

  it('keeps the title when the derived folder name is taken', async () => {
    const { service, fileSystem } = harness
    await service.refresh()

    const bracket = service.realizations.value.find((r) => r.name === 'bracket')
    await service.renameProject(bracket?.id ?? '', 'enclosure')

    // The folder stays put rather than clobbering the sibling.
    expect(fileSystem.files.has('/projects/bracket/main.kcl')).toBe(true)
    expect(
      await fileSystem.readTextFile('/projects/bracket/project.toml')
    ).toContain('enclosure')
  })

  it('keeps a project’s settings when it is renamed', async () => {
    const { service, fileSystem } = harness
    await fileSystem.writeTextFile(
      '/projects/bracket/project.toml',
      '[settings.modeling]\nhighlight_edges = false\n'
    )
    await service.refresh()

    const bracket = service.realizations.value.find((r) => r.name === 'bracket')
    await service.renameProject(bracket?.id ?? '', 'Big Bracket')

    // The title write shares the file with the settings cascade, so replacing
    // the file would silently reset the project's preferences.
    const written = await fileSystem.readTextFile(
      '/projects/big-bracket/project.toml'
    )
    expect(written).toContain('title = "Big Bracket"')
    expect(written).toContain('highlight_edges = false')
  })

  it('deletes a project', async () => {
    const { service, fileSystem } = harness
    await service.refresh()

    const bracket = service.realizations.value.find((r) => r.name === 'bracket')
    await service.deleteProject(bracket?.id ?? '')

    expect(fileSystem.files.has('/projects/bracket/main.kcl')).toBe(false)
    expect(service.realizations.value.map((r) => r.name)).toEqual(['enclosure'])
  })

  it('offers move targets excluding the library a project is already in', async () => {
    const { service } = harness
    const other = service.addLibrary({
      title: 'Other',
      path: '/other',
      type: DIRECTORY_LIBRARY_TYPE,
    })
    await service.refresh()

    const bracket = service.realizations.value.find((r) => r.name === 'bracket')
    const targets = service.moveTargetsFor(bracket?.id ?? '')

    expect(targets.map((t) => t.id)).toEqual([other?.id])
  })

  it('does not report a nested library as a project of its parent', async () => {
    const { service, fileSystem } = harness
    // A library inside another library's folder, with a project in it.
    await fileSystem.writeTextFile('/projects/client/widget/main.kcl', '')
    const nested = service.addLibrary({
      title: 'Client',
      path: '/projects/client',
      type: DIRECTORY_LIBRARY_TYPE,
    })
    await service.refresh()

    const outerId = service.libraries.value[0].id
    // The nested root is a library, not a project of the parent.
    expect(
      service
        .realizationsFor(outerId)
        .map((r) => r.name)
        .toSorted()
    ).toEqual(['bracket', 'enclosure'])
    expect(
      service.realizationsFor(nested?.id ?? '').map((r) => r.name)
    ).toEqual(['widget'])
  })

  it('still shares a project between two libraries at the same path', async () => {
    const { service } = harness
    // Same path is an overlapping view of one folder, not nesting, so the
    // project belongs to both.
    service.addLibrary({
      title: 'Same',
      path: DEFAULT_ROOT,
      type: DIRECTORY_LIBRARY_TYPE,
      source: 'alt',
    })
    await service.refresh()

    const bracket = service.realizations.value.find((r) => r.name === 'bracket')
    expect(bracket?.libraryIds).toHaveLength(2)
  })

  it('moves a project between libraries', async () => {
    const { service, fileSystem } = harness
    const other = service.addLibrary({
      title: 'Other',
      path: '/other',
      type: DIRECTORY_LIBRARY_TYPE,
    })
    await service.refresh()

    const bracket = service.realizations.value.find((r) => r.name === 'bracket')
    await service.moveProject(bracket?.id ?? '', other?.id ?? '')

    expect(fileSystem.files.get('/other/bracket/main.kcl')).toBe(
      'thickness = 4'
    )
    expect(fileSystem.files.has('/projects/bracket/main.kcl')).toBe(false)
    expect(service.realizationsFor(other?.id ?? '').map((r) => r.name)).toEqual(
      ['bracket']
    )
  })
})
