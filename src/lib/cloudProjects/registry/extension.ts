import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { createCloudProjectsServices } from '@src/lib/cloudProjects/service'
import fsZds from '@src/lib/fs-zds'
import { authService } from '@src/registry/contracts/auth'
import { fileOperationsMountsFacet } from '@src/registry/contracts/fileOperations'
import { contribute, provide, type Subtree } from 'plankton'
export const cloudProjectsExtension: Subtree = {
  key: 'cloud-projects-storage',
  create: (ctx) => {
    const services = createCloudProjectsServices(fsZds, () => ({
      enabled: true,
      token: ctx.optional(authService)?.token.peek(),
      accountId:
        ctx.optional(authService)?.user.peek()?.id ||
        ctx.optional(authService)?.token.peek(),
    }))
    return {
      items: [
        contribute(fileOperationsMountsFacet, () => services.mount),
        provide(cloudStorageService, services.cloud),
      ],
      dispose: services.dispose,
    }
  },
}
