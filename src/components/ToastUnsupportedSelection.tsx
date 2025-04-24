import toast from 'react-hot-toast'

import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

export function ToastUnsupportedSelection({
  toastId,
}: {
  toastId: string
}) {
  const githubIssueUrl = 'https://github.com/KittyCAD/modeling-app/issues/6368'

  return (
    <div className="inset-0 z-50 grid place-content-center rounded bg-chalkboard-10 dark:bg-chalkboard-90 shadow-md p-3">
      <section>
        <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
          Some faces and edges are not currently selectable.{' '}
          <a
            href={githubIssueUrl}
            onClick={openExternalBrowserIfDesktop(githubIssueUrl)}
            className="underline"
          >
            The team is working on it
          </a>
          .
        </p>
      </section>
    </div>
  )
}

/**
 * Show a toast notification for when users try to select unsupported faces/edges
 * @example
 * // In your component or handler:
 * import { showUnsupportedSelectionToast } from '@src/components/ToastUnsupportedSelection'
 *
 * // When user tries to select an unsupported face/edge
 * showUnsupportedSelectionToast()
 */
export function showUnsupportedSelectionToast() {
  const toastId = toast.custom(
    (t) => <ToastUnsupportedSelection toastId={t.id} />,
    {
      duration: 4_000,
    }
  )

  return toastId
}
