import { APP_VERSION } from 'routes/Settings'
import { CustomIcon } from 'components/CustomIcon'
import Tooltip from 'components/Tooltip'
import { paths } from 'lib/paths'
import { NetworkHealthIndicator } from 'components/NetworkHealthIndicator'
import { HelpMenu } from './HelpMenu'
import { Link, useLocation } from 'react-router-dom'
import { useAbsoluteFilePath } from 'hooks/useAbsoluteFilePath'
import { coreDump } from 'lang/wasm'
import toast from 'react-hot-toast'
import { CoreDumpManager } from 'lib/coredump'
import { CoreDumpInfo } from 'wasm-lib/kcl/bindings/CoreDumpInfo'
import openWindow from 'lib/openWindow'

export function LowerRightControls({
  coreDumpManager,
  children,
}: {
  coreDumpManager?: CoreDumpManager
  children: React.ReactNode
}) {
  const location = useLocation()
  const filePath = useAbsoluteFilePath()
  const linkOverrideClassName =
    '!text-chalkboard-70 hover:!text-chalkboard-80 dark:!text-chalkboard-40 dark:hover:!text-chalkboard-30'

  const isPlayWright = window?.localStorage.getItem('playwright') === 'true'

  async function reportbug(event: Event) {
    event.preventDefault()

    if (!coreDumpManager) {
      // open default reporting option
      openWindow('https://github.com/KittyCAD/modeling-app/issues/new/choose')
    } else {
      console.warn('CoreDump: Initializing core dump')
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
            )
          }
        })
    }
  }

  return (
    <section className="fixed bottom-2 right-2 flex flex-col items-end gap-3 pointer-events-none">
      {children}
      <menu className="flex items-center justify-end gap-3 pointer-events-auto">
        <a
          href={`https://github.com/KittyCAD/modeling-app/releases/tag/v${APP_VERSION}`}
          target="_blank"
          rel="noopener noreferrer"
          className={'!no-underline font-mono text-xs ' + linkOverrideClassName}
        >
          v{isPlayWright ? '11.22.33' : APP_VERSION}
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
          <Tooltip position="top">Report a bug</Tooltip>
        </a>
        <Link
          to={
            location.pathname.includes(paths.FILE)
              ? filePath + paths.SETTINGS
              : paths.HOME + paths.SETTINGS
          }
        >
          <CustomIcon
            name="settings"
            className={`w-5 h-5 ${linkOverrideClassName}`}
          />
          <Tooltip position="top">Settings</Tooltip>
        </Link>
        <NetworkHealthIndicator />
        <HelpMenu />
      </menu>
    </section>
  )
}
