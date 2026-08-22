import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  ATPROTO_ARCHIVE_BLOB_SCOPE,
  ATPROTO_ARCHIVE_RECORD_COLLECTION,
  ATPROTO_AUTH_SETTING_CATEGORY,
  ATPROTO_AUTH_SETTING_NAME,
  ATPROTO_AUTH_SYNC_SCOPE,
  ATPROTO_IDENTITY_PROVIDER_ID,
  ATPROTO_OAUTH_SCOPES,
  ATPROTO_PROJECT_RECORD_COLLECTION,
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
import type { ProjectLibrarySetting } from '@src/lib/projectLibraries'
import { projectLibrariesSettingsContribution } from '@src/lib/projectLibraries/settings/setting'
import {
  type ConnectedIdentity,
  connectedIdentitiesService,
} from '@src/registry/contracts/connectedIdentities'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
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

type FakeSettingsServiceOptions = {
  identity?: AtprotoOAuthIdentity | null
  libraries?: readonly ProjectLibrarySetting[]
}

function createFakeSettingsService({
  identity,
  libraries = [],
}: FakeSettingsServiceOptions = {}): SettingsRegistryService {
  const settings = createSettings({
    ...projectLibrariesSettingsContribution,
    [ATPROTO_AUTH_SETTING_CATEGORY]: {
      [ATPROTO_AUTH_SETTING_NAME]: atprotoOAuthSetting,
    },
  })
  settings.app.libraries.user = [...libraries]
  if (identity !== undefined) {
    const authSettings = settings as SettingsType & {
      [ATPROTO_AUTH_SETTING_CATEGORY]: Record<
        string,
        { user?: AtprotoOAuthIdentity | null }
      >
    }
    authSettings[ATPROTO_AUTH_SETTING_CATEGORY][
      ATPROTO_AUTH_SETTING_NAME
    ].user = identity
  }
  const current = signal(settings)

  return {
    actor: {} as SettingsRegistryService['actor'],
    current,
    get: () => current.value,
    send: ((event: {
      type: string
      data?: { level: 'user' | 'project'; value: unknown }
    }) => {
      const match = /^set\.([^.]+)\.([^.]+)$/.exec(event.type)
      if (!match || !event.data) {
        return
      }

      const [, category, settingName] = match
      const setting = (
        current.value as SettingsType & {
          [category: string]: Record<
            string,
            { user?: unknown; project?: unknown } | undefined
          >
        }
      )[category]?.[settingName]
      if (!setting) {
        return
      }
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
        scopes: [
          'atproto',
          `repo?collection=nyc.noirot.cad.analysis&collection=${ATPROTO_ARCHIVE_RECORD_COLLECTION}&collection=nyc.noirot.cad.declaration&collection=${ATPROTO_PROJECT_RECORD_COLLECTION}&collection=nyc.noirot.cad.release&collection=nyc.noirot.cad.source`,
          ATPROTO_ARCHIVE_BLOB_SCOPE,
        ],
      })
    ).toBe(true)
    expect(
      isAtprotoSyncIdentity({
        ...connectedIdentity,
        scopes: ['atproto', ATPROTO_AUTH_SYNC_SCOPE],
      })
    ).toBe(false)
    expect(
      isAtprotoSyncIdentity({
        ...connectedIdentity,
        scopes: [
          'atproto',
          `repo?collection=${ATPROTO_PROJECT_RECORD_COLLECTION}`,
          ATPROTO_ARCHIVE_BLOB_SCOPE,
        ],
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

    await connectedIdentities.connect(ATPROTO_IDENTITY_PROVIDER_ID, {
      input: 'franknoirot.co',
    })

    expect(connector.connect).toHaveBeenCalledWith({
      scopes: ATPROTO_OAUTH_SCOPES,
      input: 'franknoirot.co',
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

  it('removes ATProto project libraries when disconnecting', async () => {
    const localLibrary = {
      title: 'Local Projects',
      path: '/Users/frank/projects',
      type: 'directory',
    } satisfies ProjectLibrarySetting
    const atprotoLibrary = {
      title: 'ATProto Projects',
      path: 'atproto://franknoirot.co',
      type: 'atproto',
      source: 'franknoirot.co',
    } satisfies ProjectLibrarySetting
    const otherAtprotoLibrary = {
      title: 'Other ATProto Projects',
      path: 'atproto://other.example',
      type: 'atproto',
      source: 'other.example',
    } satisfies ProjectLibrarySetting
    const settings = createFakeSettingsService({
      identity: connectedIdentity,
      libraries: [localLibrary, atprotoLibrary, otherAtprotoLibrary],
    })
    const connector: AtprotoOAuthConnector = {
      connect: vi.fn().mockResolvedValue(connectedIdentity),
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
    expect(connectedIdentities.identities.value).toHaveLength(1)

    await connectedIdentities.disconnect('atproto:did:plc:frank')

    expect(connector.disconnect).toHaveBeenCalledWith(connectedIdentity)
    expect(
      (
        settings.get() as SettingsType & {
          [ATPROTO_AUTH_SETTING_CATEGORY]: Record<string, { current: unknown }>
        }
      )[ATPROTO_AUTH_SETTING_CATEGORY][ATPROTO_AUTH_SETTING_NAME].current
    ).toBe(null)
    expect(settings.get().app.libraries.current).toEqual([localLibrary])
    expect(connectedIdentities.identities.value).toEqual([])
  })

  it('stores an initialized OAuth identity as a connected identity', async () => {
    const settings = createFakeSettingsService()
    const connector: AtprotoOAuthConnector = {
      initialize: vi.fn().mockResolvedValue(connectedIdentity),
      connect: vi.fn().mockResolvedValue(connectedIdentity),
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
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(connector.initialize).toHaveBeenCalledTimes(1)
    expect(connectedIdentities.identities.value).toMatchObject([
      {
        id: 'atproto:did:plc:frank',
        handle: 'franknoirot.co',
        status: 'connected',
      },
    ])
  })
})
