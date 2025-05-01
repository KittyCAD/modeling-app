import { Link, type NavigateFunction, useLocation } from 'react-router-dom'
import { BillingRemaining, BillingRemainingMode } from '@src/components/BillingRemaining'

import { CustomIcon } from '@src/components/CustomIcon'
import { HelpMenu } from '@src/components/HelpMenu'
import { NetworkHealthIndicator } from '@src/components/NetworkHealthIndicator'
import { NetworkMachineIndicator } from '@src/components/NetworkMachineIndicator'
import Tooltip from '@src/components/Tooltip'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { PATHS } from '@src/lib/paths'
import { APP_VERSION, getReleaseUrl } from '@src/routes/utils'

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
        <BillingRemaining mode={BillingRemainingMode.ProgressBarFixed} />
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
