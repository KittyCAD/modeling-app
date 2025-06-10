import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import type { Location } from 'react-router-dom'
import { PATHS } from '@src/lib/paths'
import { APP_VERSION } from '@src/routes/utils'

export const homeDefaultStatusBarItems = ({
  location,
}: {
  location: Location
}): StatusBarItemType[] => [
    {
      id: 'version',
      element: 'externalLink',
      label: `v${APP_VERSION}`,
      href: `https://github.com/KittyCAD/modeling-app/releases/tag/v${APP_VERSION}`,
      toolTip: {
        children: 'View the release notes on GitHub',
      },
    },
    {
      id: 'telemetry',
      element: 'link',
      icon: 'stopwatch',
      href: `.${PATHS.TELEMETRY}`,
      'data-testid': 'telemetry-link',
      label: 'Telemetry',
      hideLabel: true,
      toolTip: {
        children: 'Telemetry',
      },
    },
    {
      id: 'settings',
      element: 'link',
      icon: 'settings',
      href: `.${PATHS.SETTINGS}${location.pathname.includes(PATHS.FILE) ? '?tab=project' : ''}`,
      'data-testid': 'settings-link',
      label: 'Settings',
    },
  ]
