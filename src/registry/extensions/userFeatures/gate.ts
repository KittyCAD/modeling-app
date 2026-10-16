import {
  defineRegistryItemFactory,
  Slot,
  type RegistryItem,
} from '@kittycad/registry'
import { effect } from '@preact/signals-core'
import type { UserFeature } from '@src/machines/userFeaturesMachine'
import { reportRejection } from '@src/lib/trap'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'

/** A default-off feature owns its whole registry subtree, including commands and services. */
export function gateUserFeature(
  id: string,
  feature: UserFeature,
  items: readonly RegistryItem[]
) {
  return defineRegistryItemFactory((ctx) => {
    const slot = new Slot()
    const features = ctx.services.signal(userFeaturesService)
    let active = false
    let requested = false
    let pending = false
    let disposed = false
    let stop: (() => void) | undefined
    // Services become readable after the registry finishes building its graph.
    queueMicrotask(() => {
      if (disposed) return
      stop = effect(() => {
        requested = features.value?.has(feature, false) ?? false
        if (pending || requested === active) return
        pending = true
        // Registry graph construction and signal evaluation must finish before reconfiguration.
        queueMicrotask(() => {
          pending = false
          if (disposed || requested === active) return
          active = requested
          ctx.container
            .reconfigureAsync(slot, active ? items : [])
            .catch(reportRejection)
        })
      })
    })
    return {
      id: `user-feature:${id}`,
      uses: [slot.of()],
      dispose: () => {
        disposed = true
        stop?.()
      },
    }
  }, `user-feature:${id}`)
}
