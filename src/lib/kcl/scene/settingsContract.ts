import { appendValueSpec, defineService, provide } from '@kittycad/registry'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { SceneExecutionSettings } from '@src/lib/kcl/scene/settings'

/** A contributed value whose changes invalidate KCL execution, independently of its setting definition. */
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
