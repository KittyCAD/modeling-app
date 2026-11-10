import { Dialog } from '@headlessui/react'
import { CustomIcon } from '@src/components/CustomIcon'
import { TelemetryExplorer } from '@src/components/TelemetryExplorer'
import { useDotDotSlash } from '@src/hooks/useDotDotSlash'
import { PATHS } from '@src/lib/paths'
import { useHotkeys } from 'react-hotkeys-hook'
// eslint-disable-next-line zds/no-react-router-hooks -- URL-state migration: modal closing derives its parent from pathname (useLocation, useNavigate).
import { useLocation, useNavigate } from 'react-router-dom'

export const Telemetry = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const close = () => {
    void navigate(location.pathname.replace(PATHS.TELEMETRY, ''))
  }
  const dotDotSlash = useDotDotSlash()
  useHotkeys('esc', () => {
    void navigate(dotDotSlash())
  })
  return (
    <Dialog
      as="div"
      open={true}
      onClose={close}
      className="fixed inset-0 z-40 overflow-y-auto p-4 grid place-items-center"
    >
      <Dialog.Overlay className="fixed inset-0 bg-chalkboard-110/30 dark:bg-chalkboard-110/50" />
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
    </Dialog>
  )
}
