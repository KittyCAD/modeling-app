import { effect, signal } from '@preact/signals-core'
import type {
  MachineModelingHost,
  MachineModelingOwner,
} from '@src/lib/kcl/machine/host'
import { isErr } from '@src/lib/trap'

/** Acquire the legacy graph after registry discovery; a closed view still awaits and disposes any pending acquisition. */
export function deferMachineHost(load: () => Promise<MachineModelingHost>) {
  const owner = signal<MachineModelingOwner | undefined>(undefined)
  const error = signal<Error | undefined>(undefined)
  let disposed = false
  let host: MachineModelingHost | undefined
  let stop: (() => void) | undefined
  let closing: Promise<void> | undefined
  const ready = Promise.resolve()
    .then(async () => {
      if (disposed) return
      const acquired = await load()
      host = acquired
      if (disposed) return
      stop = effect(() => {
        owner.value = acquired.owner.value
        error.value = acquired.error.value
      })
    })
    .catch((cause) => {
      if (!disposed)
        error.value = isErr(cause) ? cause : new Error(String(cause))
    })
  return {
    owner,
    error,
    use: async (
      action: (host: MachineModelingHost) => void | Promise<void>
    ) => {
      await ready
      if (!disposed && host) await action(host)
    },
    dispose: () => {
      if (closing) return closing
      disposed = true
      stop?.()
      owner.value = undefined
      closing = ready.then(async () => {
        try {
          await host?.dispose()
        } finally {
          host = undefined
        }
      })
      return closing
    },
  }
}
