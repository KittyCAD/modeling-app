import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import {
  editorSelectionBridgeDefinitions,
  editorSelectionEndpointsService,
  editorSelectionLinksService,
} from '@src/lib/editors/selectionBridges/contract'
import { createEditorSelectionBridges } from '@src/lib/editors/selectionBridges/links'

export default defineRegistryItemFactory(({ valueSpecs }) => {
  let owner: ReturnType<typeof createEditorSelectionBridges> | undefined
  let disposed = false
  const getOwner = () => {
    if (!owner) {
      owner = createEditorSelectionBridges(
        valueSpecs.signal(editorSelectionBridgeDefinitions)
      )
      if (disposed) owner.dispose()
    }
    return owner
  }
  return {
    providesServices: [
      provideService(editorSelectionLinksService, {
        endpoints: computed(() => getOwner().links.endpoints.value),
        connections: computed(() => getOwner().links.connections.value),
        link: (...args) => getOwner().links.link(...args),
        setPickingTarget: (...args) =>
          getOwner().links.setPickingTarget(...args),
        pickingTarget: (...args) => getOwner().links.pickingTarget(...args),
      }),
      provideService(editorSelectionEndpointsService, {
        register: (endpoint) => getOwner().registrations.register(endpoint),
      }),
    ],
    dispose: () => {
      disposed = true
      owner?.dispose()
    },
  }
}, 'editors.selection-bridges')
