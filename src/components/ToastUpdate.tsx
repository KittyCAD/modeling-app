import toast from 'react-hot-toast'
import { ActionButton } from './ActionButton'
import { openExternalBrowserIfDesktop } from 'lib/openWindow'
import { Marked } from '@ts-stack/markdown'

export function ToastUpdate({
  version,
  releaseNotes,
  onRestart,
}: {
  version: string
  releaseNotes: string
  onRestart: () => void
}) {
  const containsBreakingChanges = releaseNotes
    .toLocaleLowerCase()
    .includes('breaking')

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
              onClick={openExternalBrowserIfDesktop(
                `https://github.com/KittyCAD/modeling-app/releases/tag/v${version}`
              )}
              href={`https://github.com/KittyCAD/modeling-app/releases/tag/v${version}`}
              target="_blank"
              rel="noreferrer"
            >
              here on GitHub.
            </a>
          </p>
        </div>
        <details className="my-4" open={containsBreakingChanges}>
          <summary>
            Release notes
            {containsBreakingChanges && (
              <strong className="text-destroy-50"> (Breaking changes)</strong>
            )}
          </summary>
          <div
            className="parsed-markdown my-4 max-h-60 overflow-y-auto"
            dangerouslySetInnerHTML={{
              __html: Marked.parse(releaseNotes, {
                gfm: true,
                breaks: true,
                sanitize: true,
              }),
            }}
          ></div>
        </details>
        <div className="flex justify-between gap-8">
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'arrowRotateRight',
            }}
            name="Restart app now"
            onClick={onRestart}
          >
            Restart app now
          </ActionButton>
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'checkmark',
            }}
            name="Got it"
            onClick={() => {
              toast.dismiss()
            }}
          >
            Got it
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
