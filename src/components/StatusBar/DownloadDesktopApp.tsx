import { ActionIcon } from '@src/components/ActionIcon'
import Tooltip from '@src/components/Tooltip'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { APP_DOWNLOAD_PATH } from '@src/routes/utils'

const TOOLTIP_READ_DURATION_MS = 8_000

export function DownloadDesktopApp() {
  const href = withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`)
  const tooltipContent = (
    <span className="flex items-center gap-2">
      ⚠ This demo project is only stored in your browser. Our desktop app will
      allow you to work on multiple projects.
    </span>
  )

  return (
    <div className="relative flex items-stretch">
      <a
        href={href}
        className={`${defaultStatusBarItemClassNames} flex items-center gap-2`}
        data-testid="download-desktop-app"
      >
        <ActionIcon
          icon="download"
          bgClassName="bg-transparent dark:bg-transparent"
        />
        <span>Install desktop app</span>
      </a>
      <Tooltip
        position="top-left"
        initialOpen
        initialOpenDuration={TOOLTIP_READ_DURATION_MS}
        contentClassName="max-w-80"
      >
        {tooltipContent}
      </Tooltip>
    </div>
  )
}
