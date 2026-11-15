import type { SketchCorrespondenceEndpoint } from '@src/lib/kcl/correspondence/sketchContract'
import type { EntityStyle } from '@src/lib/scene/entityStyling'
import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { EntityReference } from '@kittycad/lib'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { EditorSelectionBridgeDefinition } from '@src/lib/editors/selectionBridges/contract'
import type { ExecState, SourceRange } from '@src/lang/wasm'
import type { KclSourceSnapshot } from '@src/lib/kcl/sources'
import type { SelectionSource } from '@src/lib/kcl/selection'
import type { PickingArgument, SelectionModel } from '@src/lib/scene/selection'

export const kclSelectionBridge: EditorSelectionBridgeDefinition = {
  id: 'kcl.correspondence',
  sourceKind: 'kcl.code',
  targetKind: 'kcl.modeling',
  linkSameEditor: true,
}
/** The bridge borrows execution data, not native resource or executor lifecycle authority. */
export interface CorrespondenceExecution {
  readonly model: SelectionModel
  readonly state: ExecState
  readonly output: { readonly src: string; readonly contents: string }
  readonly sources: KclSourceSnapshot | undefined
}
export interface CorrespondenceLayer {
  readonly sourceViewId: symbol
  readonly style: EntityStyle
  readonly references: readonly EntityReference[]
}
export interface CodeCorrespondenceEndpoint {
  readonly style?: EntityStyle
  readonly id: symbol
  readonly editor: Pick<Editor, 'id' | 'src' | 'contents'>
  readonly enabled?: ReadonlySignal<boolean>
  decorate: (ranges: readonly SourceRange[]) => void
}
export interface ModelingCorrespondenceEndpoint {
  readonly id: symbol
  readonly editorId: symbol
  readonly enabled?: ReadonlySignal<boolean>
  readonly execution: ReadonlySignal<CorrespondenceExecution | undefined>
  readonly selection: SelectionSource
  readonly sketch?: ReadonlySignal<SketchCorrespondenceEndpoint | undefined>
  readonly interacting: ReadonlySignal<boolean>
  readonly pickingArgument: ReadonlySignal<PickingArgument | undefined>
  project: (
    execution: CorrespondenceExecution | undefined,
    layers: readonly CorrespondenceLayer[]
  ) => void
  offer: (
    execution: CorrespondenceExecution,
    references: readonly EntityReference[]
  ) => Error | undefined
}
/** A provider receives a handle scoped to its own Code endpoint, never another view's publisher. */
export interface CodeCorrespondenceHandle {
  select: (ranges: readonly SourceRange[]) => void
  invalidate: () => void
  dispose: () => void
}
export interface KclCorrespondenceEndpoints {
  registerCode: (
    endpoint: CodeCorrespondenceEndpoint
  ) => CodeCorrespondenceHandle | Error
  registerModel: (
    endpoint: ModelingCorrespondenceEndpoint
  ) => (() => void) | Error
}
export interface KclCorrespondenceStatus {
  readonly error: ReadonlySignal<Error | undefined>
}
export const kclCorrespondenceContract = defineContract({
  kclCorrespondenceStatusService: defineService<KclCorrespondenceStatus>(
    'kcl.correspondence-status'
  ),
  kclCorrespondenceEndpointsService: defineService<KclCorrespondenceEndpoints>(
    'kcl.correspondence-endpoints'
  ),
})
export const {
  kclCorrespondenceStatusService,
  kclCorrespondenceEndpointsService,
} = kclCorrespondenceContract
