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
} from '@src/registry/contracts/cloudSync'

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

const cloudSyncExtension = defineRegistryItem({
  id: 'cloud-sync-extension',
  providesServices: [provideService(cloudSyncService, serviceImpl)],
})

export default cloudSyncExtension
