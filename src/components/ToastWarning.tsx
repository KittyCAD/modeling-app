import toast from 'react-hot-toast'

import { ActionButton } from '@src/components/ActionButton'

export function ToastWarning({
  toastId,
  title,
  message,
  onDismiss,
}: {
  toastId: string
  title?: string
  message: string
  onDismiss?: () => void
}) {
  return (
    <div className="inset-0 z-50 grid place-content-center rounded bg-chalkboard-110/50 shadow-md">
      <div className="max-w-3xl min-w-[20rem] px-4 py-3 rounded bg-chalkboard-10 dark:bg-chalkboard-90">
        {title && (
          <h2 className="text-base font-semibold text-destroy-80 mb-1">
            {title}
          </h2>
        )}
        <p className="text-sm text-chalkboard-80 dark:text-chalkboard-30">
          {message}
        </p>
        <div className="mt-2 flex justify-end">
          <ActionButton
            Element="button"
            iconStart={{
              icon: 'close',
            }}
            name="dismiss"
            onClick={() => {
              toast.dismiss(toastId)
              onDismiss?.()
            }}
          >
            Dismiss
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

/**
 * Show a warning toast notification with a dismiss button
 * @param message - The message to display
 * @param options - Optional configuration
 * @param options.title - Optional title for the warning
 * @param options.duration - Duration in ms before auto-dismiss (default: Infinity)
 * @param options.id - Optional toast ID for deduplication
 * @param options.onDismiss - Optional callback when dismissed
 * @returns The toast ID
 *
 * @example
 * showWarningToast('Something went wrong', { title: 'Warning' })
 * showWarningToast('File not supported', { duration: 5000 })
 */
export function showWarningToast(
  message: string,
  options?: {
    title?: string
    duration?: number
    id?: string
    onDismiss?: () => void
  }
) {
  const toastId = toast.custom(
    (t) => (
      <ToastWarning
        toastId={t.id}
        title={options?.title}
        message={message}
        onDismiss={options?.onDismiss}
      />
    ),
    {
      duration: options?.duration ?? Infinity,
      id: options?.id,
    }
  )

  return toastId
}
