import { Popover } from '@headlessui/react'
import { BillingDialog } from '@src/components/BillingDialog'
import {
  BillingRemaining,
  BillingRemainingMode,
} from '@src/components/BillingRemaining'
import { desktopAppPitchMessage } from '@src/components/DownloadAppToast'
import { HelpMenu } from '@src/components/HelpMenu'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import Tooltip from '@src/components/Tooltip'
import {
  EnvironmentChip,
  EnvironmentDescription,
} from '@src/components/environment/Environment'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS } from '@src/lib/paths'
import { billingActor } from '@src/lib/singletons'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { APP_VERSION, getReleaseUrl } from '@src/routes/utils'
import { APP_DOWNLOAD_PATH } from '@src/routes/utils'
import type { Location } from 'react-router-dom'

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
        href: getReleaseUrl(),
        toolTip: {
          children: 'View the release notes on GitHub',
        },
      }
    : {
        id: 'download-desktop-app',
        element: 'externalLink',
        label: 'Download the app',
        href: withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`),
        icon: 'download',
        toolTip: {
          children: desktopAppPitchMessage,
        },
      },
  {
    id: 'environment',
    component: EnvironmentStatusBarItem,
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

function EnvironmentStatusBarItem() {
  return isDesktop() ? (
    <Popover className="relative flex items-stretch">
      <Popover.Button
        className="m-0 p-0 border-0 flex items-stretch"
        data-testid="environment-subdomain-bar"
      >
        <EnvironmentChip />
      </Popover.Button>
      <Popover.Panel className="absolute left-0 bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch rounded-lg shadow-lg text-sm">
        <EnvironmentDescription />
      </Popover.Panel>
    </Popover>
  ) : (
    <></>
  )
}

export const defaultLocalStatusBarItems: StatusBarItemType[] = [
  {
    id: 'help',
    'data-testid': 'help-button',
    component: HelpMenu,
  },
]
