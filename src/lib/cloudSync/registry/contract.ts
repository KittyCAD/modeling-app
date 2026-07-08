import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type {
  CloudSyncConfig,
  CloudSyncConflictResolution,
  CloudSyncLocalProject,
  CloudSyncProjectMetadata,
  CloudSyncProjectMetadataIndexEntry,
  CloudSyncStatus,
} from '@src/lib/cloudSync'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

export type CloudSyncRegistryService = {
  status: ReadonlySignal<CloudSyncStatus>
  configure: (config: CloudSyncConfig) => void
  installFileSystemObserver: (activeFs?: IZooDesignStudioFS) => void
  retry: () => void
  setProjectScope: (projectPath?: string) => void
  startProjectSync: (projectPath: string) => Promise<void>
  disconnectProjectSync: (projectPath: string) => Promise<void>
  ensureProjectLocallySynced: (
    remoteProjectId: string
  ) => Promise<CloudSyncLocalProject | undefined>
  getProjectMetadata: (
    projectPath: string
  ) => Promise<CloudSyncProjectMetadata | undefined>
  getProjectMetadataIndex: () => Promise<
    Map<string, CloudSyncProjectMetadataIndexEntry>
  >
  getProjectModifiedTime: (
    metadata: CloudSyncProjectMetadataIndexEntry | undefined,
    localModified: number | null | undefined
  ) => number | null
  resolveProjectConflict: (
    projectPath: string,
    resolution: CloudSyncConflictResolution
  ) => Promise<void>
}

export const cloudSyncContract = defineContract({
  cloudSyncService:
    defineService<CloudSyncRegistryService>('cloud-sync.service'),
})

export const { cloudSyncService } = cloudSyncContract
