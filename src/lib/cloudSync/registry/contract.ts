import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type {
  CloudSyncConfig,
  CloudSyncConflictResolution,
  CloudSyncLocalProject,
  CloudSyncOpenedProject,
  CloudSyncProjectMetadata,
  CloudSyncProjectMetadataIndexEntry,
  CloudSyncStatus,
  RemoteProjectSummary,
} from '@src/lib/cloudSync'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import type { ProjectLibraryRealization } from '@src/registry/contracts/projectLibraries'

export type CloudProjectDuplicateRisk =
  | 'exact'
  | 'divergent'
  | 'pending'
  | 'conflicted'
  | 'unreadable'
  | 'tombstoned'
  | 'sync-excluded'
  | 'unknown'

export type CloudProjectRealizationRole = 'canonical' | 'duplicate'

export interface CloudProjectRelationshipRealization {
  role: CloudProjectRealizationRole
  realization: ProjectLibraryRealization
  duplicateRisk: CloudProjectDuplicateRisk
  autoCleanupEligible: boolean
}

/**
 * A remote project is the cloud-side project record identified by cloud project
 * ID. A cloud relationship explicitly binds that remote project to zero or
 * more local realizations.
 *
 * The canonical realization is the preferred local folder for the
 * relationship. Duplicate realizations are non-canonical local folders bound to
 * the same remote project. Home renders these relationships; it does not infer
 * them from provider entries.
 */
export interface CloudProjectRelationship {
  id: string
  remoteProjectId: string
  remoteProject?: RemoteProjectSummary
  canonicalRealization?: CloudProjectRelationshipRealization
  duplicateRealizations: readonly CloudProjectRelationshipRealization[]
  localRealizations: readonly CloudProjectRelationshipRealization[]
  modified?: number
  remoteThumbnailUrl?: string
  conflict?: unknown
  syncFailure?: {
    message: string
    at?: string
    kind?: string
  }
}

export type CloudProjectRelationshipsRegistryService = {
  /**
   * cloudSync-owned relationship state. This is a singleton service signal,
   * not a ValueSpec, because cloud identity resolution is not an extension
   * contribution surface.
   */
  relationships: ReadonlySignal<CloudProjectRelationship[]>
}

export type CloudSyncRegistryService = {
  status: ReadonlySignal<CloudSyncStatus>
  configure: (config: CloudSyncConfig) => void
  installFileSystemObserver: (activeFs?: IZooDesignStudioFS) => void
  retry: () => void
  setOpenedProject: (project?: CloudSyncOpenedProject) => void
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
   * Delete the remote cloud project identified by `remoteProjectId`.
   * Library delete operations with local materializations must remove their
   * local project directory as well before reporting success.
   */
  deleteRemoteProject: (remoteProjectId: string) => Promise<void>
  /**
   * Remove the selected local materialization of a cloud project plus exact
   * duplicate local copies. Divergent local copies are detached from the cloud
   * project instead of being silently deleted.
   */
  deleteLocalProjectRealizations: (
    remoteProjectId: string,
    selectedProjectPath: string
  ) => Promise<void>
  /**
   * Materialize a remote cloud project into the local library directory the
   * caller is opening it from. `targetProjectDirectoryPath` is the resolved
   * local path of that library; when omitted the engine falls back to the
   * configured project directory.
   */
  ensureProjectLocallySynced: (
    remoteProjectId: string,
    targetProjectDirectoryPath?: string
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
    resolution: CloudSyncConflictResolution,
    reviewedRemoteRevision?: CloudSyncProjectMetadata['remoteRevision']
  ) => Promise<void>
}

export const cloudSyncContract = defineContract({
  cloudSyncService:
    defineService<CloudSyncRegistryService>('cloud-sync.service'),
  cloudProjectRelationshipsService:
    defineService<CloudProjectRelationshipsRegistryService>(
      'cloud-project-relationships.service'
    ),
})

export const { cloudSyncService, cloudProjectRelationshipsService } =
  cloudSyncContract
