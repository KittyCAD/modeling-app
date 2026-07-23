import { defineRegistryItem, provide } from '@kittycad/registry'
import { projectLibrariesSettingsContribution } from '@src/lib/projectLibraries/settings/setting'
import { settingsValueSpec } from '@src/registry/contracts/settings'

const projectLibrariesExtension = defineRegistryItem({
  id: 'project-libraries',
  provides: [provide(settingsValueSpec, projectLibrariesSettingsContribution)],
})

export default projectLibrariesExtension
