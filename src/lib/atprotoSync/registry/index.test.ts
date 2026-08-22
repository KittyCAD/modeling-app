import { Registry } from '@kittycad/registry'
import {
  ATPROTO_PROJECT_LIBRARY_PATH_PREFIX,
  ATPROTO_PROJECT_LIBRARY_TYPE,
  getDefaultAtprotoProjectLibrarySetting,
} from '@src/lib/atprotoSync'
import atprotoProjectLibraryRegistryItem from '@src/lib/atprotoSync/registry'
import {
  getProjectLibraryCreateProjectOperation,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { afterEach, describe, expect, it } from 'vitest'

describe('ATProto project library registry item', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('registers a library type without project operations until identity wiring exists', () => {
    registry = new Registry()
    registry.configure([atprotoProjectLibraryRegistryItem])

    const libraryType = registry
      .get(projectLibraryTypesValueSpec)
      .get(ATPROTO_PROJECT_LIBRARY_TYPE)

    expect(libraryType).toMatchObject({
      type: ATPROTO_PROJECT_LIBRARY_TYPE,
      title: 'ATProto',
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
    ).toBeUndefined()
  })
})
