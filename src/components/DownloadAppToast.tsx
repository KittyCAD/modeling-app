import { ActionButton } from '@src/components/ActionButton'
import { Logo } from '@src/components/Logo'

export type DownloadAppToastProps = {
  onAccept: () => void
  onDismiss: () => void
}

export function DownloadAppToast({
  onAccept,
  onDismiss,
}: DownloadAppToastProps) {
  return (
    <div
      data-testid="download-app-toast"
      className="flex items-center gap-6 min-w-md"
    >
      <Logo className="w-auto h-8 flex-none" />
      <div className="flex flex-col justify-between gap-6 min-w-80">
        <section>
          <h2>Zoo Design Studio is primarily a desktop app</h2>
          <p className="text-sm text-chalkboard-70 dark:text-chalkboard-30">
            The present web app is limited in features. We don't want you to
            miss out!
          </p>
          {!navigator?.userAgent.includes('Chrome') && (
            <p className="mt-6">
              If you want to stay here on the web-app, we currently only support
              Chrome. Please use{' '}
              <a
                href="https://www.google.com/chrome/"
                rel="noopener noreferrer"
                target="_blank"
                className="!text-warn-80 dark:!text-warn-80 dark:hover:!text-warn-70 underline"
              >
                this link
              </a>{' '}
              to download it.
            </p>
          )}
        </section>
        <div className="flex justify-between gap-8">
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'close',
            }}
            data-negative-button="dismiss"
            name="dismiss"
            onClick={onDismiss}
          >
            Not right now
          </ActionButton>
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'download',
            }}
            name="accept"
            onClick={onAccept}
          >
            Download the app
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
