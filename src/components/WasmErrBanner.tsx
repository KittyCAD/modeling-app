import { Dialog } from '@headlessui/react'
import { useKclContext } from 'lang/KclProvider'
import { useState } from 'react'

import { ActionButton } from './ActionButton'

export function WasmErrBanner() {
  const [isBannerDismissed, setBannerDismissed] = useState(false)

  const { wasmInitFailed } = useKclContext()

  if (!wasmInitFailed) return null

  return (
    <Dialog
      className="fixed inset-0 top-auto z-50 bg-warn-20 text-warn-80 px-8 py-4"
      open={!isBannerDismissed}
      onClose={() => ({})}
    >
      <Dialog.Panel className="max-w-3xl mx-auto">
        <div className="flex gap-2 justify-between items-start">
          <h2 className="text-xl font-bold mb-4">
            Problem with our WASM blob :(
          </h2>
          <ActionButton
            Element="button"
            onClick={() => setBannerDismissed(true)}
            iconStart={{
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
          <a
            href="https://webassembly.org/"
            rel="noopener noreferrer"
            target="_blank"
            className="text-warn-80 dark:text-warn-80 dark:hover:text-warn-70 underline"
          >
            WASM or web assembly
          </a>{' '}
          is core part of how our app works. It might because you OS is not
          up-to-date. If you're able to update your OS to a later version, try
          that. If not create an issue on{' '}
          <a
            href="https://github.com/KittyCAD/modeling-app"
            rel="noopener noreferrer"
            target="_blank"
            className="text-warn-80 dark:text-warn-80 dark:hover:text-warn-70 underline"
          >
            our Github
          </a>
          .
        </p>
      </Dialog.Panel>
    </Dialog>
  )
}
