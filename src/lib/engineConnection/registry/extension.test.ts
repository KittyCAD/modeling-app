import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import engineConnectionRegistryItem from '@src/lib/engineConnection/registry'
import { engineConnectionService } from '@src/lib/engineConnection/registry/contract'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import { provide, Registry } from 'plankton'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('engine connection extension', () => {
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
    registry = undefined
  })
  it('provides a ConnectionManager instance through the registry', async () => {
    const settings = {
      actor: {},
    } as SettingsRegistryService

    registry = new Registry()
    await registry.configure([
      [provide(settingsService, settings)],
      engineConnectionRegistryItem,
    ])
    const service = registry.required(engineConnectionService)
    expect(service.manager).toBeInstanceOf(ConnectionManager)
  })
  it('tears down the ConnectionManager when disposed', async () => {
    const settings = {
      actor: {},
    } as SettingsRegistryService

    registry = new Registry()
    await registry.configure([
      [provide(settingsService, settings)],
      engineConnectionRegistryItem,
    ])
    const manager = registry.required(engineConnectionService).manager
    const tearDown = vi.spyOn(manager, 'tearDown')
    await registry.dispose()
    registry = undefined

    expect(tearDown).toHaveBeenCalledOnce()
  })
})
