import { lspService } from '@src/lang/lsp/registry/contract'
import { createLspService } from '@src/lang/lsp/service'
import { authService } from '@src/registry/contracts/auth'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import { provide, type Subtree } from 'plankton'
export const lspExtension: Subtree = {
  key: 'lsp-extension',
  create: (ctx) => {
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
}
export default [lspExtension]
