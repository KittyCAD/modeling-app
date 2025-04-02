import type { MarkedOptions } from '@ts-stack/markdown'
import { Marked, escape, unescape } from '@ts-stack/markdown'
import toast from 'react-hot-toast'

import { ActionButton } from '@src/components/ActionButton'
import { SafeRenderer } from '@src/lib/markdown'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { getReleaseUrl } from '@src/routes/Settings'

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

  const markedOptions: MarkedOptions = {
    gfm: true,
    breaks: true,
    sanitize: true,
    unescape,
    escape,
  }

  return (
    <div className="inset-0 z-50 grid place-content-center rounded bg-chalkboard-110/50 shadow-md">
      <div className="max-w-3xl min-w-[35rem] p-8 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
        <div className="my-4 flex items-baseline">
          <span
            className="px-3 py-1 text-xl rounded-full bg-primary text-chalkboard-10"
            data-testid="update-version"
          >
            v{version}
          </span>
          <p className="ml-4 text-md text-bold">
            A new update has downloaded and will be available next time you
            start the app. You can view the release notes{' '}
            <a
              onClick={openExternalBrowserIfDesktop(getReleaseUrl(version))}
              href={getReleaseUrl(version)}
              target="_blank"
              rel="noreferrer"
            >
              here on GitHub.
            </a>
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
            <div
              className="parsed-markdown py-2 px-4 mt-2 border-t border-chalkboard-30 dark:border-chalkboard-60 max-h-60 overflow-y-auto"
              dangerouslySetInnerHTML={{
                __html: Marked.parse(releaseNotes, {
                  renderer: new SafeRenderer(markedOptions),
                  ...markedOptions,
                }),
              }}
            ></div>
          </details>
        )}
        <div className="flex justify-between gap-8">
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'arrowRotateRight',
            }}
            name="restart"
            onClick={onRestart}
          >
            Restart app now
          </ActionButton>
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'checkmark',
            }}
            name="dismiss"
            onClick={() => {
              toast.dismiss()
              onDismiss()
            }}
          >
            Got it
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
