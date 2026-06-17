import { signal } from '@preact/signals-core'

export type ToolbarToast = {
  id: string
  message: string
}

type ToolbarToastOptions = {
  id?: string
  duration?: number
}

type ToastToolbar = {
  (message: string, options?: ToolbarToastOptions): string
  dismiss: (id?: string) => void
}

export const toolbarToastsSignal = signal<ToolbarToast[]>([])

const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>()
let nextToolbarToastId = 0

export const toastToolbar: ToastToolbar = Object.assign(
  (message: string, options: ToolbarToastOptions = {}) => {
    const id = options.id ?? `toolbar-toast-${++nextToolbarToastId}`
    const duration = options.duration ?? 4000

    clearDismissTimer(id)

    toolbarToastsSignal.value = [
      { id, message },
      ...toolbarToastsSignal.value.filter((toast) => toast.id !== id),
    ]

    if (Number.isFinite(duration)) {
      dismissTimers.set(
        id,
        setTimeout(() => dismissToolbarToast(id), duration)
      )
    }

    return id
  },
  {
    dismiss: dismissToolbarToast,
  }
)

function dismissToolbarToast(id?: string) {
  if (id === undefined) {
    for (const toastId of dismissTimers.keys()) {
      clearDismissTimer(toastId)
    }
    toolbarToastsSignal.value = []
    return
  }

  clearDismissTimer(id)
  toolbarToastsSignal.value = toolbarToastsSignal.value.filter(
    (toast) => toast.id !== id
  )
}

function clearDismissTimer(id: string) {
  const timer = dismissTimers.get(id)
  if (!timer) {
    return
  }

  clearTimeout(timer)
  dismissTimers.delete(id)
}
