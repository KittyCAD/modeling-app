import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { lspService } from '@src/lang/lsp/registry/contract'
import { createLspService } from '@src/lang/lsp/service'
import { authService } from '@src/registry/contracts/auth'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'

export const lspExtension = defineRegistryItemFactory((ctx) => {
  const lsp = createLspService({
    getAuth: () => ctx.services.get(authService),
    getUserFeatures: () => ctx.services.get(userFeaturesService),
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'lsp-extension',
      providesServices: [provideService(lspService, lsp.service)],
      dispose: lsp.dispose,
    }),
  }
}, 'lsp-extension')

export default defineRegistryItem({
  id: 'lsp',
  uses: [lspExtension],
})
