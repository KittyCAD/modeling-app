import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { kclContextService } from '@src/contracts/kclContext'
import { kclFrontendService } from '@src/contracts/kclFrontend'
import { settingsService } from '@src/contracts/settings'
import { createKclFrontend } from '@src/features/kclFrontend/createKclFrontend'
import { executorSettingsJson } from '@src/features/kclExecution/executorSettings'
import {
  enableSsaoSetting,
  highlightEdgesSetting,
  showScaleGridSetting,
} from '@src/features/engineScene/settings'
import { defaultLengthUnitSetting } from '@src/features/units/settings'

/**
 * KCL's sketch frontend.
 *
 * Its own feature rather than part of the executor, because the two do opposite
 * things with the same object: the executor runs a program *against the engine*,
 * and this runs a sketch block while forbidden to contact one. Sharing the
 * context is not a shortcut — they share a program and a cache, and two contexts
 * would mean two ideas of what the file says.
 *
 * Everything that calls the frontend goes through this service, which is what
 * would let the executor move onto the same API later without any consumer
 * noticing.
 */
export default defineRegistryItemFactory((ctx) => {
  const frontend = createKclFrontend({
    /*
     * Optional, and null rather than throwing: the frontend cannot answer before
     * something has executed, because a sketch is solved against object ids a
     * real run produced. "Not yet" is a state, not a failure.
     */
    context: () => ctx.services.optional(kclContextService)?.get() ?? null,

    settings: (defaults) => {
      const resolved = ctx.services.get(settingsService)
      return executorSettingsJson(defaults, {
        highlightEdges: resolved.read(highlightEdgesSetting),
        enableSsao: resolved.read(enableSsaoSetting),
        showScaleGrid: resolved.read(showScaleGridSetting),
        baseUnit: resolved.read(defaultLengthUnitSetting),
      })
    },
  })

  return {
    model: frontend,
    item: defineRuntimeRegistryItem({
      id: 'kclFrontend',
      providesServices: [provideService(kclFrontendService, frontend)],
    }),
  }
}, 'kclFrontend')
