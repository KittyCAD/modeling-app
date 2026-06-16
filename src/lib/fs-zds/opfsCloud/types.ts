import type { OPFSOptions } from '@src/lib/fs-zds/opfs'

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

/** Durable per-project sync metadata stored locally in the OPFSCloud sync DB. */
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
    conflictProjectPath: string
    createdAt: string
  }
  syncExcluded?: {
    reason: 'conflict-copy'
    sourceProjectPath?: string
    remoteProjectId?: string
    createdAt: string
  }
  lastFailure?: {
    message: string
    at: string
  }
  lastSyncedAt?: string
}

/** Durable queued local mutation that should be replicated to the cloud later. */
export type OutboxEntry = {
  id?: number
  projectPath: string
  kind: 'upsert' | 'delete'
  targetPath: string
  sourcePath?: string
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

/** Full remote project metadata used by OPFSCloud before archive download. */
export type RemoteProject = RemoteProjectSummary

/** Metadata fields sent alongside whole-project cloud archive uploads. */
export type ProjectUploadBody = {
  title: string
  description: string
  category_ids: string[]
  entrypoint_path: string
  project_toml_path: string
  expected_revision?: Revision
}

/** Runtime configuration for enabling and targeting OPFSCloud replication. */
export type OPFSCloudConfig = {
  enabled: boolean
  token?: string
  baseUrl?: string
  environmentName?: string
  projectDirectoryPath?: string
}

/** Coarse user-visible sync state exposed to status bar consumers. */
export type OPFSCloudSyncState =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'failed'
  | 'conflict'

/** Current aggregate sync status for UI and diagnostics. */
export type OPFSCloudSyncStatus = {
  enabled: boolean
  state: OPFSCloudSyncState
  pendingCount: number
  activeProjectPath?: string
  lastFailure?: string
  lastFailureAt?: string
  lastSyncedAt?: string
}

/** OPFS backing options accepted by the OPFSCloud wrapper. */
export type OPFSCloudOptions = OPFSOptions

/** Local project that has been associated with a remote cloud project. */
export type OpfsCloudLocalProject = {
  projectPath: string
  projectName: string
  remoteProjectId: string
  remoteRevision?: Revision
}

/** Project metadata index entry enriched with pending local-change state. */
export type OpfsCloudProjectMetadataIndexEntry = ProjectMetadata & {
  hasPendingChanges: boolean
}

/** Remote revision/update metadata extracted from cloud API responses. */
export type RemoteSyncMetadata = {
  revision?: Revision
  updatedAt?: string
}
