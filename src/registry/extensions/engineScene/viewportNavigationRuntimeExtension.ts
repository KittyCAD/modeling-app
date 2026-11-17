import {
  type RegistryLike,
  Slot,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import {
  type ViewportNavigationService,
  viewportNavigationService,
} from '@src/registry/contracts/viewportNavigation'

export const viewportNavigationRuntimeSlot = new Slot()

/** Register one viewport, returning cleanup that cannot remove its replacement. */
export function registerViewportNavigation(
  registry: Pick<RegistryLike, 'reconfigure' | 'get' | 'optional'>,
  navigation: ViewportNavigationService
) {
  registry.reconfigure(viewportNavigationRuntimeSlot, [
    defineRegistryItem({
      id: 'engine-scene.viewport-navigation',
      providesServices: [
        provideService(viewportNavigationService, {
          isModelOutOfView: navigation.isModelOutOfView,
          recenter: async () => {
            if (registry.optional(viewportNavigationService) === registered) {
              await navigation.recenter()
            }
          },
        }),
      ],
    }),
  ])
  const registered = registry.get(viewportNavigationService)
  return () => {
    if (registry.optional(viewportNavigationService) === registered) {
      registry.reconfigure(viewportNavigationRuntimeSlot, [])
    }
  }
}
