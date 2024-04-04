import { Dialog } from '@headlessui/react'
import { useStore } from '../useStore'
import { ActionButton } from './ActionButton'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useState } from 'react'

const DownloadAppBanner = () => {
  const { settings } = useSettingsAuthContext()
  const [isBannerDismissed, setIsBannerDismissed] = useState(
    settings.context.app.dismissWebBanner.current
  )

  return (
    <Dialog
      className="fixed inset-0 z-50"
      open={!isBannerDismissed}
      onClose={() => ({})}
    >
      <Dialog.Overlay className="fixed inset-0 bg-chalkboard-100/50" />
      <Dialog.Panel className="absolute inset-0 top-auto bg-warn-20 text-warn-80 px-8 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-2 justify-between items-start">
            <h2 className="text-xl font-bold mb-4">
              Modeling App is better as a desktop app!
            </h2>
            <ActionButton
              Element="button"
              onClick={() => setIsBannerDismissed(true)}
              icon={{
                icon: 'close',
                className: 'p-1',
                bgClassName:
                  'bg-warn-70 hover:bg-warn-80 dark:bg-warn-70 dark:hover:bg-warn-80',
                iconClassName:
                  'text-warn-10 group-hover:text-warn-10 dark:text-warn-10 dark:group-hover:text-warn-10',
              }}
              className="!p-0 !bg-transparent !border-transparent"
            />
          </div>
          <p>
            The browser version of the app only saves your data temporarily in{' '}
            <code className="text-base inline-block px-0.5 bg-warn-30/50 rounded">
              localStorage
            </code>
            , and isn't backed up anywhere! Visit{' '}
            <a
              href="https://zoo.dev/modeling-app/download"
              rel="noopener noreferrer"
              target="_blank"
              className="!text-warn-80 dark:!text-warn-80 dark:hover:!text-warn-70 underline"
            >
              our website
            </a>{' '}
            to download the app for the best experience.
          </p>
          <p className="mt-6">
            If you're on Linux and the browser is your only way to use the app,
            you can permanently dismiss this banner by{' '}
            <a
              onClick={() => {
                setIsBannerDismissed(true)
                settings.send({
                  type: 'set.app.dismissWebBanner',
                  data: { level: 'user', value: true },
                })
              }}
              href="/"
              className="!text-warn-80 dark:!text-warn-80 dark:hover:!text-warn-70 underline"
            >
              toggling the App &gt; Dismiss Web Banner setting
            </a>
            .
          </p>
        </div>
      </Dialog.Panel>
    </Dialog>
  )
}

export default DownloadAppBanner
