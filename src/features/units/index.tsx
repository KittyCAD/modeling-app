import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { settingsService, settingsValueSpec } from '@src/contracts/settings'
import { statusBarItemsValueSpec } from '@src/contracts/shell'
import { projectSessionService } from '@src/contracts/projectSession'
import { unitsService } from '@src/contracts/units'
import { loadKclWasm } from '@src/features/kclAnalysis/wasmModule'
import { createUnitsService } from '@src/features/units/createUnitsService'
import {
  defaultLengthUnitSetting,
  unitsSettings,
} from '@src/features/units/settings'
import { UnitsField } from '@src/features/units/UnitsField'
import { DEFAULT_LENGTH_UNIT } from '@src/lib/kcl/metaSettings'

/**
 * Units, and the file annotation that records them.
 *
 * Its own feature because three unrelated things need the answer — execution,
 * the sketch tools, and file creation — and none of them should be the one that
 * owns it. What it holds is small: one setting, one service that can write the
 * annotation, and the status bar field that shows what the executing file is
 * working in.
 */
export default defineRegistryItemFactory((ctx) => {
  const units = createUnitsService({
    /*
     * Read lazily and reactively. `optional` because a build with no settings
     * service still has a default unit — millimetres, the same answer the app
     * gives before anybody has expressed a preference.
     */
    unit: computed(
      () =>
        ctx.services.optional(settingsService)?.value(defaultLengthUnitSetting)
          .value ?? DEFAULT_LENGTH_UNIT
    ),
    wasm: loadKclWasm,
  })

  return {
    model: units,
    item: defineRuntimeRegistryItem({
      id: 'units',
      providesServices: [provideService(unitsService, units)],
      provides: [
        ...unitsSettings.map((setting) => provide(settingsValueSpec, setting)),

        /**
         * What the executing file is working in.
         *
         * In the status bar rather than the toolbar because it is a property of
         * the file rather than of the tool in hand — and it is a *button* because
         * the unit is the one file-level setting people change often enough to
         * resent going to a dialog for.
         */
        provide(statusBarItemsValueSpec, {
          id: 'units.file',
          zone: 'end',
          order: 20,
          visible: computed(
            () =>
              ctx.services.optional(projectSessionService)?.current.value !==
              null
          ),
          render: () => <UnitsField />,
        }),
      ],
    }),
  }
}, 'units')
