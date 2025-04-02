import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useLocation, useNavigate } from 'react-router-dom'

import { CustomIcon } from '@src/components/CustomIcon'
import { TelemetryExplorer } from '@src/components/TelemetryExplorer'
import { useDotDotSlash } from '@src/hooks/useDotDotSlash'
import { PATHS } from '@src/lib/paths'

export const Telemetry = () => {
  const navigate = useNavigate()
  const close = () => navigate(location.pathname.replace(PATHS.TELEMETRY, ''))
  const location = useLocation()
  const dotDotSlash = useDotDotSlash()
  useHotkeys('esc', () => navigate(dotDotSlash()))
  return (
    <Transition appear show={true} as={Fragment}>
      <Dialog
        as="div"
        open={true}
        onClose={close}
        className="fixed inset-0 z-40 overflow-y-auto p-4 grid place-items-center"
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-75"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Dialog.Overlay className="fixed inset-0 bg-chalkboard-110/30 dark:bg-chalkboard-110/50" />
        </Transition.Child>

        <Transition.Child
          as={Fragment}
          enter="ease-out duration-75"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <Dialog.Panel className="rounded relative mx-auto bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 max-w-3xl w-full max-h-[66vh] shadow-lg flex flex-col gap-8">
            <div className="p-5 pb-0 flex justify-between items-center">
              <h1 className="text-2xl font-bold">Telemetry</h1>
              <div className="flex gap-4 items-start">
                <button
                  onClick={close}
                  className="p-0 m-0 focus:ring-0 focus:outline-none border-none hover:bg-destroy-10 focus:bg-destroy-10 dark:hover:bg-destroy-80/50 dark:focus:bg-destroy-80/50"
                  data-testid="settings-close-button"
                >
                  <CustomIcon name="close" className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div
              className="flex-1 grid items-stretch pl-4 pr-5 pb-5 gap-2 overflow-scroll"
              style={{
                gridTemplateColumns: 'auto 1fr',
                gridTemplateRows: '1fr',
              }}
            >
              <TelemetryExplorer />
            </div>
          </Dialog.Panel>
        </Transition.Child>
      </Dialog>
    </Transition>
  )
}
