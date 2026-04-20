import { ActionButton } from '@src/components/ActionButton'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import type { AutoUpdateReady } from '@src/lib/autoUpdate'

export function AutoUpdateReadyStatus({
  onRestart,
  update,
}: {
  onRestart: () => void
  update: AutoUpdateReady
}) {
  return (
    <ActionButton
      Element="button"
      className={`${defaultStatusBarItemClassNames} !text-primary dark:!text-primary hover:!text-primary dark:hover:!text-primary`}
      data-testid="auto-update-ready-status"
      onClick={onRestart}
    >
      Restart to update
      <span className="sr-only">{` to v${update.version}`}</span>
    </ActionButton>
  )
}
