import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import type { Location } from 'react-router-dom'
import { PATHS } from '@src/lib/paths'
import { APP_VERSION } from '@src/routes/utils'
import {
  BillingRemaining,
  BillingRemainingMode,
} from '@src/components/BillingRemaining'
import { billingActor } from '@src/lib/singletons'
import { BillingDialog } from '@src/components/BillingDialog'
import { Popover } from '@headlessui/react'
import Tooltip from '@src/components/Tooltip'
import { HelpMenu } from '@src/components/HelpMenu'
import { isDesktop } from '@src/lib/isDesktop'
import { VITE_KC_SITE_BASE_URL } from '@src/env'
import { APP_DOWNLOAD_PATH } from '@src/lib/constants'
import { desktopAppPitchMessage } from '@src/components/DownloadAppToast'

export const defaultGlobalStatusBarItems = ({
  location,
  filePath,
}: {
  location: Location
  filePath?: string
}): StatusBarItemType[] => [
  isDesktop()
    ? {
        id: 'version',
        element: 'externalLink',
        label: `v${APP_VERSION}`,
        href: `https://github.com/KittyCAD/modeling-app/releases/tag/v${APP_VERSION}`,
        toolTip: {
          children: 'View the release notes on GitHub',
        },
      }
    : {
        id: 'download-desktop-app',
        element: 'externalLink',
        label: 'Download the app',
        href: `${VITE_KC_SITE_BASE_URL}/${APP_DOWNLOAD_PATH}`,
        icon: 'download',
        toolTip: {
          children: desktopAppPitchMessage,
        },
      },
  {
    id: 'telemetry',
    element: 'link',
    icon: 'stopwatch',
    href: location.pathname.includes(PATHS.FILE)
      ? filePath + PATHS.TELEMETRY + '?tab=project'
      : PATHS.HOME + PATHS.TELEMETRY,
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
    href: location.pathname.includes(PATHS.FILE)
      ? filePath + PATHS.SETTINGS + '?tab=project'
      : PATHS.HOME + PATHS.SETTINGS,
    'data-testid': 'settings-link',
    label: 'Settings',
  },
  {
    id: 'credits',
    'data-testid': 'billing-remaining-bar',
    component: BillingStatusBarItem,
  },
]

function BillingStatusBarItem() {
  return (
    <Popover className="relative flex items-stretch">
      <Popover.Button
        className="m-0 p-0 border-0 flex items-stretch"
        data-testid="billing-remaining-bar"
      >
        <BillingRemaining
          mode={BillingRemainingMode.ProgressBarFixed}
          billingActor={billingActor}
        />
        <Tooltip
          position="top"
          contentClassName="text-xs"
          hoverOnly
          wrapperClassName="ui-open:!hidden"
        >
          Text-to-CAD credits
        </Tooltip>
      </Popover.Button>
      <Popover.Panel className="absolute left-0 bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch rounded-lg shadow-lg text-sm">
        <BillingDialog billingActor={billingActor} />
      </Popover.Panel>
    </Popover>
  )
}

export const defaultLocalStatusBarItems: StatusBarItemType[] = [
  {
    id: 'help',
    'data-testid': 'help-button',
    component: HelpMenu,
  },
]
