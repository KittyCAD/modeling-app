import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@src/lib/desktop', () => ({
  getAppSettingsFilePath: async () => settingsPath,
}))
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Registry, provide } from 'plankton'
import { createCommunityPluginsExtension } from '@src/lib/communityPlugins/registry'
import { communityPluginsService } from '@src/lib/communityPlugins/registry/contract'
import { parsePluginPreferences } from '@src/lib/communityPlugins/persistence'
import { compiledHello } from '@src/lib/communityPlugins/testSupport'
import { requireSuccess } from '@src/lib/editors/testViews'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'

let settingsPath = ''
let directory: string | undefined
let registry: Registry | undefined
afterEach(async () => {
  await registry?.dispose()
  if (directory) await rm(directory, { recursive: true, force: true })
})
it('saves the first installation and later changes when the profile settings directory does not exist', async () => {
  directory = await mkdtemp(join(tmpdir(), 'zds-first-plugin-'))
  settingsPath = join(directory, 'new-profile', 'settings.toml')
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  registry = new Registry()
  await registry.configure([
    provide(fileOperationsService, testFileOperations),
    createCommunityPluginsExtension(),
  ])
  const manager = registry.required(communityPluginsService)
  await manager.settled()
  requireSuccess(
    await manager.install(
      requireSuccess(await compiledHello()),
      'snapshot',
      undefined,
      new Set(['ui.notify'])
    )
  )
  const preferencesPath = join(
    directory,
    'new-profile',
    'community-plugins.toml'
  )
  const installed = requireSuccess(
    parsePluginPreferences(await readFile(preferencesPath, 'utf8'))
  )
  expect(installed.installations.map((item) => item.pluginId)).toEqual([
    'hello',
  ])
  const id = installed.installations[0].id
  requireSuccess(await manager.setEnabled(id, false))
  expect(
    requireSuccess(
      parsePluginPreferences(await readFile(preferencesPath, 'utf8'))
    ).installations[0].enabled
  ).toBe(false)
})
