import { defineRegistryItem } from '@kittycad/registry'
import {
  createAtprotoBrowserOAuthConnector,
  createAtprotoOAuthRegistryItem,
} from '@src/lib/atprotoSync'
import { createAtprotoProjectLibraryType } from '@src/lib/atprotoSync/projectLibrary'
import { createAtprotoSyncRuntime } from '@src/lib/atprotoSync/syncRuntime'

const atprotoOAuthConnector = createAtprotoBrowserOAuthConnector()

export const atprotoOAuthRegistryItem = createAtprotoOAuthRegistryItem({
  connector: atprotoOAuthConnector,
})

export const atprotoProjectLibraryType = createAtprotoProjectLibraryType({
  connector: atprotoOAuthConnector,
})

export const atprotoSyncRuntime = createAtprotoSyncRuntime({
  connector: atprotoOAuthConnector,
})

export const atprotoSyncRegistryItem = defineRegistryItem({
  id: 'atproto-oauth',
  uses: [atprotoOAuthRegistryItem],
})

export default atprotoSyncRegistryItem
