import { tmpdir } from 'node:os'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import fsZds, { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { systemIOService } from '@src/registry/contracts/systemIO'
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

  it('provides empty project handles without a settings service', async () => {
    const registry = new Registry()
    cleanup.push(() => registry[Symbol.dispose]())
    registry.configure([systemIOExtension])

    const systemIO = registry.get(systemIOService)

    expect(systemIO.projectHandles.value).toEqual([])
    await expect(systemIO.refreshProjectHandles()).resolves.toEqual([])
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
      systemIO.projectHandles.value.map((handle) => handle.path).sort()
    ).toEqual([alphaProject, betaProject])
  })
})
