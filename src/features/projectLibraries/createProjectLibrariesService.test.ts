import { computed, signal } from '@preact/signals'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectLibraryTypeContribution } from '@src/contracts/projectLibraries'
import { readDirectoryLibraryRealizations } from '@src/features/directoryLibrary/directoryScanner'
import { createDirectoryLibraryOperations } from '@src/features/directoryLibrary/operations'
import { createProjectLibrariesService } from '@src/features/projectLibraries/createProjectLibrariesService'
import {
  DEFAULT_LIBRARY_ID,
  DIRECTORY_LIBRARY_TYPE,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import {
  type FakeFileSystem,
  createFakeFileSystem,
} from '@src/test/fakeFileSystem'

const DEFAULT_ROOT = '/projects'

function createHarness(
  files: Record<string, string> = {},
  defaults: readonly ProjectLibrarySetting[] = [
    {
      title: 'Local Projects',
      path: DEFAULT_ROOT,
      type: DIRECTORY_LIBRARY_TYPE,
    },
  ]
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
    service: createProjectLibrariesService(fileSystem, types, defaultFactories),
  }
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
