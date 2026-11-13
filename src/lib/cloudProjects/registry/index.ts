import { cloudProjectPollingExtension } from '@src/lib/cloudProjects/registry/polling'
import { cloudProjectSessionExtension } from '@src/lib/cloudProjects/registry/session'
import { defineRegistryItem } from '@kittycad/registry'
import { cloudProjectsExtension } from '@src/lib/cloudProjects/registry/extension'
import library from '@src/lib/cloudProjects/registry/library'

export default defineRegistryItem({
  id: 'cloud-projects',
  uses: [
    cloudProjectsExtension,
    cloudProjectSessionExtension,
    cloudProjectPollingExtension,
    library,
  ],
})
