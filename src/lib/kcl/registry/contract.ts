import type { MachineModelingHost } from '@src/lib/kcl/machine/host'
import type {
  createModelingInteractions,
  ModelingInteractionDefinition,
} from '@src/lib/kcl/interactions'
import type { ModelingInteractionViewDefinition } from '@src/lib/kcl/interactionViews'
import type { SelectionSource } from '@src/lib/kcl/selection'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import type { Signal } from '@preact/signals-core'
import { appendValueSpec, defineContract } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ComponentType } from 'react'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclSession } from '@src/lib/kcl/session'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { createMeasurementToolService } from '@src/registry/extensions/engineScene/measurementToolService'
import type { createPhysicalAnalysisService } from '@src/registry/extensions/engineScene/physicalAnalysis/physicalAnalysisService'

/** Contributions receive their owning view explicitly; focus never changes their target. */
export interface ModelingViewContext {
  settings: SettingsRegistryService
  selection: SelectionSource
  interactions: ReturnType<typeof createModelingInteractions>
  tools: { error: Signal<Error | undefined>; close: () => void }

  executor: Executor
  session: KclSession
  wasm: Promise<ModuleType>
  fileOperations: FileOperationsRegistryService | undefined
  measurement: ReturnType<typeof createMeasurementToolService>
  physicalAnalysis: ReturnType<typeof createPhysicalAnalysisService>
  statusItems: ReadonlySignal<readonly ModelingStatusItem[]>
}
/** The factory retains the machine's mutable ownership and disposal controls. */
export interface ModelingViewRuntime extends ModelingViewContext {
  machine?: Pick<MachineModelingHost, 'owner' | 'error'>
}
export interface ModelingStatusItem {
  id: string
  side: 'start' | 'end'
  order: number
  Component: ComponentType<{ context: ModelingViewContext }>
}
export const modelingViewContract = defineContract({
  modelingInteractionsValueSpec: appendValueSpec<ModelingInteractionDefinition>(
    'modeling-view.interactions'
  ),
  modelingInteractionViewsValueSpec:
    appendValueSpec<ModelingInteractionViewDefinition>(
      'modeling-view.interaction-views'
    ),
  modelingStatusItemsValueSpec: appendValueSpec<ModelingStatusItem>(
    'modeling-view.status-items'
  ),
})
export const {
  modelingStatusItemsValueSpec,
  modelingInteractionsValueSpec,
  modelingInteractionViewsValueSpec,
} = modelingViewContract
