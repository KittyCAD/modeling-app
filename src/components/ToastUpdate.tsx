import toast from 'react-hot-toast'

import { ActionButton } from '@src/components/ActionButton'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { platform } from '@src/lib/utils'
import { IS_STAGING_OR_DEBUG, getReleaseUrl } from '@src/routes/utils'
import { MarkdownText } from '@src/components/MarkdownText'

export function ToastUpdate({
  version,
  releaseNotes,
  onRestart,
  onDismiss,
}: {
  version: string
  releaseNotes?: string
  onRestart: () => void
  onDismiss: () => void
}) {
  const containsBreakingChanges = releaseNotes
    ?.toLocaleLowerCase()
    .includes('breaking')
  const dismissButton = (
    <ActionButton
      key="dismiss"
      Element="button"
      iconStart={{
        icon: 'close',
        iconClassName: 'bg-destroy-80 text-6',
      }}
      data-negative-button="dismiss"
      name="dismiss"
      onClick={() => {
        toast.dismiss()
        onDismiss()
      }}
    >
      Not right now
    </ActionButton>
  )
  const restartButton = (
    <ActionButton
      key="restart"
      Element="button"
      iconStart={{
        icon: 'arrowShortRight',
      }}
      name="accept"
      onClick={onRestart}
    >
      Restart to update
    </ActionButton>
  )
  const orderedButtons =
    platform() === 'windows'
      ? [restartButton, dismissButton]
      : [dismissButton, restartButton]

  return (
    <div className="inset-0 z-50 grid place-content-center rounded bg-chalkboard-110/50 shadow-md">
      <div className="max-w-3xl min-w-[35rem] px-8 pt-8 pb-6 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
        <div className="my-4 flex items-baseline">
          <span
            className="px-3 py-1 text-xl rounded-full bg-primary text-chalkboard-10"
            data-testid="update-version"
          >
            v{version}
          </span>
          <p className="ml-4 text-md text-bold">
            A new update is available.
            {!IS_STAGING_OR_DEBUG && (
              <span>
                {' '}
                You can view the release notes{' '}
                <a
                  onClick={openExternalBrowserIfDesktop(getReleaseUrl(version))}
                  href={getReleaseUrl(version)}
                  target="_blank"
                  rel="noreferrer"
                >
                  here on GitHub.
                </a>
              </span>
            )}
          </p>
        </div>
        {releaseNotes && (
          <details
            className="my-4 border border-chalkboard-30 dark:border-chalkboard-60 rounded"
            open={containsBreakingChanges}
            data-testid="release-notes"
          >
            <summary className="p-2 select-none cursor-pointer">
              Release notes
              {containsBreakingChanges && (
                <strong className="text-destroy-50"> (Breaking changes)</strong>
              )}
            </summary>
            <MarkdownText
              text={releaseNotes}
              className="py-2 px-4 mt-2 border-t border-chalkboard-30 dark:border-chalkboard-60 max-h-60 overflow-y-auto"
            />
          </details>
        )}
        <div className="flex flex-col gap-2">
          <p className="text-center text-2 text-xs">
            <em>
              The update will be applied when you restart the application.
            </em>
          </p>
          <div className="mt-6 flex justify-end items-center gap-2">
            {orderedButtons}
          </div>
        </div>
      </div>
    </div>
  )
}
