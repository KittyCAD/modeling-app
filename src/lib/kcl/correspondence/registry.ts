import {
  defineRegistryItemFactory,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals-core'
import editorSelectionBridgesExtension from '@src/lib/editors/selectionBridges/registry'
import {
  editorSelectionBridgeDefinitions,
  editorSelectionEndpointsService,
  editorSelectionLinksService,
} from '@src/lib/editors/selectionBridges/contract'
import {
  codeEditorsExtensionValueSpec,
  editorsService,
} from '@src/lib/editors/registry/contract'
import { createCorrespondenceBridge } from '@src/lib/kcl/correspondence/bridge'
import { correspondenceCodeExtension } from '@src/lib/kcl/correspondence/codeExtension'
import {
  kclSelectionBridge,
  kclCorrespondenceEndpointsService,
  kclCorrespondenceStatusService,
} from '@src/lib/kcl/correspondence/contract'

/** KCL contributes a domain adapter to generic view links; it can be composed independently of KCL execution and toolbar tools. */
export default defineRegistryItemFactory(({ services }) => {
  // Service lookup is deferred until the registry graph is configured.
  let owner: ReturnType<typeof createCorrespondenceBridge> | undefined
  const closed = signal(false)
  const getOwner = () =>
    (owner ??= createCorrespondenceBridge({
      links: services.get(editorSelectionLinksService),
      registrations: services.get(editorSelectionEndpointsService),
    }))
  return {
    uses: [editorSelectionBridgesExtension],
    provides: [
      provide(editorSelectionBridgeDefinitions, kclSelectionBridge),
      provide(codeEditorsExtensionValueSpec, {
        id: 'editors.kcl-correspondence',
        matches: ({ languageId }) => languageId === 'kcl',
        extensions: (host) =>
          correspondenceCodeExtension(
            host,
            getOwner().registrations,
            computed(
              () =>
                services.get(editorsService).viewState(host.instance).value
                  .selected?.id === 'editors.code'
            )
          ),
      }),
    ],
    providesServices: [
      provideService(kclCorrespondenceEndpointsService, {
        registerCode: (endpoint) =>
          closed.peek()
            ? new Error('The correspondence owner closed.')
            : getOwner().registrations.registerCode(endpoint),
        registerModel: (endpoint) =>
          closed.peek()
            ? new Error('The correspondence owner closed.')
            : getOwner().registrations.registerModel(endpoint),
      }),
      provideService(kclCorrespondenceStatusService, {
        error: computed(() =>
          closed.value ? undefined : getOwner().service.error.value
        ),
      }),
    ],
    dispose: () => {
      closed.value = true
      owner?.dispose()
    },
  }
}, 'kcl.correspondence')
