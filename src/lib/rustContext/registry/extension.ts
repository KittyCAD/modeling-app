import { observations as engineConnectionObservations } from '@src/lib/engineConnection/registry/contract'
import RustContext from '@src/lib/rustContext'
import {
  type RustContextRegistryService,
  rustContextService,
} from '@src/lib/rustContext/registry/contract'
import { observations as projectSessionObservations } from '@src/registry/contracts/projectSession'
import { observations as settingsObservations } from '@src/registry/contracts/settings'
import { observations as wasmObservations } from '@src/registry/contracts/wasm'
import { extension as defineExtension, provide, type Extension } from 'plankton'
export const rustContextExtension: Extension = defineExtension({
  dependencies: {
    wasm: wasmObservations,
    engineConnection: engineConnectionObservations,
    settings: settingsObservations,
    projectSession: projectSessionObservations,
  },
  key: 'rust-context-extension',
  create: ({
    wasm: wasmInputs,
    engineConnection: engineConnectionInputs,
    settings: settingsInputs,
    projectSession: projectSessionInputs,
  }) => {
    let service: RustContextRegistryService | undefined
    const ensureService = () => {
      if (service) {
        return service
      }
      const wasmPromise =
        wasmInputs.wasmPromiseFacet.value ??
        Promise.reject(new Error('Missing WASM promise registry value.'))
      const engineConnection =
        engineConnectionInputs.engineConnectionService.required()
      const settings = settingsInputs.settingsService.required()
      service = {
        context: new RustContext(
          wasmPromise,
          engineConnection.manager,
          settings.actor,
          0,
          async () => {
            await projectSessionInputs.projectSession.current.value
              ?.getProject()
              ?.prepareForSketchInsertion()
          }
        ),
      }
      return service
    }
    return {
      items: [
        provide(rustContextService, {
          get context() {
            return ensureService().context
          },
        }),
      ],
    }
  },
})
export default [rustContextExtension]
