import { factory, provide } from 'plankton'
import { observe } from '@src/registry/inputs'
import { observations as settingsObservations } from '@src/registry/contracts/settings'
import { createSceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import {
  kclExecutionInputsFacet,
  kclExecutionSettingsService,
  provideKclExecutionInput,
  type KclExecutionInput,
} from '@src/lib/kcl/scene/executionSettingsContract'

/**
 * The preferences that require KCL to execute again. Backface color additionally
 * requires clearing the streamed scene; local rendering applies it directly.
 */
export const coreKclExecutionInputDefinitions: readonly KclExecutionInput[] = [
  {
    id: 'modeling.defaultUnit',
    read: (s) => s.modeling.defaultUnit.currentSignal.value,
    refresh: 'execute',
  },
  {
    id: 'modeling.highlightEdges',
    read: (s) => s.modeling.highlightEdges.currentSignal.value,
    refresh: 'execute',
  },
  {
    id: 'modeling.showScaleGrid',
    read: (s) => s.modeling.showScaleGrid.currentSignal.value,
    refresh: 'execute',
  },
  {
    id: 'modeling.fixedSizeGrid',
    read: (s) => s.modeling.fixedSizeGrid.currentSignal.value,
    refresh: 'execute',
  },
  {
    id: 'modeling.backfaceColor',
    read: (s) => s.modeling.backfaceColor.currentSignal.value,
    refresh: 'rebuild-streamed',
  },
]
export const coreKclExecutionInputs = coreKclExecutionInputDefinitions.map(
  provideKclExecutionInput
)
export const kclExecutionSettingsFactory = factory({
  key: 'kcl.execution-settings',
  dependencies: {
    settings: settingsObservations,
    inputs: observe(kclExecutionInputsFacet),
  },
  create: ({ settings, inputs }) => {
    const execution = createSceneExecutionSettings(
      () => settings.settingsService.required().current.value,
      inputs
    )
    return {
      exports: execution,
      items: [provide(kclExecutionSettingsService, execution)],
    }
  },
})
export const kclExecutionSettingsExtension = [
  coreKclExecutionInputs,
  kclExecutionSettingsFactory,
]
