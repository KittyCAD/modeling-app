import { statusBarGlobalItemsSignal } from '@src/signals'
import { defineExtension, provide } from '@kittycad/extensions'
import { createZdsPlugin } from '@src/extensions/createZdsPlugin'
import { PATHS, webSafeJoin } from '@src/lib/paths'

const settingsStatusBar = defineExtension({
  provides: [
    provide(statusBarGlobalItemsSignal, {
      id: 'settings',
      element: 'link',
      icon: 'settings',
      href: (location) =>
        `${webSafeJoin([location.pathname, PATHS.SETTINGS])}${
          location.pathname.includes(PATHS.FILE) ? '?tab=project' : ''
        }`,
      'data-testid': 'settings-link',
      label: 'Settings',
    }),
  ],
})

/**
 * WIP Settings plugin. Only contributes status bar item at the moment,
 * but eventually it should contribute the whole settings subsystem.
 */
export const settings = createZdsPlugin({
  id: 'settings',
  title: 'Settings status bar item',
  description: 'Whether there is a settings item in the status bar',
  extensions: [settingsStatusBar],
  defaultSetting: 'core',
})
