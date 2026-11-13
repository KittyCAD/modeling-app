import { lspService } from '@src/lang/lsp/registry/contract'
import { createLspService } from '@src/lang/lsp/service'
import { authService } from '@src/registry/contracts/auth'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { extension as defineExtension, provide, type Extension } from 'plankton'
export const lspExtension: Extension = defineExtension({
  key: 'lsp-extension',
  create: (_dependencies, ctx) => {
    const lsp = createLspService({
      getFileOperations: () => ctx.required(fileOperationsService),
      getAuth: () => ctx.required(authService),
      getUserFeatures: () => ctx.required(userFeaturesService),
    })
    return {
      items: [provide(lspService, lsp.service)],
      dispose: lsp.dispose,
    }
  },
})
export default [lspExtension]
