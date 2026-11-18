import { Facet, service, contribute, contract } from 'plankton'
import { inputs, observe, observeService } from '@src/registry/inputs'
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

export const executionSettingsContract = contract({
  kclExecutionInputsFacet: new Facet(
    'kcl.execution-inputs',
    (values: readonly KclExecutionInput[]) => values
  ),
  kclExecutionSettingsService: service<SceneExecutionSettings>(
    'kcl.execution-settings'
  ),
})
export const { kclExecutionInputsFacet, kclExecutionSettingsService } =
  executionSettingsContract
export const observations = inputs({
  kclExecutionInputsFacet: observe(kclExecutionInputsFacet),
  kclExecutionSettingsService: observeService(kclExecutionSettingsService),
})
export const provideKclExecutionInput = (input: KclExecutionInput) =>
  contribute(kclExecutionInputsFacet, () => input, { key: input.id })
