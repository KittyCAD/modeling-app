import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { ProjectLibrary } from '@src/lib/projectLibraries'

export type CloudSyncState =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'error'
  | 'conflict'

export interface CloudSyncStatus {
  enabled: boolean
  state: CloudSyncState
  activeLibraryId?: string
  error?: string
  lastSyncedAt?: number
  conflictCount: number
}

/** Owner-visible project metadata returned by the Zoo projects API. */
export interface RemoteCloudProject {
  id: string
  title?: string
  revision?: string | number
  updated_at?: string
  description?: string
  category_ids?: string[]
  entrypoint_path?: string
  [key: string]: unknown
}

/**
 * Actor-free cloud replication.
 *
 * A cloud library is a normal local materialization directory. This service is
 * solely the relationship between those bytes and Zoo's project archive API;
 * projectLibraries still owns configuration, discovery, and user operations.
 */
export interface CloudSyncService {
  readonly status: ReadonlySignal<CloudSyncStatus>
  readonly remoteProjects: ReadonlySignal<readonly RemoteCloudProject[]>

  /** Reconcile every materialized and remote project in one cloud library. */
  syncLibrary(library: ProjectLibrary): Promise<void>
  /** Enroll or push one local project. May reconcile the rest of its library. */
  syncProject(library: ProjectLibrary, projectPath: string): Promise<void>
  /** Preserve a relationship when a local operation renames its folder. */
  relocateProject(
    library: ProjectLibrary,
    fromPath: string,
    toPath: string
  ): Promise<void>
  /** Delete both the remote project and its local materialization. */
  deleteProject(library: ProjectLibrary, projectPath: string): Promise<void>
  /** Delete the remote relationship while leaving the local bytes alone. */
  disconnectProject(library: ProjectLibrary, projectPath: string): Promise<void>
  /** Remote id known for one materialized project, if it has synced before. */
  remoteProjectId(
    library: ProjectLibrary,
    projectPath: string
  ): Promise<string | undefined>
  resolveConflict(
    library: ProjectLibrary,
    projectPath: string,
    resolution: 'local' | 'remote'
  ): Promise<void>
  dispose(): void
}

export const cloudSyncContract = defineContract({
  cloudSyncService: defineService<CloudSyncService>('cloudSync.service'),
})

export const { cloudSyncService } = cloudSyncContract
