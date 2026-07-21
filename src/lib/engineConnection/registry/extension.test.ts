import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import engineCommandManagerRegistryItem from '@src/lib/engineConnection/registry'
import { engineCommandManagerService } from '@src/lib/engineConnection/registry/contract'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('engine command manager extension', () => {
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
      engineCommandManagerRegistryItem,
    ])

    const service = registry.get(engineCommandManagerService)

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
      engineCommandManagerRegistryItem,
    ])

    const manager = registry.get(engineCommandManagerService).manager
    const tearDown = vi.spyOn(manager, 'tearDown')

    registry[Symbol.dispose]()
    registry = undefined

    expect(tearDown).toHaveBeenCalledOnce()
  })
})
