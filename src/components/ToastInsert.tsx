import toast from 'react-hot-toast'

import { ActionButton } from '@src/components/ActionButton'

export function ToastInsert({ onInsert }: { onInsert: () => void }) {
  return (
    <div className="inset-0 z-50 grid place-content-center rounded bg-chalkboard-110/50 shadow-md">
      <div className="max-w-3xl min-w-[35rem] p-8 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
        <p className="text-md">
          Non-KCL files aren't editable here in Zoo Studio, but you may insert
          them using the button below or the Insert command.
        </p>
        <div className="mt-4 flex justify-between gap-8">
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'checkmark',
            }}
            name="instert"
            onClick={onInsert}
          >
            Insert into my current file
          </ActionButton>
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'close',
            }}
            name="dismiss"
            onClick={() => {
              toast.dismiss()
            }}
          >
            Dismiss
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
