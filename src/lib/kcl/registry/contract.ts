import { inputs, observe } from '@src/registry/inputs'
import { Facet, contract } from 'plankton'
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
export const modelingViewContract = contract({
  modelingStatusItemsFacet: new Facet<
    ModelingStatusItem,
    readonly ModelingStatusItem[]
  >('modeling-view.status-items', (values) => values),
})
export const { modelingStatusItemsFacet } = modelingViewContract

export const observations = inputs({
  modelingStatusItemsFacet: observe(modelingStatusItemsFacet),
})
