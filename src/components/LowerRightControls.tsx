import { Link, type NavigateFunction, useLocation } from 'react-router-dom'
import { Popover } from '@headlessui/react'
import {
  BillingRemaining,
  BillingRemainingMode,
} from '@src/components/BillingRemaining'
import { BillingDialog } from '@src/components/BillingDialog'

import { CustomIcon } from '@src/components/CustomIcon'
import { HelpMenu } from '@src/components/HelpMenu'
import { NetworkHealthIndicator } from '@src/components/NetworkHealthIndicator'
import { NetworkMachineIndicator } from '@src/components/NetworkMachineIndicator'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { PATHS } from '@src/lib/paths'
import {
  APP_VERSION,
  IS_NIGHTLY_OR_DEBUG,
  getReleaseUrl,
} from '@src/routes/utils'

import { billingActor } from '@src/lib/singletons'

export function LowerRightControls({
  children,
  navigate = () => {},
}: {
  children?: React.ReactNode
  navigate?: NavigateFunction
}) {
  const location = useLocation()
  const filePath = useAbsoluteFilePath()

  const linkOverrideClassName =
    '!text-chalkboard-70 hover:!text-chalkboard-80 dark:!text-chalkboard-40 dark:hover:!text-chalkboard-30'

  return (
    <section className="fixed bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
      {children}
      <menu className="flex items-center justify-end gap-3 pointer-events-auto">
        {IS_NIGHTLY_OR_DEBUG && (
          <Popover className="relative">
            <Popover.Button className="p-0">
              <BillingRemaining
                mode={BillingRemainingMode.ProgressBarFixed}
                billingActor={billingActor}
              />
            </Popover.Button>
            <Popover.Panel className="absolute right-0 left-auto bottom-full mb-1 w-64 flex flex-col gap-1 align-stretch bg-chalkboard-10 dark:bg-chalkboard-90 rounded shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50 text-sm">
              <BillingDialog billingActor={billingActor} />
            </Popover.Panel>
          </Popover>
        )}
        <a
          onClick={openExternalBrowserIfDesktop(getReleaseUrl())}
          href={getReleaseUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className={'!no-underline font-mono text-xs ' + linkOverrideClassName}
        >
          v{APP_VERSION}
        </a>
        <Link
          to={
            location.pathname.includes(PATHS.FILE)
              ? filePath + PATHS.TELEMETRY + '?tab=project'
              : PATHS.HOME + PATHS.TELEMETRY
          }
          data-testid="telemetry-link"
        >
          <CustomIcon
            name="stopwatch"
            className={`w-5 h-5 ${linkOverrideClassName}`}
          />
          <span className="sr-only">Telemetry</span>
          <Tooltip position="top" contentClassName="text-xs">
            Telemetry
          </Tooltip>
        </Link>
        <Link
          to={
            location.pathname.includes(PATHS.FILE)
              ? filePath + PATHS.SETTINGS + '?tab=project'
              : PATHS.HOME + PATHS.SETTINGS
          }
          data-testid="settings-link"
        >
          <CustomIcon
            name="settings"
            className={`w-5 h-5 ${linkOverrideClassName}`}
          />
          <span className="sr-only">Settings</span>
          <Tooltip position="top" contentClassName="text-xs">
            Settings
          </Tooltip>
        </Link>
        <NetworkMachineIndicator className={linkOverrideClassName} />
        {!location.pathname.startsWith(PATHS.HOME) && (
          <NetworkHealthIndicator />
        )}
        <HelpMenu navigate={navigate} />
      </menu>
    </section>
  )
}
