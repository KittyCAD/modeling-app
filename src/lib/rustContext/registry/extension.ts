import type { EngineConnectionService } from '@src/lib/engineConnection/registry/contract'
import { engineConnectionExtension } from '@src/lib/engineConnection/registry/extension'
import RustContext from '@src/lib/rustContext'
import {
  type RustContextRegistryService,
  rustContextService,
} from '@src/lib/rustContext/registry/contract'
import { observations as projectSessionObservations } from '@src/registry/contracts/projectSession'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsExtension } from '@src/registry/extensions/settings'
import { observations as wasmObservations } from '@src/registry/contracts/wasm'
import { factory as defineFactory, provide, type Factory } from 'plankton'
export const createRustContextExtension = ({
  engineConnection = engineConnectionExtension,
  settings = settingsExtension,
}: {
  engineConnection?: Factory<EngineConnectionService>
  settings?: Factory<SettingsRegistryService>
} = {}) =>
  defineFactory({
    dependencies: {
      wasm: wasmObservations,
      engineConnection,
      settings,
      projectSession: projectSessionObservations,
    },
    key: 'rust-context-extension',
    create: ({
      wasm: wasmInputs,
      engineConnection,
      settings,
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
export const rustContextExtension = createRustContextExtension()
export default [rustContextExtension]
