import { defineRegistryItem, provideService } from '@kittycad/registry'
import {
  cloudSyncStatus,
  configureCloudSync,
  ensureCloudProjectLocallySynced,
  getCloudSyncProjectMetadata,
  getCloudSyncProjectMetadataIndex,
  getCloudSyncProjectModifiedTime,
  installCloudSyncFileSystemObserver,
  resolveCloudSyncProjectConflict,
  retryCloudSync,
  setCloudSyncProjectScope,
} from '@src/lib/cloudSync'
import {
  type CloudSyncRegistryService,
  cloudSyncService,
} from '@src/lib/cloudSync/registry/contract'

const serviceImpl: CloudSyncRegistryService = {
  status: cloudSyncStatus,
  configure: configureCloudSync,
  installFileSystemObserver: installCloudSyncFileSystemObserver,
  retry: retryCloudSync,
  setProjectScope: setCloudSyncProjectScope,
  ensureProjectLocallySynced: ensureCloudProjectLocallySynced,
  getProjectMetadata: getCloudSyncProjectMetadata,
  getProjectMetadataIndex: getCloudSyncProjectMetadataIndex,
  getProjectModifiedTime: getCloudSyncProjectModifiedTime,
  resolveProjectConflict: resolveCloudSyncProjectConflict,
}

export const cloudSyncExtension = defineRegistryItem({
  id: 'cloud-sync-extension',
  providesServices: [provideService(cloudSyncService, serviceImpl)],
})
