import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import engineConnectionRegistryItem from '@src/lib/engineConnection/registry'
import { engineConnectionService } from '@src/lib/engineConnection/registry/contract'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('engine connection extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('provides a ConnectionManager instance through the registry', () => {
    const settings = {
      actor: {},
    } as SettingsRegistryService

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-settings-service',
        providesServices: [provideService(settingsService, settings)],
      }),
      engineConnectionRegistryItem,
    ])

    const service = registry.get(engineConnectionService)

    expect(service.manager).toBeInstanceOf(ConnectionManager)
  })

  it('tears down the ConnectionManager when disposed', () => {
    const settings = {
      actor: {},
    } as SettingsRegistryService

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-settings-service',
        providesServices: [provideService(settingsService, settings)],
      }),
      engineConnectionRegistryItem,
    ])

    const manager = registry.get(engineConnectionService).manager
    const tearDown = vi.spyOn(manager, 'tearDown')

    registry[Symbol.dispose]()
    registry = undefined

    expect(tearDown).toHaveBeenCalledOnce()
  })
})
