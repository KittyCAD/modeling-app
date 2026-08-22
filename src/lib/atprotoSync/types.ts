import type { ProjectManifest, RemoteProject } from '@src/lib/cloudSync/types'

export const ATPROTO_CAD_PROJECT_COLLECTION = 'nyc.noirot.cad.project'
export const ATPROTO_CAD_ARCHIVE_COLLECTION = 'nyc.noirot.cad.archive'

export type AtprotoStrongRef = {
  uri: string
  cid: string
}

export type AtprotoBlobRef = {
  $type?: 'blob'
  ref?:
    | string
    | {
        $link: string
      }
  mimeType?: string
  size?: number
  [key: string]: unknown
}

export type AtprotoRepoRecord<Value> = {
  uri: string
  cid: string
  value: Value
}

export type AtprotoArchiveManifestEntry = {
  path: string
  byteSize: number
  sha256: string
}

export type AtprotoArchiveManifest = {
  files: AtprotoArchiveManifestEntry[]
}

export type AtprotoCadProjectRecord = {
  title: string
  createdAt: string
  description?: string
  updatedAt?: string
  syncUpdatedAt?: string
  categoryIds?: string[]
  headArchive?: AtprotoStrongRef
  [key: string]: unknown
}

export type AtprotoCadArchiveRecord = {
  project: AtprotoStrongRef
  archiveBlob: AtprotoBlobRef
  archiveSha256: string
  archiveByteSize: number
  entrypointPath: string
  projectTomlPath: string
  createdAt: string
  manifest?: AtprotoArchiveManifest
  zdsSchemaVersion?: number
  source?: string
  [key: string]: unknown
}

export type AtprotoRemoteProject = RemoteProject & {
  id: string
  revision: string
  description: string
  category_ids: string[]
  atproto: {
    project: AtprotoStrongRef
    headArchive: AtprotoStrongRef
  }
}

export type AtprotoProjectUploadRecords = {
  project: AtprotoCadProjectRecord
  archive: AtprotoCadArchiveRecord
  manifest?: ProjectManifest
}
