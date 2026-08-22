import { defineRegistryItem } from '@kittycad/registry'
import {
  createAtprotoBrowserOAuthConnector,
  createAtprotoOAuthRegistryItem,
} from '@src/lib/atprotoSync'
import { createAtprotoProjectLibraryType } from '@src/lib/atprotoSync/projectLibrary'

const atprotoOAuthConnector = createAtprotoBrowserOAuthConnector()

export const atprotoOAuthRegistryItem = createAtprotoOAuthRegistryItem({
  connector: atprotoOAuthConnector,
})

export const atprotoProjectLibraryType = createAtprotoProjectLibraryType({
  connector: atprotoOAuthConnector,
})

export const atprotoSyncRegistryItem = defineRegistryItem({
  id: 'atproto-sync',
  uses: [atprotoOAuthRegistryItem],
})

export default atprotoSyncRegistryItem
