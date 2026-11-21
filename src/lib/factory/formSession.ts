import { signal } from '@preact/signals-core'
import type { FactoryShippingForm } from '@src/lib/factory/api'
import type {
  FactoryDelivery,
  FactoryPart,
  FactorySnapshot,
  FactoryWorkspace,
} from '@src/lib/factory/jobs'
import type { FactoryFormContext } from '@src/lib/factory/types'

/** One form attempt retains its captured bytes and delivery across rejected jobs. */
export function createFactoryFormSession(workspace: FactoryWorkspace) {
  const pending = signal(false)
  const error = signal('')
  const snapshotCaptured = signal(false)
  let snapshot: FactorySnapshot | undefined
  let delivery: { key: string; value: FactoryDelivery } | undefined
  return {
    pending,
    error,
    snapshotCaptured,
    submit: async (
      context: FactoryFormContext,
      parts: readonly FactoryPart[],
      shipping: FactoryShippingForm,
      isActive: () => boolean
    ): Promise<readonly FactoryPart[] | undefined> => {
      const isCurrent = () => isActive() && context.isCurrent()
      if (
        pending.peek() ||
        workspace.pending.peek() ||
        workspace.uncertain.peek() ||
        !isCurrent()
      )
        return
      pending.value = true
      error.value = ''
      try {
        const captured = snapshot ?? (await context.capture(isCurrent))
        if (!isCurrent()) return
        if (
          parts.some(
            (part) =>
              !captured.files.some(
                (file) => file.relativePath === part.entrypoint
              )
          )
        ) {
          error.value =
            'A selected part file is missing from the project snapshot. Review your selection.'
          return undefined
        }
        snapshot = captured
        snapshotCaptured.value = true
        const key = JSON.stringify(shipping)
        const shared =
          delivery?.key === key
            ? delivery.value
            : await context.saveDelivery(shipping)
        if (!isCurrent()) return
        delivery = { key, value: shared }
        const completed = await workspace.submit(
          parts,
          captured,
          shared,
          context.requests
        )
        if (!isCurrent()) return
        const remaining = parts.filter(
          (part) => !completed.includes(part.entrypoint)
        )
        if (!remaining.length) {
          snapshot = undefined
          snapshotCaptured.value = false
          delivery = undefined
        }
        return remaining
      } catch (cause) {
        if (isCurrent())
          error.value =
            cause instanceof Error
              ? cause.message
              : 'The project could not be submitted.'
        return undefined
      } finally {
        pending.value = false
      }
    },
  }
}
