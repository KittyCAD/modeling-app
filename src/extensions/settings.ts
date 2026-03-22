import { statusBarGlobalItemsFacet } from '@src/facets'
import { createPlugin, defineExtension, provide } from '@src/lib/extensions'
import { PATHS } from '@src/lib/paths'

const settingsStatusBar = defineExtension({
  provides: [
    provide(statusBarGlobalItemsFacet, {
      id: 'settings',
      element: 'link',
      icon: 'settings',
      href: location.pathname.includes(PATHS.FILE)
        ? location.pathname + PATHS.SETTINGS + '?tab=project'
        : PATHS.HOME + PATHS.SETTINGS,
      'data-testid': 'settings-link',
      label: 'Settings',
    }),
  ],
})

/**
 * WIP Settings plugin. Only contributes status bar item at the moment,
 * but eventually it should contribute the whole settings subsystem.
 */
export const settings = createPlugin({
  id: 'settings',
  title: 'Settings status bar item',
  description: 'Whether there is a settings item in the status bar',
  extensions: [settingsStatusBar],
})
