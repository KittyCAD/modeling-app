import { defineContract, defineService } from '@kittycad/registry'
import type { CloudStorageService } from '@src/lib/cloudProjects/service'

export type { CloudStorageService } from '@src/lib/cloudProjects/service'

export const cloudProjectsContract = defineContract({
  cloudStorageService: defineService<CloudStorageService>(
    'cloud-projects.storage'
  ),
})
export const { cloudStorageService } = cloudProjectsContract
