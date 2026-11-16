import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'

/** A domain adapter declares which endpoint kinds it knows how to connect. Payload interpretation stays in that adapter. */
export interface EditorSelectionBridgeDefinition {
  readonly id: string
  readonly sourceKind: string
  readonly targetKind: string
  readonly linkSameEditor: boolean
}
export interface EditorSelectionEndpoint {
  readonly viewId: symbol
  readonly editorId: symbol
  readonly kind: string
  readonly enabled?: ReadonlySignal<boolean>
}
export interface EditorSelectionConnection {
  readonly bridgeId: string
  readonly source: EditorSelectionEndpoint
  readonly target: EditorSelectionEndpoint
}

/** Consumer authority: inspect connections and choose links/destinations, without registering or closing their owners. */
export interface EditorSelectionLinks {
  readonly endpoints: ReadonlySignal<readonly EditorSelectionEndpoint[]>
  readonly connections: ReadonlySignal<readonly EditorSelectionConnection[]>
  link: (
    bridgeId: string,
    source: symbol,
    target: symbol
  ) => (() => void) | Error
  setPickingTarget: (
    bridgeId: string,
    source: symbol,
    target: symbol | undefined
  ) => Error | undefined
  pickingTarget: (bridgeId: string, source: symbol) => symbol | undefined
}
/** Provider authority: register metadata for an endpoint whose domain adapter owns its selection data. */
export interface EditorSelectionEndpoints {
  register: (endpoint: EditorSelectionEndpoint) => (() => void) | Error
}
export const editorSelectionBridgesContract = defineContract({
  editorSelectionBridgeDefinitions:
    appendValueSpec<EditorSelectionBridgeDefinition>(
      'editors.selection-bridge-definitions'
    ),
  editorSelectionLinksService: defineService<EditorSelectionLinks>(
    'editors.selection-links'
  ),
  editorSelectionEndpointsService: defineService<EditorSelectionEndpoints>(
    'editors.selection-endpoints'
  ),
})
export const {
  editorSelectionBridgeDefinitions,
  editorSelectionLinksService,
  editorSelectionEndpointsService,
} = editorSelectionBridgesContract
