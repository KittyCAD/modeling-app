import { ShareProjectButton } from '@src/components/ShareProjectButton'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { createCloudProjectsServices } from '@src/lib/cloudProjects/service'
import fsZds from '@src/lib/fs-zds'
import { appHeaderItemsFacet } from '@src/registry/contracts/appHeader'
import { observations as authObservations } from '@src/registry/contracts/auth'
import { fileOperationsMountsFacet } from '@src/registry/contracts/fileOperations'
import {
  factory as defineFactory,
  contribute,
  provide,
  type Factory,
} from 'plankton'
export const cloudProjectsExtension: Factory = defineFactory({
  dependencies: { auth: authObservations },
  key: 'cloud-projects-storage',
  create: ({ auth: authInputs }) => {
    const auth = authInputs.authService.current
    const services = createCloudProjectsServices(fsZds, () => ({
      enabled: true,
      token: auth.value?.token.value,
      accountId: auth.value?.user.value?.id || auth.value?.token.value,
    }))
    return {
      items: [
        contribute(fileOperationsMountsFacet, () => services.mount),
        provide(cloudStorageService, services.cloud),
        contribute(appHeaderItemsFacet, () => ({
          id: 'project.share',
          order: 110,
          Component: ShareProjectButton,
        })),
      ],
      dispose: services.dispose,
    }
  },
})
