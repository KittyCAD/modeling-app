import { ActionButton } from '@src/components/ActionButton'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import type { AutoUpdateAvailable } from '@src/lib/autoUpdate'

export function AutoUpdateAvailableStatus({
  onDownload,
  update,
}: {
  onDownload: () => void
  update: AutoUpdateAvailable
}) {
  return (
    <ActionButton
      Element="button"
      className={`${defaultStatusBarItemClassNames} !bg-primary dark:!bg-primary !text-white dark:!text-white hover:!bg-primary/90 dark:hover:!bg-primary/90 focus:!bg-primary/90 dark:focus:!bg-primary/90 hover:!text-white dark:hover:!text-white focus:!text-white dark:focus:!text-white`}
      data-testid="auto-update-available-status"
      onClick={onDownload}
    >
      Download update
      <span className="sr-only">{` to v${update.version}`}</span>
      <Tooltip position="top-left">{`Download v${update.version}`}</Tooltip>
    </ActionButton>
  )
}
