import { engineConnectionService } from '@src/lib/engineConnection/registry/contract'
import RustContext from '@src/lib/rustContext'
import {
  type RustContextRegistryService,
  rustContextService,
} from '@src/lib/rustContext/registry/contract'
import { projectSession } from '@src/registry/contracts/projectSession'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseFacet } from '@src/registry/contracts/wasm'
import { provide, type Subtree } from 'plankton'
export const rustContextExtension: Subtree = {
  key: 'rust-context-extension',
  create: (ctx) => {
    let service: RustContextRegistryService | undefined
    const ensureService = () => {
      if (service) {
        return service
      }
      const wasmPromise =
        ctx.get(wasmPromiseFacet) ??
        Promise.reject(new Error('Missing WASM promise registry value.'))
      const engineConnection = ctx.required(engineConnectionService)
      const settings = ctx.required(settingsService)
      service = {
        context: new RustContext(
          wasmPromise,
          engineConnection.manager,
          settings.actor,
          0,
          async () => {
            await ctx
              .optional(projectSession)
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
}
export default [rustContextExtension]
