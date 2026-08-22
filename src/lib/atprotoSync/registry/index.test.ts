import { Registry } from '@kittycad/registry'
import {
  ATPROTO_AUTH_SETTING_CATEGORY,
  ATPROTO_AUTH_SETTING_NAME,
  ATPROTO_PROJECT_LIBRARY_TYPE,
} from '@src/lib/atprotoSync'
import atprotoSyncRegistryItem from '@src/lib/atprotoSync/registry'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { afterEach, describe, expect, it } from 'vitest'

describe('ATProto sync registry item', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('registers auth settings without activating the project library type', () => {
    registry = new Registry()
    registry.configure([atprotoSyncRegistryItem])

    expect(
      registry.get(settingsValueSpec)[ATPROTO_AUTH_SETTING_CATEGORY]?.[
        ATPROTO_AUTH_SETTING_NAME
      ]
    ).toBeDefined()
    expect(
      registry
        .get(projectLibraryTypesValueSpec)
        .has(ATPROTO_PROJECT_LIBRARY_TYPE)
    ).toBe(false)
  })
})
