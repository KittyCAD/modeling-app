import { signal } from '@preact/signals-core'
import { createSceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'
import { coreKclExecutionInputDefinitions } from '@src/lib/kcl/scene/executionSettingsRegistry'
import type { SettingsType } from '@src/lib/settings/initialSettings'

/** Use the core KCL input policy without app services; fixtures track values, not contribution replacement. */
export function createTestKclExecutionSettings(
  getSettings: () => SettingsType
) {
  return createSceneExecutionSettings(
    getSettings,
    signal(coreKclExecutionInputDefinitions)
  )
}
