import { Popover } from '@headlessui/react'
import { HelpMenu } from '@src/components/HelpMenu'
import { AutoUpdateDownloadStatus } from '@src/components/StatusBar/AutoUpdateDownloadStatus'
import { AutoUpdateReadyStatus } from '@src/components/StatusBar/AutoUpdateReadyStatus'
import { DownloadDesktopApp } from '@src/components/StatusBar/DownloadDesktopApp'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import {
  EnvironmentChip,
  EnvironmentDescription,
} from '@src/components/environment/Environment'
import type {
  AutoUpdateDownloadProgress,
  AutoUpdateReady,
} from '@src/lib/autoUpdate'
import { isDesktop } from '@src/lib/isDesktop'
import { APP_VERSION, getReleaseUrl } from '@src/routes/utils'

export const defaultGlobalStatusBarItems = ({
  autoUpdateDownloadProgress,
  autoUpdateReady,
  onRestartToUpdate,
}: {
  autoUpdateDownloadProgress?: AutoUpdateDownloadProgress | null
  autoUpdateReady?: AutoUpdateReady | null
  onRestartToUpdate?: () => void
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
        'data-testid': 'download-desktop-app',
        component: DownloadDesktopApp,
      },
  ...(isDesktop() && autoUpdateDownloadProgress && !autoUpdateReady
    ? [
        {
          id: 'auto-update-download-status',
          component: () => (
            <AutoUpdateDownloadStatus progress={autoUpdateDownloadProgress} />
          ),
        },
      ]
    : []),
  ...(isDesktop() && autoUpdateReady && onRestartToUpdate
    ? [
        {
          id: 'auto-update-ready-status',
          component: () => (
            <AutoUpdateReadyStatus
              update={autoUpdateReady}
              onRestart={onRestartToUpdate}
            />
          ),
        },
      ]
    : []),
  {
    id: 'environment',
    component: EnvironmentStatusBarItem,
  },
]

function EnvironmentStatusBarItem() {
  return (
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
  )
}

export const defaultLocalStatusBarItems: StatusBarItemType[] = [
  {
    id: 'help',
    'data-testid': 'help-button',
    component: HelpMenu,
  },
]
