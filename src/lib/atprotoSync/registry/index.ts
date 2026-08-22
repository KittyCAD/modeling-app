import { defineRegistryItem, provide } from '@kittycad/registry'
import {
  ATPROTO_PROJECT_LIBRARY_TYPE,
  createAtprotoBrowserOAuthConnector,
  createAtprotoOAuthRegistryItem,
  getDefaultAtprotoProjectLibrarySetting,
} from '@src/lib/atprotoSync'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'

export const atprotoProjectLibraryType = defineRegistryItem({
  id: 'atproto-project-library-type',
  provides: [
    provide(
      projectLibraryTypesValueSpec,
      {
        type: ATPROTO_PROJECT_LIBRARY_TYPE,
        title: 'ATProto',
        order: 30,
        newLibrarySetting: getDefaultAtprotoProjectLibrarySetting(),
      },
      { key: 'atproto-project-library-type' }
    ),
  ],
})

export const atprotoOAuthRegistryItem = createAtprotoOAuthRegistryItem({
  connector: createAtprotoBrowserOAuthConnector(),
})

export const atprotoSyncRegistryItem = defineRegistryItem({
  id: 'atproto-sync',
  uses: [atprotoOAuthRegistryItem],
})

export default atprotoSyncRegistryItem
