import { CustomIcon } from 'components/CustomIcon'
import { NetworkHealthIndicator } from 'components/NetworkHealthIndicator'
import Tooltip from 'components/Tooltip'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import { coreDump } from 'lang/wasm'
import { CoreDumpManager } from 'lib/coredump'
import openWindow, { openExternalBrowserIfDesktop } from 'lib/openWindow'
import { PATHS } from 'lib/paths'
import { reportRejection } from 'lib/trap'
import toast from 'react-hot-toast'
import { Link, useLocation } from 'react-router-dom'
import { APP_VERSION, getReleaseUrl } from 'routes/Settings'

import { HelpMenu } from './HelpMenu'
import { ModelStateIndicator } from './ModelStateIndicator'
import { NetworkMachineIndicator } from './NetworkMachineIndicator'

export function LowerRightControls({
  children,
  coreDumpManager,
}: {
  children?: React.ReactNode
  coreDumpManager?: CoreDumpManager
}) {
  const location = useLocation()
  const filePath = useAbsoluteFilePath()

  const linkOverrideClassName =
    '!text-chalkboard-70 hover:!text-chalkboard-80 dark:!text-chalkboard-40 dark:hover:!text-chalkboard-30'

  function reportbug(event: {
    preventDefault: () => void
    stopPropagation: () => void
  }) {
    event?.preventDefault()
    event?.stopPropagation()

    if (!coreDumpManager) {
      // open default reporting option
      openWindow(
        'https://github.com/KittyCAD/modeling-app/issues/new/choose'
      ).catch(reportRejection)
    } else {
      toast
        .promise(
          coreDump(coreDumpManager, true),
          {
            loading: 'Preparing bug report...',
            success: 'Bug report opened in new window',
            error: 'Unable to export a core dump. Using default reporting.',
          },
          {
            success: {
              // Note: this extended duration is especially important for Playwright e2e testing
              // default duration is 2000 - https://react-hot-toast.com/docs/toast#default-durations
              duration: 6000,
            },
          }
        )
        .catch((err: Error) => {
          if (err) {
            openWindow(
              'https://github.com/KittyCAD/modeling-app/issues/new/choose'
            ).catch(reportRejection)
          }
        })
    }
  }

  return (
    <section className="fixed bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
      {children}
      <menu className="flex items-center justify-end gap-3 pointer-events-auto">
        {!location.pathname.startsWith(PATHS.HOME) && <ModelStateIndicator />}
        <a
          onClick={openExternalBrowserIfDesktop(getReleaseUrl())}
          href={getReleaseUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className={'!no-underline font-mono text-xs ' + linkOverrideClassName}
        >
          v{APP_VERSION}
        </a>
        <a
          onClick={reportbug}
          href="https://github.com/KittyCAD/modeling-app/issues/new/choose"
          target="_blank"
          rel="noopener noreferrer"
        >
          <CustomIcon
            name="bug"
            className={`w-5 h-5 ${linkOverrideClassName}`}
          />
          <Tooltip position="top" contentClassName="text-xs">
            Report a bug
          </Tooltip>
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
        <HelpMenu />
      </menu>
    </section>
  )
}
