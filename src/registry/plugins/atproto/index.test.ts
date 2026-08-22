import { pluginsValueSpec, Registry } from '@kittycad/registry'
import {
  ATPROTO_ARCHIVE_BLOB_SCOPE,
  ATPROTO_AUTH_SYNC_SCOPE,
  ATPROTO_IDENTITY_PROVIDER_ID,
  ATPROTO_PROJECT_LIBRARY_PATH_PREFIX,
  ATPROTO_PROJECT_LIBRARY_TYPE,
  getDefaultAtprotoProjectLibrarySetting,
} from '@src/lib/atprotoSync'
import {
  getProjectLibraryCreateProjectOperation,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { zdsPluginActivationSettingsValueSpec } from '@src/registry/createZdsPlugin'
import atprotoSyncPlugin, {
  ATPROTO_SYNC_PLUGIN_ID,
} from '@src/registry/plugins/atproto'
import { afterEach, describe, expect, it } from 'vitest'

describe('ATProto sync plugin', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('gates the project library type behind a sync-capable ATProto identity', () => {
    registry = new Registry()
    registry.configure([atprotoSyncPlugin])

    const plugin = registry
      .get(pluginsValueSpec)
      .find((candidate) => candidate.id === ATPROTO_SYNC_PLUGIN_ID)
    expect(plugin).toBeDefined()
    if (!plugin) {
      throw new Error('Missing ATProto sync plugin')
    }

    const activationSetting = registry
      .get(zdsPluginActivationSettingsValueSpec)
      .find((setting) => setting.pluginId === ATPROTO_SYNC_PLUGIN_ID)
    expect(activationSetting?.isActive?.(null)).toBe(false)
    expect(
      activationSetting?.isActive?.({
        provider: ATPROTO_IDENTITY_PROVIDER_ID,
        did: 'did:plc:frank',
        handle: 'franknoirot.co',
        scopes: [
          'atproto',
          ATPROTO_AUTH_SYNC_SCOPE,
          ATPROTO_ARCHIVE_BLOB_SCOPE,
        ],
        status: 'connected',
        connectedAt: '2026-08-22T00:00:00.000Z',
      })
    ).toBe(true)

    expect(
      registry
        .get(projectLibraryTypesValueSpec)
        .has(ATPROTO_PROJECT_LIBRARY_TYPE)
    ).toBe(false)

    const pluginToggle = registry.get(plugin.service)
    pluginToggle.enable()

    const libraryType = registry
      .get(projectLibraryTypesValueSpec)
      .get(ATPROTO_PROJECT_LIBRARY_TYPE)

    expect(libraryType).toMatchObject({
      type: ATPROTO_PROJECT_LIBRARY_TYPE,
      title: 'ATProto',
      icon: 'atSign',
      newLibrarySetting: {
        title: 'ATProto Projects',
        type: ATPROTO_PROJECT_LIBRARY_TYPE,
        path: `${ATPROTO_PROJECT_LIBRARY_PATH_PREFIX}franknoirot.co`,
        source: 'franknoirot.co',
      },
    })
    expect(
      getProjectLibraryCreateProjectOperation(libraryType, {
        id: 'test-atproto-library',
        ...getDefaultAtprotoProjectLibrarySetting(),
      })
    ).toBeDefined()
  })
})
