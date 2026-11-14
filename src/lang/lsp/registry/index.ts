import { lspService } from '@src/lang/lsp/registry/contract'
import { createLspService } from '@src/lang/lsp/service'
import { observations as authObservations } from '@src/registry/contracts/auth'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import { observations as userFeaturesObservations } from '@src/registry/contracts/userFeatures'
import { extension as defineExtension, provide, type Extension } from 'plankton'
export const lspExtension: Extension = defineExtension({
  dependencies: {
    fileOperations: fileOperationsObservations,
    auth: authObservations,
    userFeatures: userFeaturesObservations,
  },
  key: 'lsp-extension',
  create: ({
    fileOperations: fileOperationsInputs,
    auth: authInputs,
    userFeatures: userFeaturesInputs,
  }) => {
    const lsp = createLspService({
      getFileOperations: () =>
        fileOperationsInputs.fileOperationsService.required(),
      getAuth: () => authInputs.authService.required(),
      getUserFeatures: () => userFeaturesInputs.userFeaturesService.required(),
    })
    return {
      items: [provide(lspService, lsp.service)],
      dispose: lsp.dispose,
    }
  },
})
export default [lspExtension]
