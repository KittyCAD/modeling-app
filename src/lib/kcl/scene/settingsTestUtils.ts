import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { createSceneExecutionSettings } from '@src/lib/kcl/scene/settings'
import { kclExecutionInputsValueSpec } from '@src/lib/kcl/scene/settingsContract'
import { coreKclExecutionInputs } from '@src/lib/kcl/scene/settingsRegistry'
import type { SettingsType } from '@src/lib/settings/initialSettings'

/** Resolve the production core declarations for isolated scene fixtures without constructing app services. */
export function createTestKclExecutionSettings(
  getSettings: () => SettingsType
) {
  const registry = new Registry()
  registry.configure([coreKclExecutionInputs])
  const inputs = signal(registry.get(kclExecutionInputsValueSpec))
  registry[Symbol.dispose]()
  return createSceneExecutionSettings(getSettings, inputs)
}
