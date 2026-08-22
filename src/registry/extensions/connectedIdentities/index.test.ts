import { Registry, defineRegistryItem, provide } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  connectedIdentitiesService,
  connectedIdentityProvidersValueSpec,
  type ConnectedIdentity,
} from '@src/registry/contracts/connectedIdentities'
import connectedIdentitiesRegistryItem from '@src/registry/extensions/connectedIdentities'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('connected identities extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('flattens live identity provider contributions into a single service', async () => {
    const disconnect = vi.fn<() => Promise<void>>(async () => undefined)
    const refresh = vi.fn<() => Promise<void>>(async () => undefined)
    const connect = vi.fn<() => Promise<void>>(async () => undefined)
    const identities = signal<ConnectedIdentity[]>([
      {
        id: 'test:one',
        provider: 'test',
        label: 'Test User',
        capabilities: ['projects:read'],
        status: 'connected',
      },
    ])

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-connected-identity-provider',
        provides: [
          provide(
            connectedIdentityProvidersValueSpec,
            {
              id: 'test',
              title: 'Test',
              identities,
              connect,
              disconnect: async () => disconnect(),
              refresh,
            },
            { key: 'test-connected-identity-provider' }
          ),
        ],
      }),
      connectedIdentitiesRegistryItem,
    ])

    const service = registry.get(connectedIdentitiesService)

    expect(service.identities.value).toEqual([
      expect.objectContaining({
        id: 'test:one',
        label: 'Test User',
      }),
    ])

    identities.value = [
      {
        id: 'test:two',
        provider: 'test',
        label: 'Second Test User',
        capabilities: ['projects:read', 'projects:write'],
        status: 'connected',
      },
    ]

    expect(service.getIdentities()).toEqual([
      expect.objectContaining({
        id: 'test:two',
        label: 'Second Test User',
      }),
    ])

    await service.connect('test')
    await service.refresh('test')
    await service.disconnect('test:two')

    expect(connect).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
