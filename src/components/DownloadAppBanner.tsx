import { Dialog } from '@headlessui/react'
import { useStore } from '../useStore'
import { ActionButton } from './ActionButton'
import { faX } from '@fortawesome/free-solid-svg-icons'

const DownloadAppBanner = () => {
  const { isBannerDismissed, setBannerDismissed } = useStore((s) => ({
    isBannerDismissed: s.isBannerDismissed,
    setBannerDismissed: s.setBannerDismissed,
  }))

  return (
    <Dialog
      className="fixed inset-0 top-auto z-50 bg-warn-20 text-warn-80 px-8 py-4"
      open={!isBannerDismissed}
      onClose={() => ({})}
    >
      <Dialog.Panel className="max-w-3xl mx-auto">
        <div className="flex gap-2 justify-between items-start">
          <h2 className="text-xl font-bold mb-4">
            KittyCAD Modeling App is better as a desktop app!
          </h2>
          <ActionButton
            Element="button"
            onClick={() => setBannerDismissed(true)}
            icon={{
              icon: faX,
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
            href="https://kittycad.io/modeling-app/download"
            rel="noopener noreferrer"
            target="_blank"
            className="text-warn-80 dark:text-warn-80 dark:hover:text-warn-70 underline"
          >
            our website
          </a>{' '}
          to download the app for the best experience.
        </p>
      </Dialog.Panel>
    </Dialog>
  )
}

export default DownloadAppBanner
