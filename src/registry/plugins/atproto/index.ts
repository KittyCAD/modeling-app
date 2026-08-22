import {
  ATPROTO_AUTH_SETTING_CATEGORY,
  ATPROTO_AUTH_SETTING_NAME,
  isAtprotoSyncIdentity,
} from '@src/lib/atprotoSync'
import { atprotoProjectLibraryType } from '@src/lib/atprotoSync/registry'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'

export const ATPROTO_SYNC_PLUGIN_ID = 'atproto-sync'

export const atprotoSyncPlugin = createZdsPlugin({
  id: ATPROTO_SYNC_PLUGIN_ID,
  title: 'ATProto sync',
  description: 'Experimental ATProto-backed project library sync.',
  items: [atprotoProjectLibraryType],
  defaultSetting: 'off',
  activationSetting: {
    category: ATPROTO_AUTH_SETTING_CATEGORY,
    settingName: ATPROTO_AUTH_SETTING_NAME,
    contributeSetting: false,
    isActive: isAtprotoSyncIdentity,
  },
})

export default atprotoSyncPlugin
