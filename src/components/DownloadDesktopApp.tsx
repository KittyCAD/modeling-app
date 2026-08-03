import { ActionButton } from '@src/components/ActionButton'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { APP_DOWNLOAD_PATH } from '@src/routes/utils'

export function DownloadDesktopApp({
  className,
  testId = 'download-desktop-app',
}: {
  className?: string
  testId?: string
}) {
  return (
    <ActionButton
      Element="externalLink"
      to={withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`)}
      className={className}
      iconStart={{
        icon: 'download',
        bgClassName: '!bg-transparent rounded-sm',
      }}
      aria-label="Download desktop app"
      data-testid={testId}
    >
      Download desktop app
    </ActionButton>
  )
}
