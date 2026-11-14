import { lspService } from '@src/lang/lsp/registry/contract'
import { createLspService } from '@src/lang/lsp/service'
import type { AuthRegistryService } from '@src/registry/contracts/auth'
import { authExtension } from '@src/registry/extensions/auth'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import type { UserFeaturesRegistryService } from '@src/registry/contracts/userFeatures'
import { userFeaturesExtension } from '@src/registry/extensions/userFeatures'
import { factory as defineFactory, provide, type Factory } from 'plankton'
export const createLspExtension = ({
  auth = authExtension,
  userFeatures = userFeaturesExtension,
}: {
  auth?: Factory<AuthRegistryService>
  userFeatures?: Factory<UserFeaturesRegistryService>
} = {}) =>
  defineFactory({
    dependencies: {
      fileOperations: fileOperationsObservations,
      auth,
      userFeatures,
    },
    key: 'lsp-extension',
    create: ({ fileOperations: fileOperationsInputs, auth, userFeatures }) => {
      const lsp = createLspService({
        getFileOperations: () =>
          fileOperationsInputs.fileOperationsService.required(),
        auth,
        userFeatures,
      })
      return {
        items: [provide(lspService, lsp.service)],
        dispose: lsp.dispose,
      }
    },
  })
export const lspExtension = createLspExtension()
export default [lspExtension]
