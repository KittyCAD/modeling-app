import { Dialog } from '@headlessui/react'
import { ActionButton } from './ActionButton'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CREATE_FILE_URL_PARAM } from 'lib/constants'
import { useSettings } from 'machines/appMachine'

const DownloadAppBanner = () => {
  const [searchParams] = useSearchParams()
  const hasCreateFileParam = searchParams.has(CREATE_FILE_URL_PARAM)
  const settings = useSettings()
  const [isBannerDismissed, setIsBannerDismissed] = useState(
    settings.app.dismissWebBanner.current
  )

  return (
    <Dialog
      className="fixed inset-0 z-50 grid place-items-center"
      open={!isBannerDismissed}
      onClose={() => ({})}
    >
      <Dialog.Overlay className="fixed inset-0 bg-chalkboard-10/80 dark:bg-chalkboard-100/70" />
      <Dialog.Panel className="relative max-w-xl bg-warn-20 text-warn-80 px-8 py-4 rounded-md">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">Be warned!</h2>
          <p>
            Zoo Modeling App Desktop is more reliable! The web app is not
            officially supported.
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
          <div className="flex flex-row-reverse gap-4 justify-between mt-6">
            <ActionButton
              Element="externalLink"
              to="https://zoo.dev/modeling-app/download"
              className="group text-warn-10 dark:!text-warn-10 pr-1 border-warn-70 hover:border-warn-80 dark:!border-warn-70 dark:hover:!border-warn-80 bg-warn-70 group-hover:bg-warn-80 dark:bg-warn-70 dark:group-hover:bg-warn-80"
              iconEnd={{
                icon: 'arrowRight',
                iconClassName: 'text-warn-10 dark:text-warn-10',
                bgClassName: '!bg-transparent',
              }}
            >
              Download Desktop App
            </ActionButton>
            <ActionButton
              Element="button"
              onClick={() => setIsBannerDismissed(true)}
              className="group text-warn-80 bg-warn-10 border-warn-50 hover:border-warn-80 hover:bg-warn-10 dark:bg-warn-10 dark:!border-warn-50 dark:hover:!border-warn-80 dark:text-warn-80 dark:hover:bg-warn-10"
              iconStart={{
                icon: 'checkmark',
                iconClassName: 'text-warn-10 dark:text-warn-10',
                bgClassName:
                  'bg-warn-50 group-hover:bg-warn-80 dark:bg-warn-50 dark:group-hover:bg-warn-80',
              }}
            >
              Proceed at my own risk
            </ActionButton>
          </div>
        </div>
      </Dialog.Panel>
    </Dialog>
  )
}

export default DownloadAppBanner
