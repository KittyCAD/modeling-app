import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provideService,
} from '@kittycad/registry'
import { createSceneExecutionSettings } from '@src/lib/kcl/scene/settings'
import {
  kclExecutionInputsValueSpec,
  kclExecutionSettingsService,
  provideKclExecutionInput,
} from '@src/lib/kcl/scene/settingsContract'
import { settingsService } from '@src/registry/contracts/settings'

/** KCL's policy for existing modeling preferences; other consumers can react to the same preferences differently. */
export const coreKclExecutionInputs = defineRegistryItem({
  id: 'kcl.execution-inputs.core',
  provides: [
    provideKclExecutionInput({
      id: 'modeling.defaultUnit',
      read: (s) => s.modeling.defaultUnit.currentSignal.value,
      refresh: 'execute',
    }),
    provideKclExecutionInput({
      id: 'modeling.highlightEdges',
      read: (s) => s.modeling.highlightEdges.currentSignal.value,
      refresh: 'execute',
    }),
    provideKclExecutionInput({
      id: 'modeling.showScaleGrid',
      read: (s) => s.modeling.showScaleGrid.currentSignal.value,
      refresh: 'execute',
    }),
    provideKclExecutionInput({
      id: 'modeling.fixedSizeGrid',
      read: (s) => s.modeling.fixedSizeGrid.currentSignal.value,
      refresh: 'execute',
    }),
    provideKclExecutionInput({
      id: 'modeling.backfaceColor',
      read: (s) => s.modeling.backfaceColor.currentSignal.value,
      refresh: 'rebuild-streamed',
    }),
  ],
})
const executionSettings = defineRegistryItemFactory(
  ({ services, valueSpecs }) => ({
    providesServices: [
      provideService(
        kclExecutionSettingsService,
        createSceneExecutionSettings(
          () => services.get(settingsService).current.value,
          valueSpecs.signal(kclExecutionInputsValueSpec)
        )
      ),
    ],
  }),
  'kcl.execution-settings'
)

export const kclExecutionSettingsRegistryItem = defineRegistryItem({
  id: 'kcl.execution-settings.registry',
  uses: [coreKclExecutionInputs, executionSettings],
})
