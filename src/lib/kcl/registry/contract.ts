import { inputs, observe } from '@src/registry/inputs'
import type { MachineModelingHost } from '@src/lib/kcl/machine/host'
import type {
  createModelingInteractions,
  ModelingInteractionDefinition,
} from '@src/lib/kcl/interactions'
import type { ModelingInteractionViewDefinition } from '@src/lib/kcl/interactionViews'
import type { SelectionSource } from '@src/lib/kcl/selection'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import type { Signal } from '@preact/signals-core'
import { Facet, contract } from 'plankton'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ComponentType } from 'react'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclViewExecution } from '@src/lib/kcl/modeling/viewExecution'
import type { CameraShortcutHints } from '@src/lib/cameraViewCommands'
import type { AttachCameraViewport } from '@src/lib/kcl/modeling/cameraCommands'
import type { KclSession } from '@src/lib/kcl/modeling/session'
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
  viewExecution: KclViewExecution
  render: () => Promise<void>
  cameraShortcuts: ReadonlySignal<CameraShortcutHints>
  attachCameraViewport: AttachCameraViewport
  wasm: Promise<ModuleType>
  fileOperations: FileOperationsRegistryService
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
export const modelingViewContract = contract({
  modelingInteractionsFacet: new Facet<
    ModelingInteractionDefinition,
    readonly ModelingInteractionDefinition[]
  >('modeling-view.interactions', (values) => values),
  modelingInteractionViewsFacet: new Facet<
    ModelingInteractionViewDefinition,
    readonly ModelingInteractionViewDefinition[]
  >('modeling-view.interaction-views', (values) => values),
  modelingStatusItemsFacet: new Facet<
    ModelingStatusItem,
    readonly ModelingStatusItem[]
  >('modeling-view.status-items', (values) => values),
})
export const {
  modelingStatusItemsFacet,
  modelingInteractionsFacet,
  modelingInteractionViewsFacet,
} = modelingViewContract

export const observations = inputs({
  modelingInteractionViewsFacet: observe(modelingInteractionViewsFacet),
  modelingInteractionsFacet: observe(modelingInteractionsFacet),
  modelingStatusItemsFacet: observe(modelingStatusItemsFacet),
})
