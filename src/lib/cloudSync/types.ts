import type { ProjectLibraryType } from '@src/lib/projectLibraries'

/** Cloud API project revision token used for guarded updates. */
export type Revision = string

/** Content fingerprint for one file in a whole-project manifest. */
export type ProjectManifestEntry = {
  byteSize: number
  sha256: string
}

/** Snapshot of project archive contents keyed by normalized relative path. */
export type ProjectManifest = {
  files: Record<string, ProjectManifestEntry>
}

/** One normalized file payload included in a cloud project archive upload. */
export type ProjectArchiveFile = {
  relativePath: string
  data: Uint8Array
}

/** Durable per-project sync metadata stored locally in the cloud sync DB. */
export type ProjectMetadata = {
  schemaVersion: 1
  localProjectPath: string
  projectName: string
  remoteProjectId?: string
  remoteRevision?: Revision
  remoteUpdatedAt?: string
  baseManifest?: ProjectManifest
  tombstone?: boolean
  conflict?: {
    remoteRevision?: Revision
    remoteUpdatedAt?: string
    createdAt: string
    /**
     * Legacy conflict copies were persisted as sibling project folders. New
     * conflicts fetch the cloud version on demand instead; this path is retained
     * only so resolving old conflicts can clean up the stale folder.
     */
    conflictProjectPath?: string
  }
  syncExcluded?: {
    reason: 'conflict-copy' | 'user-disconnected'
    sourceProjectPath?: string
    remoteProjectId?: string
    createdAt: string
  }
  lastFailure?: ProjectSyncFailure
  lastSyncedAt?: string
}

export type ProjectSyncFailureKind = 'remote-upload-forbidden'

export type ProjectSyncFailure = {
  message: string
  at: string
  kind?: ProjectSyncFailureKind
}

/** Durable queued local mutation that should be replicated to the cloud later. */
export type OutboxEntry = {
  id?: number
  projectPath: string
  kind: 'upsert' | 'delete'
  targetPath: string
  sourcePath?: string
  deletedPaths?: string[]
  createdAt: string
}

/** Project metadata shape returned by cloud project list/detail endpoints. */
export type RemoteProjectSummary = {
  id: string
  title?: string
  updated_at?: string
  revision?: Revision | number
  [key: string]: unknown
}

/** Full remote project metadata used by cloud sync before archive download. */
export type RemoteProject = RemoteProjectSummary

/** Metadata fields sent alongside whole-project cloud archive uploads. */
export type ProjectUploadBody = {
  title: string
  description: string
  category_ids: string[]
  entrypoint_path: string
  project_toml_path: string
  expected_revision?: Revision
  deleted_paths?: string[]
}

/** Publication metadata that whole-project replacements must preserve. */
export type ProjectUploadPublicationMetadata = {
  description: string
  category_ids: string[]
}

/** Runtime configuration for enabling and targeting cloud sync replication. */
export type CloudSyncConfig = {
  enabled: boolean
  token?: string
  baseUrl?: string
  environmentName?: string
  /** Local materialization paths for configured cloud-type project libraries. */
  cloudProjectDirectoryPaths?: string[]
  autoEnrollCloudLibraryProjects?: boolean
}

/** Currently opened project context used to scope status and retry behavior. */
export type CloudSyncOpenedProject = {
  projectPath: string
  libraryPath?: string
  libraryType?: ProjectLibraryType
}

/** Coarse user-visible sync state exposed to status bar consumers. */
export type CloudSyncState =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'failed'
  | 'conflict'

/** Current aggregate sync status for UI and diagnostics. */
export type CloudSyncStatus = {
  enabled: boolean
  state: CloudSyncState
  pendingCount: number
  scopedProjectPath?: string
  scopedProjectCloudProjectId?: string
  activeProjectPath?: string
  lastFailure?: string
  lastFailureKind?: ProjectSyncFailureKind
  lastFailureAt?: string
  lastSyncedAt?: string
}

/** Local project that has been associated with a remote cloud project. */
export type CloudSyncLocalProject = {
  projectPath: string
  projectName: string
  remoteProjectId: string
  remoteRevision?: Revision
}

/** Project metadata index entry enriched with pending local-change state. */
export type CloudSyncProjectMetadataIndexEntry = ProjectMetadata & {
  hasPendingChanges: boolean
  pendingSince?: string
}

/** Remote revision/update metadata extracted from cloud API responses. */
export type RemoteSyncMetadata = {
  revision?: Revision
  updatedAt?: string
}
