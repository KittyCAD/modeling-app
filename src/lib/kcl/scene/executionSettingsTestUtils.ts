import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { createSceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import { kclExecutionInputsValueSpec } from '@src/lib/kcl/scene/executionSettingsContract'
import { coreKclExecutionInputs } from '@src/lib/kcl/scene/executionSettingsRegistry'
import type { SettingsType } from '@src/lib/settings/initialSettings'

/**
 * Use the real core KCL input declarations in scene tests without app services.
 * Copy them into a standalone signal before disposing this temporary registry;
 * these fixtures track setting values, but not registry reconfiguration.
 */
export function createTestKclExecutionSettings(
  getSettings: () => SettingsType
) {
  const registry = new Registry()
  registry.configure([coreKclExecutionInputs])
  const inputs = signal(registry.get(kclExecutionInputsValueSpec))
  registry[Symbol.dispose]()
  return createSceneExecutionSettings(getSettings, inputs)
}
