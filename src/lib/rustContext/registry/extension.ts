import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { engineConnectionService } from '@src/lib/engineConnection/registry/contract'
import RustContext from '@src/lib/rustContext'
import {
  type RustContextRegistryService,
  rustContextService,
} from '@src/lib/rustContext/registry/contract'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'

export const rustContextExtension = defineRegistryItemFactory((ctx) => {
  let service: RustContextRegistryService | undefined

  const ensureService = () => {
    if (service) {
      return service
    }

    const wasmPromise =
      ctx.valueSpecs.get(wasmPromiseValueSpec) ??
      Promise.reject(new Error('Missing WASM promise registry value.'))
    const engineConnection = ctx.services.get(engineConnectionService)
    const settings = ctx.services.get(settingsService)

    service = {
      context: new RustContext(
        wasmPromise,
        engineConnection.manager,
        settings.actor
      ),
    }
    return service
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'rust-context-extension',
      providesServices: [
        provideService(rustContextService, {
          get context() {
            return ensureService().context
          },
        }),
      ],
    }),
  }
}, 'rust-context-extension')

export default defineRegistryItem({
  id: 'rust-context',
  uses: [rustContextExtension],
})
