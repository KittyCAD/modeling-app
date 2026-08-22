import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  ATPROTO_ARCHIVE_BLOB_SCOPE,
  ATPROTO_AUTH_SETTING_CATEGORY,
  ATPROTO_AUTH_SETTING_NAME,
  ATPROTO_AUTH_SYNC_SCOPE,
  ATPROTO_IDENTITY_PROVIDER_ID,
  ATPROTO_OAUTH_SCOPES,
  type AtprotoOAuthConnector,
  type AtprotoOAuthIdentity,
  atprotoConnectedIdentityFromOAuthIdentity,
  atprotoOAuthSetting,
  createAtprotoOAuthRegistryItem,
  isAtprotoSyncIdentity,
} from '@src/lib/atprotoSync/oauth'
import {
  createSettings,
  type SettingsType,
} from '@src/lib/settings/initialSettings'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import {
  connectedIdentitiesService,
  type ConnectedIdentity,
} from '@src/registry/contracts/connectedIdentities'
import connectedIdentitiesRegistryItem from '@src/registry/extensions/connectedIdentities'
import { afterEach, describe, expect, it, vi } from 'vitest'

const connectedIdentity: AtprotoOAuthIdentity = {
  provider: ATPROTO_IDENTITY_PROVIDER_ID,
  did: 'did:plc:frank',
  handle: 'franknoirot.co',
  pdsUrl: 'https://pds.example',
  scopes: ['atproto', ATPROTO_AUTH_SYNC_SCOPE, ATPROTO_ARCHIVE_BLOB_SCOPE],
  status: 'connected',
  connectedAt: '2026-08-22T00:00:00.000Z',
}

function createFakeSettingsService(): SettingsRegistryService {
  const settings = createSettings({
    [ATPROTO_AUTH_SETTING_CATEGORY]: {
      [ATPROTO_AUTH_SETTING_NAME]: atprotoOAuthSetting,
    },
  })
  const current = signal(settings)

  return {
    actor: {} as SettingsRegistryService['actor'],
    current,
    get: () => current.value,
    send: ((event: {
      type: string
      data?: { level: 'user' | 'project'; value: unknown }
    }) => {
      if (
        event.type !==
          `set.${ATPROTO_AUTH_SETTING_CATEGORY}.${ATPROTO_AUTH_SETTING_NAME}` ||
        !event.data
      ) {
        return
      }

      const setting = (
        current.value as SettingsType & {
          [ATPROTO_AUTH_SETTING_CATEGORY]: Record<
            string,
            { user?: unknown; project?: unknown }
          >
        }
      )[ATPROTO_AUTH_SETTING_CATEGORY][ATPROTO_AUTH_SETTING_NAME]
      setting[event.data.level] = event.data.value
      current.value = { ...current.value }
    }) as SettingsRegistryService['send'],
    useSettings: () => current.value,
  }
}

describe('ATProto OAuth identity provider', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('projects OAuth identity snapshots into ConnectedIdentity records', () => {
    expect(
      atprotoConnectedIdentityFromOAuthIdentity(connectedIdentity)
    ).toEqual({
      id: 'atproto:did:plc:frank',
      provider: 'atproto',
      label: 'franknoirot.co',
      handle: 'franknoirot.co',
      did: 'did:plc:frank',
      capabilities: [
        'atproto:oauth',
        ATPROTO_AUTH_SYNC_SCOPE,
        ATPROTO_ARCHIVE_BLOB_SCOPE,
      ],
      status: 'connected',
    } satisfies ConnectedIdentity)
  })

  it('requires connected sync and blob scopes for sync activation', () => {
    expect(isAtprotoSyncIdentity(connectedIdentity)).toBe(true)
    expect(
      isAtprotoSyncIdentity({
        ...connectedIdentity,
        scopes: ['atproto', ATPROTO_AUTH_SYNC_SCOPE],
      })
    ).toBe(false)
    expect(
      isAtprotoSyncIdentity({
        ...connectedIdentity,
        status: 'expired',
      })
    ).toBe(false)
    expect(
      isAtprotoSyncIdentity({
        ...connectedIdentity,
        scopes: ['atproto', 'transition:generic'],
      })
    ).toBe(true)
  })

  it('connects, refreshes, and disconnects through the registry service', async () => {
    const settings = createFakeSettingsService()
    const refreshedIdentity: AtprotoOAuthIdentity = {
      ...connectedIdentity,
      handle: 'fresh.franknoirot.co',
    }
    const connector: AtprotoOAuthConnector = {
      connect: vi.fn().mockResolvedValue(connectedIdentity),
      refresh: vi.fn().mockResolvedValue(refreshedIdentity),
      disconnect: vi.fn().mockResolvedValue(undefined),
    }

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'fake-settings-service',
        providesServices: [provideService(settingsService, settings)],
      }),
      connectedIdentitiesRegistryItem,
      createAtprotoOAuthRegistryItem({ connector }),
    ])

    const connectedIdentities = registry.get(connectedIdentitiesService)
    expect(connectedIdentities.identities.value).toEqual([])

    await connectedIdentities.connect(ATPROTO_IDENTITY_PROVIDER_ID)

    expect(connector.connect).toHaveBeenCalledWith({
      scopes: ATPROTO_OAUTH_SCOPES,
    })
    expect(connectedIdentities.identities.value).toMatchObject([
      {
        id: 'atproto:did:plc:frank',
        handle: 'franknoirot.co',
        status: 'connected',
      },
    ])

    await connectedIdentities.refresh(ATPROTO_IDENTITY_PROVIDER_ID)

    expect(connector.refresh).toHaveBeenCalledWith(connectedIdentity)
    expect(connectedIdentities.identities.value[0]).toMatchObject({
      handle: 'fresh.franknoirot.co',
    })

    await connectedIdentities.disconnect('atproto:did:plc:frank')

    expect(connector.disconnect).toHaveBeenCalledWith(refreshedIdentity)
    expect(connectedIdentities.identities.value).toEqual([])
  })
})
