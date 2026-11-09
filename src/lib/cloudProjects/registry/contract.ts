import type { CloudStorageService } from '@src/lib/cloudProjects/service'
import { contract, service } from 'plankton'

export type { CloudStorageService } from '@src/lib/cloudProjects/service'
export const cloudProjectsContract = contract({
  cloudStorageService: service<CloudStorageService>('cloud-projects.storage'),
})
export const { cloudStorageService } = cloudProjectsContract
