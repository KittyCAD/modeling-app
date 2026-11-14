import { createSettings } from '@src/lib/settings/initialSettings'
import { Themes } from '@src/lib/theme'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { createEngineConnectionExtension } from '@src/lib/engineConnection/registry/extension'
import { engineConnectionService } from '@src/lib/engineConnection/registry/contract'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import { factory, provide, Registry } from 'plankton'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('engine connection extension', () => {
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
    registry = undefined
  })
  it('keeps its injected settings while the globally selected provider changes', async () => {
    const preferences = createSettings()
    preferences.app.theme.user = Themes.Dark
    const settings = {
      actor: { getSnapshot: () => ({ context: preferences }) },
    } as SettingsRegistryService
    const injected = createEngineConnectionExtension(
      factory({ create: () => ({ exports: settings }) })
    )
    registry = new Registry()
    await registry.configure([
      provide(settingsService, { actor: {} } as SettingsRegistryService),
      injected,
    ])
    const manager = registry.required(engineConnectionService).manager
    expect(manager).toBeInstanceOf(ConnectionManager)
    expect(manager.settings.theme).toBe('dark')
    await registry.configure([injected])
    expect(registry.optional(settingsService)).toBeUndefined()
    preferences.app.theme.user = Themes.Light
    expect(registry.required(engineConnectionService).manager).toBe(manager)
    expect(manager.settings.theme).toBe('light')
  })
  it('tears down the ConnectionManager when disposed', async () => {
    const settings = {
      actor: {},
    } as SettingsRegistryService

    registry = new Registry()
    await registry.configure([
      [provide(settingsService, settings)],
      createEngineConnectionExtension(
        factory({ create: () => ({ exports: settings }) })
      ),
    ])
    const manager = registry.required(engineConnectionService).manager
    const tearDown = vi.spyOn(manager, 'tearDown')
    await registry.dispose()
    registry = undefined

    expect(tearDown).toHaveBeenCalledOnce()
  })
})
