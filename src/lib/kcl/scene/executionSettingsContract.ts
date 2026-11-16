import { appendValueSpec, defineService, provide } from '@kittycad/registry'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { SceneExecutionSettings } from '@src/lib/kcl/scene/executionSettings'

/**
 * A preference consumed by KCL execution. Extensions contribute these separately
 * from `Setting` definitions so KCL owns the decision to execute or clear its
 * streamed scene. `read` supplies the effective value compared between changes.
 */
export interface KclExecutionInput {
  id: string
  read: (settings: SettingsType) => unknown
  refresh: 'execute' | 'rebuild-streamed'
}

export const kclExecutionInputsValueSpec = appendValueSpec<KclExecutionInput>(
  'kcl.execution-inputs'
)
export const kclExecutionSettingsService =
  defineService<SceneExecutionSettings>('kcl.execution-settings')

export const provideKclExecutionInput = (input: KclExecutionInput) =>
  provide(kclExecutionInputsValueSpec, input, { key: input.id })
