import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type {
  CloudSyncConfig,
  CloudSyncConflictResolution,
  CloudSyncLocalProject,
  CloudSyncProjectMetadata,
  CloudSyncProjectMetadataIndexEntry,
  CloudSyncStatus,
  RemoteProjectSummary,
} from '@src/lib/cloudSync'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

export type CloudSyncRegistryService = {
  status: ReadonlySignal<CloudSyncStatus>
  configure: (config: CloudSyncConfig) => void
  installFileSystemObserver: (activeFs?: IZooDesignStudioFS) => void
  retry: () => void
  setProjectScope: (projectPath?: string) => void
  /**
   * Explicitly enroll a local-only project in cloud sync, even when the global
   * policy is not auto-enrolling existing local projects.
   */
  startProjectSync: (projectPath: string) => Promise<void>
  /**
   * Delete the remote cloud project and keep the local project as local-only.
   * The local project is marked excluded so later edits do not recreate it.
   */
  disconnectProjectSync: (projectPath: string) => Promise<void>
  /**
   * Move an already cloud-linked local project into the canonical Personal
   * Cloud library storage location.
   */
  moveProjectToPersonalCloudLibrary: (
    projectPath: string
  ) => Promise<CloudSyncLocalProject>
  ensureProjectLocallySynced: (
    remoteProjectId: string
  ) => Promise<CloudSyncLocalProject | undefined>
  getRemoteProjectThumbnailUrl: (
    remoteProject: RemoteProjectSummary
  ) => Promise<string | undefined>
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
