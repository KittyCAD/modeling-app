import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { createCloudProjectsServices } from '@src/lib/cloudProjects/service'
import fsZds from '@src/lib/fs-zds'
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
    const services = createCloudProjectsServices(fsZds, () => ({
      enabled: true,
      token: authInputs.authService.current.value?.token.peek(),
      accountId:
        authInputs.authService.current.value?.user.peek()?.id ||
        authInputs.authService.current.value?.token.peek(),
    }))
    return {
      items: [
        contribute(fileOperationsMountsFacet, () => services.mount),
        provide(cloudStorageService, services.cloud),
      ],
      dispose: services.dispose,
    }
  },
})
