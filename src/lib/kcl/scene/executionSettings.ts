import { computed, type ReadonlySignal } from '@preact/signals-core'
import type { KclExecutionInput } from '@src/lib/kcl/scene/executionSettingsContract'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'

/**
 * The native configuration to execute with, plus keys for deciding when settings
 * require another execution. The keys compare contributed values, so replacing
 * a `Setting` instance with an equivalent one does not request execution.
 */
export interface SceneExecutionSettings {
  configuration: ReadonlySignal<ReturnType<typeof jsAppSettings>>
  executeRevision: ReadonlySignal<string>
  streamedRevision: ReadonlySignal<string>
  revision: (geometryOnly: () => boolean) => ReadonlySignal<string>
}

/**
 * Read effective preferences through `getSettings` and follow the registry's
 * contributed inputs through `declarations`. `configuration` includes all native
 * settings; only the contributed inputs determine the refresh keys.
 */
export function createSceneExecutionSettings(
  getSettings: () => SettingsType,
  declarations: ReadonlySignal<readonly KclExecutionInput[]>
): SceneExecutionSettings {
  const configuration = computed(() =>
    jsAppSettings(getSettings(), { reactive: true })
  )
  const inputs = computed(() => {
    const execute: unknown[] = []
    const streamed: unknown[] = []
    for (const input of declarations.value) {
      const value = [input.id, input.read(getSettings())]
      if (input.refresh === 'execute') execute.push(value)
      else streamed.push(value)
    }
    return {
      execute: JSON.stringify(execute),
      streamed: JSON.stringify(streamed),
    }
  })
  const executeRevision = computed(() => inputs.value.execute)
  const streamedRevision = computed(() => inputs.value.streamed)
  return {
    configuration,
    executeRevision,
    streamedRevision,
    revision: (geometryOnly: () => boolean) =>
      computed(() =>
        JSON.stringify([
          executeRevision.value,
          geometryOnly() ? null : streamedRevision.value,
        ])
      ),
  }
}
