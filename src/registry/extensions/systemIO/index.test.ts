import { tmpdir } from 'node:os'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import {
  combineProjectHandles,
  combineProjects,
  projectHandlesValueSpec,
  projectsValueSpec,
  systemIOService,
} from '@src/registry/contracts/systemIO'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { listProjectHandlesFromProjectDirectory, systemIOExtension } from '.'

const cleanup: Array<() => Promise<void> | void> = []

function createSettings(projectDirectory: string) {
  return {
    app: {
      projectDirectory: {
        current: projectDirectory,
      },
    },
  } as SettingsType
}

function createProject(path: string, name: string): Project {
  return {
    path,
    name,
    title: name,
    metadata: null,
    kcl_file_count: 1,
    directory_count: 0,
    default_file: fsZds.join(path, 'main.kcl'),
    children: [],
    readWriteAccess: true,
  }
}

describe('systemIO extension', () => {
  beforeAll(async () => {
    await moduleFsViaModuleImport({
      type: StorageName.NodeFS,
      options: {},
    })
  })

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.()
    }
  })

  it('provides unloaded project handles until refreshed without a settings service', async () => {
    const registry = new Registry()
    cleanup.push(() => registry[Symbol.dispose]())
    registry.configure([systemIOExtension])

    const systemIO = registry.get(systemIOService)

    expect(systemIO.projectHandles.value).toBeUndefined()
    expect(systemIO.projects.value).toBeUndefined()
    expect(registry.get(projectHandlesValueSpec)).toBeUndefined()
    expect(registry.get(projectsValueSpec)).toBeUndefined()
    await expect(systemIO.refreshProjectHandles()).resolves.toEqual([])
    expect(systemIO.projectHandles.value).toEqual([])
    expect(registry.get(projectHandlesValueSpec)).toEqual([])
  })

  it('combines project handle contributions by path', () => {
    expect(
      combineProjectHandles([
        undefined,
        [{ path: '/projects/alpha' }, { path: '/projects/beta' }],
        [{ path: '/projects/beta' }, { path: '/projects/gamma' }],
      ])
    ).toEqual([
      { path: '/projects/alpha' },
      { path: '/projects/beta' },
      { path: '/projects/gamma' },
    ])
  })

  it('combines missing project handles as not loaded', () => {
    expect(combineProjectHandles([undefined])).toBeUndefined()
  })

  it('combines project contributions by path', () => {
    expect(
      combineProjects([
        undefined,
        [
          createProject('/projects/alpha', 'alpha'),
          createProject('/projects/beta', 'beta'),
        ],
        [
          createProject('/projects/beta', 'beta duplicate'),
          createProject('/projects/gamma', 'gamma'),
        ],
      ])?.map((project) => ({
        path: project.path,
        name: project.name,
      }))
    ).toEqual([
      { path: '/projects/alpha', name: 'alpha' },
      { path: '/projects/beta', name: 'beta' },
      { path: '/projects/gamma', name: 'gamma' },
    ])
  })

  it('lists immediate child directories from settings.app.projectDirectory', async () => {
    const projectDirectory = fsZds.join(
      tmpdir(),
      `system-io-extension-${Date.now()}`
    )
    const alphaProject = fsZds.join(projectDirectory, 'alpha')
    const betaProject = fsZds.join(projectDirectory, 'beta')
    const hiddenProject = fsZds.join(projectDirectory, '.hidden')
    const notesFile = fsZds.join(projectDirectory, 'notes.txt')

    await fsZds.mkdir(alphaProject, { recursive: true })
    await fsZds.mkdir(betaProject, { recursive: true })
    await fsZds.mkdir(hiddenProject, { recursive: true })
    await fsZds.writeFile(notesFile, new TextEncoder().encode('not a project'))
    cleanup.push(() =>
      fsZds.rm(projectDirectory, { recursive: true, force: true })
    )

    expect(
      (await listProjectHandlesFromProjectDirectory(projectDirectory))
        .map((handle) => handle.path)
        .sort()
    ).toEqual([alphaProject, betaProject])

    const settings = signal(createSettings(projectDirectory))
    const registry = new Registry()
    cleanup.push(() => registry[Symbol.dispose]())
    registry.configure([
      defineRegistryItem({
        id: 'test-settings-service',
        providesServices: [
          provideService(settingsService, {
            current: settings,
            get: () => settings.value,
          } as SettingsRegistryService),
        ],
      }),
      systemIOExtension,
    ])

    expect(
      registry.get(settingsService).current.value.app.projectDirectory.current
    ).toBe(projectDirectory)

    const systemIO = registry.get(systemIOService)
    const handles = await systemIO.refreshProjectHandles()

    expect(handles.map((handle) => handle.path).sort()).toEqual([
      alphaProject,
      betaProject,
    ])
    expect(
      systemIO.projectHandles.value?.map((handle) => handle.path).sort()
    ).toEqual([alphaProject, betaProject])
    expect(
      registry
        .get(projectHandlesValueSpec)
        ?.map((handle) => handle.path)
        .sort()
    ).toEqual([alphaProject, betaProject])
  })

  it('clears project handles while a changed project directory refreshes', async () => {
    const firstProjectDirectory = fsZds.join(
      tmpdir(),
      `system-io-extension-first-${Date.now()}`
    )
    const secondProjectDirectory = fsZds.join(
      tmpdir(),
      `system-io-extension-second-${Date.now()}`
    )
    const firstProject = fsZds.join(firstProjectDirectory, 'first')
    const secondProject = fsZds.join(secondProjectDirectory, 'second')

    await fsZds.mkdir(firstProject, { recursive: true })
    await fsZds.mkdir(secondProject, { recursive: true })
    cleanup.push(() =>
      fsZds.rm(firstProjectDirectory, { recursive: true, force: true })
    )
    cleanup.push(() =>
      fsZds.rm(secondProjectDirectory, { recursive: true, force: true })
    )

    const settings = signal(createSettings(firstProjectDirectory))
    const registry = new Registry()
    cleanup.push(() => registry[Symbol.dispose]())
    registry.configure([
      defineRegistryItem({
        id: 'test-settings-service',
        providesServices: [
          provideService(settingsService, {
            current: settings,
            get: () => settings.value,
          } as SettingsRegistryService),
        ],
      }),
      systemIOExtension,
    ])

    const systemIO = registry.get(systemIOService)
    await Promise.resolve()
    await systemIO.refreshProjectHandles()
    expect(systemIO.projectHandles.value?.map((handle) => handle.path)).toEqual(
      [firstProject]
    )

    settings.value = createSettings(secondProjectDirectory)

    expect(systemIO.projectHandles.value).toBeUndefined()
  })
})
