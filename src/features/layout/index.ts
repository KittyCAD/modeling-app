import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import {
  layoutAreasValueSpec,
  layoutPresetsValueSpec,
  layoutService,
} from '@src/contracts/layout'
import { createLayoutService } from '@src/features/layout/createLayoutService'

/**
 * Owns the arrangement of the main area.
 *
 * Areas and presets are both contributions, so this feature knows nothing about
 * files, geometry, or logs — it only knows how to arrange whatever it is given.
 */
export default defineRegistryItemFactory((ctx) => {
  const areas = computed(() => ctx.valueSpecs.get(layoutAreasValueSpec))
  const presets = computed(() => ctx.valueSpecs.get(layoutPresetsValueSpec))

  const service = createLayoutService(areas, presets)

  // Sizes change on every drag frame. Persisting on the way out rather than on
  // every change keeps a resize from touching storage sixty times a second.
  const onPageHide = () => service.dispose()
  window.addEventListener('pagehide', onPageHide)

  return {
    model: service,
    item: defineRuntimeRegistryItem({
      id: 'layout',
      dispose: () => {
        window.removeEventListener('pagehide', onPageHide)
        service.dispose()
      },
      providesServices: [provideService(layoutService, service)],
      provides: [
        provide(commandsValueSpec, {
          id: 'layout.reset',
          title: 'Reset panel layout',
          category: 'View',
          icon: 'grid',
          enabled: computed(() => service.root.value !== null),
          run: () => service.reset(),
        }),
      ],
    }),
  }
}, 'layout')
