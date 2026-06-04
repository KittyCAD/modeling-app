import type { OPFSOptions } from '@src/lib/fs-zds/opfs'

export type Revision = string

export type ProjectManifestEntry = {
  byteSize: number
  sha256: string
}

export type ProjectManifest = {
  files: Record<string, ProjectManifestEntry>
}

export type ProjectArchiveFile = {
  relativePath: string
  data: Uint8Array
}

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
  lastFailure?: {
    message: string
    at: string
  }
  lastSyncedAt?: string
}

export type OutboxEntry = {
  id?: number
  projectPath: string
  kind: 'upsert' | 'delete'
  targetPath: string
  sourcePath?: string
  createdAt: string
}

export type RemoteProjectSummary = {
  id: string
  title?: string
  updated_at?: string
  revision?: Revision | number
  [key: string]: unknown
}

export type RemoteProject = RemoteProjectSummary

export type ProjectUploadBody = {
  title: string
  description: string
  category_ids: string[]
  entrypoint_path: string
  project_toml_path: string
  expected_revision?: Revision
}

export type OPFSCloudConfig = {
  enabled: boolean
  token?: string
  baseUrl?: string
  environmentName?: string
  projectDirectoryPath?: string
}

export type OPFSCloudSyncState =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'failed'
  | 'conflict'

export type OPFSCloudSyncStatus = {
  enabled: boolean
  state: OPFSCloudSyncState
  pendingCount: number
  activeProjectPath?: string
  lastFailure?: string
  lastFailureAt?: string
  lastSyncedAt?: string
}

export type OPFSCloudOptions = OPFSOptions

export type OpfsCloudLocalProject = {
  projectPath: string
  projectName: string
  remoteProjectId: string
  remoteRevision?: Revision
}

export type OpfsCloudProjectMetadataIndexEntry = ProjectMetadata & {
  hasPendingChanges: boolean
}

export type RemoteSyncMetadata = {
  revision?: Revision
  updatedAt?: string
}
