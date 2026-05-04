import { ActionButton } from '@src/components/ActionButton'
import { MarkdownText } from '@src/components/MarkdownText'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import type { AutoUpdateReady } from '@src/lib/autoUpdate'

export function AutoUpdateReadyStatus({
  onRestart,
  update,
}: {
  onRestart: () => void
  update: AutoUpdateReady
}) {
  const releaseNotes = update.releaseNotes?.trim() ?? ''
  const hasReleaseNotes = releaseNotes.length > 0
  const containsBreakingChanges = releaseNotes
    .toLowerCase()
    .includes('breaking')

  return (
    <ActionButton
      Element="button"
      className={`${defaultStatusBarItemClassNames} !bg-primary dark:!bg-primary !text-white dark:!text-white hover:!bg-primary/90 dark:hover:!bg-primary/90 focus:!bg-primary/90 dark:focus:!bg-primary/90 hover:!text-white dark:hover:!text-white focus:!text-white dark:focus:!text-white`}
      data-testid="auto-update-ready-status"
      onClick={onRestart}
    >
      Restart to update
      <span className="sr-only">{` to v${update.version}`}</span>
      {hasReleaseNotes && (
        <Tooltip
          data-testid="auto-update-release-notes-tooltip"
          position="top-left"
          wrapperClassName="z-50 pointer-events-auto"
          contentClassName="max-w-[28rem] text-left pb-0"
          inert={false}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="px-1 pt-0.5 space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-chalkboard-70 dark:text-chalkboard-40">
              {`Release notes for v${update.version}`}
            </p>
            {containsBreakingChanges && (
              <p className="text-xs text-destroy-70 dark:text-destroy-50">
                Contains breaking changes.
              </p>
            )}
            <MarkdownText
              text={releaseNotes}
              className="block text-xs leading-relaxed max-h-48 overflow-y-auto pb-0"
            />
          </div>
        </Tooltip>
      )}
    </ActionButton>
  )
}
