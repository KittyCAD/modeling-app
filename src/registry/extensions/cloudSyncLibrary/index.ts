// The `cloud` project-library type handler is always-on infrastructure, kept
// separate from the toggle-able cloud-sync plugin so that disabling cloud sync
// never removes the ability to browse or create projects in the Personal Cloud
// folder (on web that folder is the canonical project storage). See
// cloudSyncProjectLibraryType in @src/lib/cloudSync/registry/plugin.
import { defineRegistryItem } from '@kittycad/registry'
import { apiProjectLibrariesExtension } from '@src/lib/cloudSync/registry/apiProjectLibraries'
import { cloudSyncProjectLibraryType } from '@src/lib/cloudSync/registry/plugin'

export default defineRegistryItem({
  id: 'cloud-sync-library',
  uses: [cloudSyncProjectLibraryType, apiProjectLibrariesExtension],
})
