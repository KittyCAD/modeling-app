import toast from 'react-hot-toast'
import { ActionButton } from './ActionButton'

export function ToastUpdate({
  version,
  onRestart,
}: {
  version: string
  onRestart: () => void
}) {
  return (
    <div className="inset-0 z-50 grid place-content-center rounded bg-chalkboard-110/50 shadow-md">
      <div className="max-w-3xl min-w-[35rem] p-8 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
        <div className="my-4 flex items-baseline">
          <span
            className="px-3 py-1 text-xl rounded-full bg-energy-10 text-energy-80"
            data-testid="update-version"
          >
            v{version}
          </span>
          <span className="ml-4 text-md text-bold">
            A new update has downloaded and will be available next time you
            start the app
          </span>
        </div>
        <div className="flex justify-between gap-8">
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'arrowRotateRight',
            }}
            name="Restart app now"
            onClick={() => {
              onRestart()
            }}
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
