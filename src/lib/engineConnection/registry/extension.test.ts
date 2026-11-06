import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { effect } from '@preact/signals-core'
import {
  ConnectionAvailability,
  ConnectionManager,
} from '@src/lib/engineConnection/connectionManager'
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

  it('updates availability synchronously through teardown and removes its subscription on disposal', () => {
    const settings = { actor: {} } as SettingsRegistryService
    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-settings-service',
        providesServices: [provideService(settingsService, settings)],
      }),
      engineConnectionRegistryItem,
    ])

    const service = registry.get(engineConnectionService)
    // Reading the signal first must lazily initialize the same manager.
    const availability = service.connectionAvailability
    const manager = service.manager
    const values: ConnectionAvailability[] = []
    const stop = effect(() => {
      values.push(availability.value)
    })

    try {
      manager.availability = ConnectionAvailability.StreamReady
      manager.availability = ConnectionAvailability.StreamReady
      manager.availability = ConnectionAvailability.AcceptingInput
      manager.tearDown({ route: 'service-disposed', initiatedBy: 'client' })
      manager.availability = ConnectionAvailability.StreamReady

      registry[Symbol.dispose]()
      registry = undefined
      manager.availability = ConnectionAvailability.AcceptingInput

      expect(values).toEqual([
        ConnectionAvailability.Unavailable,
        ConnectionAvailability.StreamReady,
        ConnectionAvailability.AcceptingInput,
        ConnectionAvailability.Unavailable,
        ConnectionAvailability.StreamReady,
        ConnectionAvailability.Unavailable,
      ])
      expect(availability.value).toBe(ConnectionAvailability.Unavailable)
    } finally {
      stop()
    }
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
