import { type Registry, provide, slot } from 'plankton'
import {
  type ViewportNavigationService,
  viewportNavigationService,
} from '@src/registry/contracts/viewportNavigation'

export const viewportNavigationRuntimeSlot = slot([], Symbol())

type NavigationRegistry = Pick<Registry, 'replace' | 'optional'>
const pendingUpdates = new WeakMap<NavigationRegistry, Promise<unknown>>()

function enqueue<T>(registry: NavigationRegistry, update: () => Promise<T>) {
  const previous = pendingUpdates.get(registry) ?? Promise.resolve()
  const next = previous.then(update, update)
  pendingUpdates.set(
    registry,
    next.catch(() => {})
  )
  return next
}

/** Register one viewport, returning cleanup that cannot remove its replacement. */
export function registerViewportNavigation(
  registry: NavigationRegistry,
  navigation: ViewportNavigationService
) {
  return enqueue(registry, async () => {
    await registry.replace(viewportNavigationRuntimeSlot, [
      provide(viewportNavigationService, {
        recoveryHint: navigation.recoveryHint,
        isModelOutOfView: navigation.isModelOutOfView,
        recenter: async () => {
          if (registry.optional(viewportNavigationService) === registered) {
            await navigation.recenter()
          }
        },
      }),
    ])
    const registered = registry.optional(viewportNavigationService)
    return () =>
      enqueue(registry, async () => {
        if (registry.optional(viewportNavigationService) === registered) {
          await registry.replace(viewportNavigationRuntimeSlot, [])
        }
      })
  })
}
