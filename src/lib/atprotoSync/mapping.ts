import { normalizeRelativePath } from '@src/lib/cloudSync/paths'
import { toArrayBuffer } from '@src/lib/cloudSync/projectArchive'
import type {
  ProjectManifest,
  ProjectUploadBody,
} from '@src/lib/cloudSync/types'
import {
  ATPROTO_CAD_ARCHIVE_COLLECTION,
  ATPROTO_CAD_PROJECT_COLLECTION,
  type AtprotoArchiveManifest,
  type AtprotoBlobRef,
  type AtprotoCadArchiveRecord,
  type AtprotoCadProjectRecord,
  type AtprotoProjectUploadRecords,
  type AtprotoRemoteProject,
  type AtprotoRepoRecord,
  type AtprotoStrongRef,
} from '@src/lib/atprotoSync/types'
import { isArray } from '@src/lib/utils'

const ZDS_ARCHIVE_SCHEMA_VERSION = 1

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isAtprotoStrongRef(value: unknown): value is AtprotoStrongRef {
  if (!value || typeof value !== 'object') {
    return false
  }
  const ref = value as Partial<AtprotoStrongRef>
  return isString(ref.uri) && isString(ref.cid)
}

function normalizeSha256(value: unknown) {
  return typeof value === 'string' ? value.toLowerCase() : undefined
}

function asStringArray(value: unknown) {
  if (!isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string')
}

export function isAtprotoProjectSyncCapable(project: AtprotoCadProjectRecord) {
  return isAtprotoStrongRef(project.headArchive)
}

function projectRecordDisplayTitle(project: AtprotoCadProjectRecord) {
  const title = project.title?.trim()
  if (title) {
    return title
  }

  const name = project.name
  return typeof name === 'string' && name.trim() ? name.trim() : undefined
}

export function atprotoProjectRecordToRemoteProject(
  record: AtprotoRepoRecord<AtprotoCadProjectRecord>
): AtprotoRemoteProject | undefined {
  const headArchive = record.value.headArchive
  if (!isAtprotoStrongRef(headArchive)) {
    return undefined
  }

  return {
    id: record.uri,
    title: projectRecordDisplayTitle(record.value),
    updated_at:
      record.value.syncUpdatedAt ||
      record.value.updatedAt ||
      record.value.createdAt,
    revision: record.cid,
    description:
      typeof record.value.description === 'string'
        ? record.value.description
        : '',
    category_ids: asStringArray(record.value.categoryIds),
    atproto: {
      project: {
        uri: record.uri,
        cid: record.cid,
      },
      headArchive,
    },
  }
}

export function projectManifestToAtprotoArchiveManifest(
  manifest: ProjectManifest
): AtprotoArchiveManifest {
  return {
    files: Object.entries(manifest.files)
      .map(([path, entry]) => ({
        path: normalizeRelativePath(path),
        byteSize: entry.byteSize,
        sha256: entry.sha256.toLowerCase(),
      }))
      .toSorted((left, right) => left.path.localeCompare(right.path)),
  }
}

export function atprotoArchiveManifestToProjectManifest(
  manifest: AtprotoArchiveManifest | undefined
): ProjectManifest | undefined {
  if (!manifest) {
    return undefined
  }

  const files: ProjectManifest['files'] = {}
  for (const file of manifest.files) {
    const sha256 = normalizeSha256(file.sha256)
    if (!sha256) {
      continue
    }
    files[normalizeRelativePath(file.path)] = {
      byteSize: file.byteSize,
      sha256,
    }
  }
  return { files }
}

export function projectUploadBodyFromAtprotoRecords(
  project: AtprotoCadProjectRecord,
  archive: AtprotoCadArchiveRecord,
  expectedRevision?: string
): ProjectUploadBody {
  const body: ProjectUploadBody = {
    title: project.title,
    description:
      typeof project.description === 'string' ? project.description : '',
    category_ids: asStringArray(project.categoryIds),
    entrypoint_path: archive.entrypointPath,
    project_toml_path: archive.projectTomlPath,
  }
  if (expectedRevision) {
    body.expected_revision = expectedRevision
  }
  return body
}

export function projectRecordFromUploadBody(
  body: ProjectUploadBody,
  now: string,
  headArchive?: AtprotoStrongRef
): AtprotoCadProjectRecord {
  return {
    $type: ATPROTO_CAD_PROJECT_COLLECTION,
    title: body.title,
    description: body.description,
    categoryIds: body.category_ids,
    createdAt: now,
    updatedAt: now,
    syncUpdatedAt: now,
    ...(headArchive ? { headArchive } : {}),
  }
}

export async function atprotoArchiveRecordFromUploadBody({
  project,
  body,
  archiveBlob,
  archiveBytes,
  manifest,
  createdAt,
  source,
}: {
  project: AtprotoStrongRef
  body: ProjectUploadBody
  archiveBlob: AtprotoBlobRef
  archiveBytes: ArrayBuffer | Uint8Array
  manifest?: ProjectManifest
  createdAt: string
  source?: string
}): Promise<AtprotoCadArchiveRecord> {
  const bytes =
    archiveBytes instanceof Uint8Array
      ? archiveBytes
      : new Uint8Array(archiveBytes)

  return {
    $type: ATPROTO_CAD_ARCHIVE_COLLECTION,
    project,
    archiveBlob,
    archiveSha256: await sha256Hex(bytes),
    archiveByteSize: bytes.byteLength,
    entrypointPath: normalizeRelativePath(body.entrypoint_path),
    projectTomlPath: normalizeRelativePath(body.project_toml_path),
    createdAt,
    zdsSchemaVersion: ZDS_ARCHIVE_SCHEMA_VERSION,
    ...(manifest
      ? { manifest: projectManifestToAtprotoArchiveManifest(manifest) }
      : {}),
    ...(source ? { source } : {}),
  }
}

export function atprotoUploadRecordsToProjectManifest(
  records: Pick<AtprotoProjectUploadRecords, 'archive'>
) {
  return atprotoArchiveManifestToProjectManifest(records.archive.manifest)
}

async function sha256Hex(data: Uint8Array) {
  if (globalThis.crypto?.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest(
      'SHA-256',
      toArrayBuffer(data)
    )
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  let hash = 2166136261
  for (const byte of data) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(64, '0')
}
