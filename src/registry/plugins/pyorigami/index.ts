import {
  PROJECT_SHELL_FEATURE,
  withProjectShellFeature,
} from '@src/lib/projectSession/next/feature'
import { pyorigamiExtension } from '@src/lib/pyorigami/registry'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { PYORIGAMI_PLUGIN_ID } from '@src/registry/plugins/pyorigami/ipc'

export default createZdsPlugin({
  id: PYORIGAMI_PLUGIN_ID,
  title: 'pyOrigami',
  description: 'Render Python origami diagrams in a navigable 2D canvas.',
  defaultSetting: 'off',
  activationSetting: {
    category: 'plugins',
    settingName: PYORIGAMI_PLUGIN_ID,
    hideOnLevel: 'project',
    hideWithoutFeature: PROJECT_SHELL_FEATURE,
    featurePolicy: {
      feature: PROJECT_SHELL_FEATURE,
      disableWithoutFeature: true,
    },
    userToml: { sectionKey: 'plugins', tomlKey: PYORIGAMI_PLUGIN_ID },
  },
  // Settings definitions must exist before the settings actor captures its schema.
  items: [withProjectShellFeature(pyorigamiExtension, 'pyorigami.document')],
})
