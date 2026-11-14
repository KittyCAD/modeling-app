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
  executor: Executor
  session: KclSession
  wasm: Promise<ModuleType>
  fileOperations: FileOperationsRegistryService | undefined
  measurement: ReturnType<typeof createMeasurementToolService>
  physicalAnalysis: ReturnType<typeof createPhysicalAnalysisService>
  statusItems: ReadonlySignal<readonly ModelingStatusItem[]>
}
export interface ModelingStatusItem {
  id: string
  side: 'start' | 'end'
  order: number
  Component: ComponentType<{ context: ModelingViewContext }>
}
export const modelingViewContract = defineContract({
  modelingStatusItemsValueSpec: appendValueSpec<ModelingStatusItem>(
    'modeling-view.status-items'
  ),
})
export const { modelingStatusItemsValueSpec } = modelingViewContract
