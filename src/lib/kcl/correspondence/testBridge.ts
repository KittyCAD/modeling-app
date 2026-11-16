import { expect } from 'vitest'
import { signal, type ReadonlySignal } from '@preact/signals-core'
import { createEditorSelectionBridges } from '@src/lib/editors/selectionBridges/links'
import { createCorrespondenceBridge } from '@src/lib/kcl/correspondence/bridge'
import {
  kclSelectionBridge,
  type CodeCorrespondenceEndpoint,
  type CodeCorrespondenceHandle,
} from '@src/lib/kcl/correspondence/contract'
import { modelingCorrespondenceEndpoint } from '@src/lib/kcl/correspondence/modelEndpoint'
import type { ModelingViewRuntime as ModelingViewContext } from '@src/lib/kcl/registry/contract'
import type { SourceRange } from '@src/lang/wasm'

/** Test harness keeps ownership explicit while existing behavioral scenarios exercise the domain adapter. */
export function testCorrespondenceBridge() {
  const routing = createEditorSelectionBridges(signal([kclSelectionBridge]))
  const owner = createCorrespondenceBridge(routing)
  const handles = new Map<symbol, CodeCorrespondenceHandle>()
  return {
    error: owner.service.error,
    registrations: owner.registrations,
    registerCode: (endpoint: CodeCorrespondenceEndpoint) => {
      const handle = owner.registrations.registerCode(endpoint)
      if (handle instanceof Error) return expect.fail(handle.message)
      handles.set(endpoint.id, handle)
      return handle.dispose
    },
    registerModel: ({
      id,
      context,
      enabled,
    }: {
      id: symbol
      context: ModelingViewContext
      enabled?: ReadonlySignal<boolean>
    }) => {
      const cleanup = owner.registrations.registerModel(
        modelingCorrespondenceEndpoint(id, context, enabled)
      )
      if (cleanup instanceof Error) return expect.fail(cleanup.message)
      return cleanup
    },
    link: (source: symbol, target: symbol) =>
      routing.links.link(kclSelectionBridge.id, source, target),
    setPickingTarget: (source: symbol, target: symbol | undefined) =>
      routing.links.setPickingTarget(kclSelectionBridge.id, source, target),
    selectCode: (source: symbol, ranges: readonly SourceRange[]) =>
      handles.get(source)?.select(ranges),
    dispose: () => {
      owner.dispose()
      routing.dispose()
    },
  }
}
