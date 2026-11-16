import type { ContextualCommandsService } from '@src/lib/commands/contextual'
import type { MachineModelingHost } from '@src/lib/kcl/machine/host'
import type { ModelingInteractionViewDefinition } from '@src/lib/kcl/interactionViews'
import type { Signal } from '@preact/signals-core'
import type { KclSceneResource } from '@src/lib/kcl/scene'
import type { SelectionSource } from '@src/lib/kcl/selection'
import type {
  createModelingInteractions,
  ModelingInteractionDefinition,
  ModelingInteractionSession,
} from '@src/lib/kcl/interactions'
import type { createModelingTools } from '@src/lib/kcl/modelingTools'
import type { ModelingToolDefinition } from '@src/lib/kcl/modelingTools'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { appendValueSpec, defineContract } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ComponentType } from 'react'
import type { Executor } from '@src/lib/executors/registry/contract'
import type { KclSession } from '@src/lib/kcl/session'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { createMeasurementToolService } from '@src/registry/extensions/engineScene/measurementToolService'
import type { createPhysicalAnalysisService } from '@src/registry/extensions/engineScene/physicalAnalysis/physicalAnalysisService'

type Observed<T> = {
  readonly [K in keyof T]: T[K] extends Signal<infer V>
    ? ReadonlySignal<V>
    : T[K]
}

/** Contributions borrow native operations and selection capabilities, without owning scene or runtime disposal. */
export type ModelingSceneAccess = Pick<
  KclSceneResource,
  | 'entityStyling'
  | 'sceneInfra'
  | 'element'
  | 'presentation'
  | 'localHost'
  | 'commands'
  | 'captureScreenshot'
  | 'preferences'
  | 'isConnected'
> & {
  readonly runtime: Observed<
    Pick<
      KclSceneResource['runtime'],
      | 'state'
      | 'ast'
      | 'fileSettings'
      | 'sources'
      | 'executionRevision'
      | 'executionElapsedMs'
      | 'executing'
      | 'failed'
      | 'evaluateExpression'
      | 'validate'
      | 'waitForAllEngineModelingCommands'
      | 'exportModel'
    >
  >
  readonly selection: Pick<
    KclSceneResource['selection'],
    | 'model'
    | 'selected'
    | 'displayed'
    | 'filter'
    | 'pickingEnabled'
    | 'error'
    | 'dialogOpen'
    | 'beginPicking'
    | 'clear'
    | 'setFilter'
    | 'validate'
  >
}
type InteractionControls = Observed<
  Pick<
    ReturnType<typeof createModelingInteractions>,
    | 'definitions'
    | 'views'
    | 'busy'
    | 'error'
    | 'enter'
    | 'close'
    | 'reportError'
  >
> & {
  readonly active: ReadonlySignal<
    Omit<ModelingInteractionSession, 'dispose'> | undefined
  >
}
type ToolControls = Observed<
  Pick<
    ReturnType<typeof createModelingTools>,
    'definitions' | 'active' | 'error' | 'opening' | 'open' | 'close'
  >
>

/** Contributions receive their owning view explicitly; focus never changes their target. */
export interface ModelingViewContext {
  selection: SelectionSource
  readonly interactions: InteractionControls
  settings: SettingsRegistryService
  readonly tools: ToolControls
  readonly executor: Pick<Executor, 'editor' | 'output' | 'refresh'>
  readonly session: {
    readonly resource: ReadonlySignal<ModelingSceneAccess | undefined>
    readonly state: ReadonlySignal<KclSession['state']['value']>
  }
  wasm: Promise<ModuleType>
  fileOperations: FileOperationsRegistryService | undefined
  measurement: ReturnType<typeof createMeasurementToolService>
  physicalAnalysis: ReturnType<typeof createPhysicalAnalysisService>
  statusItems: ReadonlySignal<readonly ModelingStatusItem[]>
}
/** Host-only lifetime controls are retained by the view factory and its rendering surface. */
export interface ModelingViewRuntime
  extends Omit<
    ModelingViewContext,
    'interactions' | 'tools' | 'executor' | 'session'
  > {
  interactions: ReturnType<typeof createModelingInteractions>
  tools: ReturnType<typeof createModelingTools>
  executor: Executor
  session: KclSession
  commandRouting?: Pick<ContextualCommandsService, 'clear'>
  machine?: Pick<MachineModelingHost, 'owner' | 'error'>
}
export interface ModelingStatusItem {
  id: string
  side: 'start' | 'end'
  order: number
  Component: ComponentType<{ context: ModelingViewContext }>
}
export const modelingViewContract = defineContract({
  modelingInteractionViewsValueSpec:
    appendValueSpec<ModelingInteractionViewDefinition>(
      'modeling-view.interaction-views'
    ),
  modelingInteractionsValueSpec: appendValueSpec<ModelingInteractionDefinition>(
    'modeling-view.interactions'
  ),
  modelingToolsValueSpec: appendValueSpec<ModelingToolDefinition>(
    'modeling-view.tools'
  ),
  modelingStatusItemsValueSpec: appendValueSpec<ModelingStatusItem>(
    'modeling-view.status-items'
  ),
})
export const {
  modelingInteractionViewsValueSpec,
  modelingStatusItemsValueSpec,
  modelingToolsValueSpec,
  modelingInteractionsValueSpec,
} = modelingViewContract
