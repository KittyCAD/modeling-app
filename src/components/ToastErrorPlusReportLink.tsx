import toast from 'react-hot-toast'

import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { generateToUrl } from '@src/components/ErrorPage'

export function ToastErrorPlusReportLink({
  message,
  url,
}: {
  message: string
  url: string
}) {
  return (
    <div className="inset-0 z-50 grid place-content-center rounded bg-chalkboard-10 dark:bg-chalkboard-90 shadow-md p-3">
      <section>
        <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
          {message}{' '}
          <a
            href={url}
            onClick={openExternalBrowserIfDesktop(url)}
            className="underline"
          >
            Click here to report!
          </a>
          .
        </p>
      </section>
    </div>
  )
}

export function showErrorToastPlusReportLink(
  message: string,
  error: unknown,
  title?: string
) {
  const url = generateToUrl(error, title)
  const toastId = toast.custom(
    (_) => <ToastErrorPlusReportLink message={message} url={url} />,
    {
      duration: 4_000,
    }
  )

  return toastId
}
