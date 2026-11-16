import {
  defineRegistryItemFactory,
  provideService,
  provide,
} from '@kittycad/registry'
import { createCloudProjectsServices } from '@src/lib/cloudProjects/service'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { authService } from '@src/registry/contracts/auth'
import { fileOperationsMountsValueSpec } from '@src/registry/contracts/fileOperations'

export const cloudProjectsExtension = defineRegistryItemFactory((ctx) => {
  const services = createCloudProjectsServices(fsZds, () => ({
    enabled: true,
    token: ctx.services.optional(authService)?.token.peek(),
    accountId:
      ctx.services.optional(authService)?.user.peek()?.id ||
      ctx.services.optional(authService)?.token.peek(),
  }))
  return {
    id: 'cloud-projects-storage',
    provides: [provide(fileOperationsMountsValueSpec, services.mount)],
    providesServices: [provideService(cloudStorageService, services.cloud)],
    dispose: services.dispose,
  }
}, 'cloud-projects-storage')
