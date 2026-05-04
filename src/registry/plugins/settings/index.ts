import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { defineRegistryItem, provide } from '@kittycad/registry'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { PATHS, webSafeJoin } from '@src/lib/paths'

const settingsStatusBarItem = defineRegistryItem({
  provides: [
    provide(statusBarGlobalItemsValueSpec, {
      id: 'settings',
      element: 'link',
      icon: 'settings',
      href: (location) =>
        `${webSafeJoin([location.pathname, PATHS.SETTINGS])}${
          location.pathname.includes(PATHS.FILE) ? '?tab=project' : ''
        }`,
      'data-testid': 'settings-link',
      order: 1,
      label: 'Settings',
    }),
  ],
})

/**
 * WIP Settings plugin. Only contributes status bar item at the moment,
 * but eventually it should contribute the whole settings subsystem.
 */
const settings = createZdsPlugin({
  id: 'settings',
  title: 'Settings status bar item',
  description: 'Whether there is a settings item in the status bar',
  items: [settingsStatusBarItem],
  defaultSetting: 'core',
})

export default settings
