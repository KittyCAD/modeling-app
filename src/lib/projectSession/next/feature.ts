import type { Feature } from '@kittycad/lib'
import {
  defineRegistryItemFactory,
  Slot,
  type RegistryItem,
} from '@kittycad/registry'
import { effect, untracked } from '@preact/signals-core'
import type { UserFeaturesService } from '@src/machines/userFeaturesMachine'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { reportRejection } from '@src/lib/trap'

// Added by API #5136; the bundled SDK's Feature union has not caught up yet.
export const PROJECT_SHELL_FEATURE = 'zds_project_shell_refactor' as Feature

export function hasProjectShellFeature(
  features: UserFeaturesService | undefined
): boolean {
  return features?.has(PROJECT_SHELL_FEATURE, false) ?? false
}

/** Install a subtree only while the default-off project-shell flag is granted. */
export function withProjectShellFeature(
  item: RegistryItem,
  id: string
): RegistryItem {
  const slot = new Slot()
  return defineRegistryItemFactory(({ container, services }) => {
    let disposed = false
    let active = false
    let stop: (() => void) | undefined
    // Service resolution is forbidden during graph construction. Start observing
    // after configure completes, then apply grants/revocations synchronously.
    void Promise.resolve()
      .then(() => {
        if (disposed) return
        stop = effect(() => {
          const enabled = hasProjectShellFeature(
            services.signal(userFeaturesService).value
          )
          if (active === enabled) return
          active = enabled
          void untracked(() =>
            container.reconfigureAsync(slot, enabled ? [item] : [])
          ).catch(reportRejection)
        })
      })
      .catch(reportRejection)
    return {
      uses: [slot.of()],
      dispose: () => {
        disposed = true
        stop?.()
      },
    }
  }, `${id}.feature-gate`)
}
