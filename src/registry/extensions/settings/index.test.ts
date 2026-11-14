import { statusBarGlobalItemsFacet } from '@src/registry/contracts/statusBar'
import { factory, Registry } from 'plankton'
import type { Location } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import settingsRegistryItem, { createSettingsExtension } from '.'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import {
  type CommandSystemService,
  commandSystemService,
} from '@src/registry/contracts/commands'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { settingsService } from '@src/registry/contracts/settings'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { vi } from 'vitest'

describe('settings extension', () => {
  it('contributes the settings status bar item', async () => {
    const registry = new Registry()
    await registry.configure([settingsRegistryItem])
    expect(registry.get(statusBarGlobalItemsFacet)).toEqual([
      expect.objectContaining({
        id: 'settings',
        element: 'link',
        icon: 'settings',
        label: 'Settings',
        'data-testid': 'settings-link',
      }),
    ])
    await registry.dispose()
  })
  it('builds a stable settings link for project file routes', async () => {
    const registry = new Registry()
    await registry.configure([settingsRegistryItem])
    const [settingsItem] = registry.get(statusBarGlobalItemsFacet)

    if (
      !settingsItem ||
      'component' in settingsItem ||
      settingsItem.element !== 'link' ||
      typeof settingsItem.href !== 'function'
    ) {
      throw new Error('Expected the settings item to provide a link function')
    }

    const filePath = '/file/%2Fdocuments%2Fdemo-project%2Fmain.kcl'
    const location = (pathname: string) => ({ pathname }) as Location

    expect(settingsItem.href(location(filePath))).toBe(
      `${filePath}/settings?tab=project`
    )
    expect(settingsItem.href(location(`${filePath}/settings`))).toBe(
      `${filePath}/settings?tab=project`
    )
    expect(
      settingsItem.href(location('/file/%2Fdocuments%2Fdemo-project'), {
        activeFileRoutePath: filePath,
      })
    ).toBe(`${filePath}/settings?tab=project`)
    await registry.dispose()
  })
  it('constructs its actor from injected commands and files without global service providers', async () => {
    const registry = new Registry()
    const commands = {
      actor: { send: vi.fn() },
    } as unknown as CommandSystemService
    const owner = createSettingsExtension({
      commands: factory({ create: () => ({ exports: commands }) }),
      files: factory({
        create: () => ({ exports: { operations: testFileOperations } }),
      }),
    })
    try {
      await registry.configure([
        owner,
        provideWasmPromise(() => new Promise<ModuleType>(() => {})),
      ])
      const context = registry
        .required(settingsService)
        .actor.getSnapshot().context
      expect(context.commandBarActor).toBe(commands.actor)
      expect(context.fileOperations).toBe(testFileOperations)
      expect(registry.optional(commandSystemService)).toBeUndefined()
      expect(registry.optional(fileOperationsService)).toBeUndefined()
    } finally {
      await registry.dispose()
    }
  })
})
