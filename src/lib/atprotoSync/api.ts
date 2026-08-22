import {
  parseProjectArchive,
  prepareProjectFilesForCloudUpload,
  projectManifestFromFiles,
  toArrayBuffer,
} from '@src/lib/cloudSync/projectArchive'
import type {
  ProjectArchiveFile,
  RemoteProject,
  RemoteProjectSummary,
  Revision,
} from '@src/lib/cloudSync/types'
import {
  atprotoArchiveRecordFromUploadBody,
  atprotoProjectRecordToRemoteProject,
  projectRecordFromUploadBody,
} from '@src/lib/atprotoSync/mapping'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { getProjectTitleFromProjectTomlContents } from '@src/lib/projectTomlMetadata'
import {
  ATPROTO_CAD_ARCHIVE_COLLECTION,
  ATPROTO_CAD_PROJECT_COLLECTION,
  type AtprotoBlobRef,
  type AtprotoCadArchiveRecord,
  type AtprotoCadProjectRecord,
  type AtprotoRemoteProject,
  type AtprotoRepoRecord,
  type AtprotoRepoWriteResult,
  type AtprotoStrongRef,
} from '@src/lib/atprotoSync/types'
import JSZip from 'jszip'

export class AtprotoSyncApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AtprotoSyncApiError'
  }
}

export class AtprotoSyncStaleRevisionError extends AtprotoSyncApiError {
  expectedRevision?: string
  currentRevision?: string

  constructor(options: {
    expectedRevision?: string
    currentRevision?: string
  }) {
    super('ATProto project revision changed before the guarded update.')
    this.name = 'AtprotoSyncStaleRevisionError'
    this.expectedRevision = options.expectedRevision
    this.currentRevision = options.currentRevision
  }
}

export const DEFAULT_ATPROTO_ARCHIVE_RETENTION_LIMIT = 20

export type AtprotoParsedUri = {
  repo: string
  collection: string
  rkey: string
}

export type AtprotoRecordWriteInput<Value> = {
  repo: string
  collection: string
  rkey: string
  record: Value
  /**
   * Mirrors com.atproto.repo.putRecord.swapRecord.
   *
   * A string requests compare-and-swap against that previous record CID.
   * New-record writes omit this field for broad PDS compatibility.
   */
  swapRecord?: string
}

export type AtprotoRecordDeleteInput = {
  repo: string
  collection: string
  rkey: string
}

export interface AtprotoCadSyncClient {
  listRecords<Value>(input: {
    repo: string
    collection: string
  }): Promise<AtprotoRepoRecord<Value>[]>
  getRecord<Value>(input: {
    repo: string
    collection: string
    rkey: string
  }): Promise<AtprotoRepoRecord<Value>>
  putRecord<Value>(
    input: AtprotoRecordWriteInput<Value>
  ): Promise<AtprotoRepoWriteResult>
  deleteRecord(input: AtprotoRecordDeleteInput): Promise<void>
  uploadBlob(input: {
    repo: string
    bytes: Uint8Array
    contentType: string
  }): Promise<AtprotoBlobRef>
  getBlob(input: { repo: string; blob: AtprotoBlobRef }): Promise<ArrayBuffer>
}

export type AtprotoProjectApiConfig = {
  repo: string
  client: AtprotoCadSyncClient
  now?: () => string
  createRecordKey?: () => string
  source?: string
  /**
   * Maximum number of archive snapshot records to keep per project. The current
   * head archive counts toward the limit. Defaults to 20.
   */
  archiveRetentionLimit?: number
}

let generatedRecordKeyCounter = 0

export function parseAtprotoUri(uri: string): AtprotoParsedUri {
  const match = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (!match) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new AtprotoSyncApiError(`Invalid ATProto record URI: ${uri}`)
  }

  return {
    repo: match[1],
    collection: match[2],
    rkey: match[3],
  }
}

export async function listAtprotoRemoteProjects(
  config: AtprotoProjectApiConfig
): Promise<RemoteProjectSummary[]> {
  const records = await config.client.listRecords<AtprotoCadProjectRecord>({
    repo: config.repo,
    collection: ATPROTO_CAD_PROJECT_COLLECTION,
  })

  const remoteProjects = records.flatMap((record) => {
    const remoteProject = atprotoProjectRecordToRemoteProject(record)
    return remoteProject ? [remoteProject] : []
  })
  return Promise.all(
    remoteProjects.map((remoteProject) =>
      withArchiveTitleFallback(config, remoteProject)
    )
  )
}

export async function getAtprotoRemoteProject(
  config: AtprotoProjectApiConfig,
  projectId: string
): Promise<RemoteProject> {
  return getAtprotoRemoteProjectRecord(config, projectId).then((record) =>
    withArchiveTitleFallback(config, remoteProjectFromRecord(record))
  )
}

export async function downloadAtprotoRemoteProjectArchive(
  config: AtprotoProjectApiConfig,
  projectId: string
): Promise<ArrayBuffer> {
  const projectRecord = await getAtprotoRemoteProjectRecord(config, projectId)
  const remoteProject = remoteProjectFromRecord(projectRecord)
  const archiveRecord = await getAtprotoArchiveRecord(
    config,
    remoteProject.atproto.headArchive
  )

  return config.client.getBlob({
    repo: parseAtprotoUri(archiveRecord.uri).repo,
    blob: archiveRecord.value.archiveBlob,
  })
}

export async function createAtprotoRemoteProject(
  config: AtprotoProjectApiConfig,
  projectPath: string,
  files: ProjectArchiveFile[]
): Promise<RemoteProject> {
  const createdAt = now(config)
  const uploadPayload = prepareProjectFilesForCloudUpload(projectPath, files, {
    publicationMetadata: {
      description: '',
      category_ids: [],
    },
  })
  const archiveBytes = await buildProjectArchiveZip(uploadPayload.files)
  const archiveBlob = await config.client.uploadBlob({
    repo: config.repo,
    bytes: archiveBytes,
    contentType: 'application/zip',
  })

  const projectRkey = newRecordKey(config)
  const initialProjectRecord = projectRecordFromUploadBody(
    uploadPayload.body,
    createdAt
  )
  const initialProject = await config.client.putRecord({
    repo: config.repo,
    collection: ATPROTO_CAD_PROJECT_COLLECTION,
    rkey: projectRkey,
    record: initialProjectRecord,
  })
  const archive = await createArchiveRecord({
    config,
    project: {
      uri: initialProject.uri,
      cid: initialProject.cid,
    },
    body: uploadPayload.body,
    files: uploadPayload.files,
    archiveBlob,
    archiveBytes,
    createdAt,
  })
  const archiveRef = recordRef(archive)
  const finalProjectRecord: AtprotoCadProjectRecord = {
    ...initialProjectRecord,
    headArchive: archiveRef,
    updatedAt: createdAt,
    syncUpdatedAt: createdAt,
  }
  const finalProject = await config.client.putRecord({
    repo: config.repo,
    collection: ATPROTO_CAD_PROJECT_COLLECTION,
    rkey: projectRkey,
    record: finalProjectRecord,
    swapRecord: initialProject.cid,
  })
  await pruneAtprotoProjectArchives(config, {
    projectUri: finalProject.uri,
    headArchive: archiveRef,
  }).catch(() => undefined)

  return remoteProjectFromRecord({
    uri: finalProject.uri,
    cid: finalProject.cid,
    value: finalProjectRecord,
  })
}

export async function updateAtprotoRemoteProject({
  config,
  projectPath,
  project,
  files,
  expectedRevision,
  entrypointPath,
}: {
  config: AtprotoProjectApiConfig
  projectPath: string
  project: RemoteProject
  files: ProjectArchiveFile[]
  expectedRevision?: Revision
  entrypointPath?: string
}): Promise<RemoteProject> {
  const parsedProjectUri = parseAtprotoUri(project.id)
  const currentProject =
    await config.client.getRecord<AtprotoCadProjectRecord>(parsedProjectUri)
  const revision = expectedRevision ?? currentProject.cid
  if (expectedRevision && currentProject.cid !== expectedRevision) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new AtprotoSyncStaleRevisionError({
      expectedRevision,
      currentRevision: currentProject.cid,
    })
  }

  const updatedAt = now(config)
  const uploadPayload = prepareProjectFilesForCloudUpload(projectPath, files, {
    expectedRevision,
    entrypointPath,
    publicationMetadata: {
      description:
        typeof project.description === 'string' ? project.description : '',
      category_ids: remoteProjectCategoryIds(project),
    },
  })
  const archiveBytes = await buildProjectArchiveZip(uploadPayload.files)
  const archiveBlob = await config.client.uploadBlob({
    repo: parsedProjectUri.repo,
    bytes: archiveBytes,
    contentType: 'application/zip',
  })
  const archive = await createArchiveRecord({
    config,
    project: {
      uri: currentProject.uri,
      cid: currentProject.cid,
    },
    body: uploadPayload.body,
    files: uploadPayload.files,
    archiveBlob,
    archiveBytes,
    createdAt: updatedAt,
  })
  const finalProjectRecord: AtprotoCadProjectRecord = {
    ...currentProject.value,
    title: uploadPayload.body.title,
    description: uploadPayload.body.description,
    categoryIds: uploadPayload.body.category_ids,
    headArchive: recordRef(archive),
    updatedAt,
    syncUpdatedAt: updatedAt,
  }
  const finalProject = await config.client.putRecord({
    repo: parsedProjectUri.repo,
    collection: parsedProjectUri.collection,
    rkey: parsedProjectUri.rkey,
    record: finalProjectRecord,
    swapRecord: revision,
  })
  await pruneAtprotoProjectArchives(config, {
    projectUri: currentProject.uri,
    headArchive: recordRef(archive),
  }).catch(() => undefined)

  return remoteProjectFromRecord({
    uri: finalProject.uri,
    cid: finalProject.cid,
    value: finalProjectRecord,
  })
}

export async function deleteAtprotoRemoteProject(
  config: AtprotoProjectApiConfig,
  projectId: string
) {
  await config.client.deleteRecord(parseAtprotoUri(projectId))
}

function now(config: AtprotoProjectApiConfig) {
  return config.now?.() ?? new Date().toISOString()
}

function newRecordKey(config: AtprotoProjectApiConfig) {
  return config.createRecordKey?.() ?? newTidLikeRecordKey()
}

function recordRef(record: AtprotoRepoWriteResult): AtprotoStrongRef {
  return {
    uri: record.uri,
    cid: record.cid,
  }
}

async function getAtprotoRemoteProjectRecord(
  config: AtprotoProjectApiConfig,
  projectId: string
) {
  const parsed = parseAtprotoUri(projectId)
  return config.client.getRecord<AtprotoCadProjectRecord>(parsed)
}

async function getAtprotoArchiveRecord(
  config: AtprotoProjectApiConfig,
  archiveRef: AtprotoStrongRef
) {
  const parsed = parseAtprotoUri(archiveRef.uri)
  const archiveRecord =
    await config.client.getRecord<AtprotoCadArchiveRecord>(parsed)
  if (archiveRecord.cid !== archiveRef.cid) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new AtprotoSyncApiError(
      `Archive record CID changed for ${archiveRef.uri}.`
    )
  }
  return archiveRecord
}

function remoteProjectFromRecord(
  record: AtprotoRepoRecord<AtprotoCadProjectRecord>
): AtprotoRemoteProject {
  const remoteProject = atprotoProjectRecordToRemoteProject(record)
  if (!remoteProject) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new AtprotoSyncApiError(
      `ATProto project ${record.uri} is missing headArchive.`
    )
  }
  return remoteProject
}

function archiveRetentionLimit(config: AtprotoProjectApiConfig) {
  const configured = config.archiveRetentionLimit
  if (
    typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return Math.floor(configured)
  }

  return DEFAULT_ATPROTO_ARCHIVE_RETENTION_LIMIT
}

function archiveCreatedAtMs(
  record: AtprotoRepoRecord<AtprotoCadArchiveRecord>
) {
  const createdAtMs = Date.parse(record.value.createdAt)
  return Number.isFinite(createdAtMs) ? createdAtMs : 0
}

function archiveSortKey(record: AtprotoRepoRecord<AtprotoCadArchiveRecord>) {
  return `${archiveCreatedAtMs(record).toString().padStart(16, '0')}:${record.uri}`
}

function isProjectArchiveRecord(
  record: AtprotoRepoRecord<AtprotoCadArchiveRecord>,
  projectUri: string
) {
  return record.value.project.uri === projectUri
}

async function pruneAtprotoProjectArchives(
  config: AtprotoProjectApiConfig,
  {
    projectUri,
    headArchive,
  }: {
    projectUri: string
    headArchive: AtprotoStrongRef
  }
) {
  const limit = archiveRetentionLimit(config)
  const archiveRecords = (
    await config.client.listRecords<AtprotoCadArchiveRecord>({
      repo: config.repo,
      collection: ATPROTO_CAD_ARCHIVE_COLLECTION,
    })
  )
    .filter((record) => isProjectArchiveRecord(record, projectUri))
    .toSorted((left, right) =>
      archiveSortKey(right).localeCompare(archiveSortKey(left))
    )

  const retainedUris = new Set<string>([headArchive.uri])
  for (const record of archiveRecords) {
    if (retainedUris.size >= limit) {
      break
    }
    retainedUris.add(record.uri)
  }

  for (const record of archiveRecords) {
    if (retainedUris.has(record.uri)) {
      continue
    }
    await config.client.deleteRecord(parseAtprotoUri(record.uri))
  }
}

function hasHumanProjectTitle(project: RemoteProjectSummary) {
  return Boolean(
    typeof project.title === 'string' &&
      project.title.trim() &&
      !project.title.trim().startsWith('at://')
  )
}

async function withArchiveTitleFallback(
  config: AtprotoProjectApiConfig,
  remoteProject: AtprotoRemoteProject
): Promise<AtprotoRemoteProject> {
  if (hasHumanProjectTitle(remoteProject)) {
    return remoteProject
  }

  const title = await readArchiveProjectTitle(config, remoteProject).catch(
    () => undefined
  )
  return title ? { ...remoteProject, title } : remoteProject
}

async function readArchiveProjectTitle(
  config: AtprotoProjectApiConfig,
  remoteProject: AtprotoRemoteProject
) {
  const archiveRecord = await getAtprotoArchiveRecord(
    config,
    remoteProject.atproto.headArchive
  )
  const archiveBytes = await config.client.getBlob({
    repo: parseAtprotoUri(archiveRecord.uri).repo,
    blob: archiveRecord.value.archiveBlob,
  })
  const files = await parseProjectArchive(archiveBytes)
  const projectToml = files.find(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  if (!projectToml) {
    return undefined
  }

  return getProjectTitleFromProjectTomlContents(
    new TextDecoder().decode(projectToml.data)
  )?.trim()
}

async function createArchiveRecord({
  config,
  project,
  body,
  files,
  archiveBlob,
  archiveBytes,
  createdAt,
}: {
  config: AtprotoProjectApiConfig
  project: AtprotoStrongRef
  body: ReturnType<typeof prepareProjectFilesForCloudUpload>['body']
  files: ProjectArchiveFile[]
  archiveBlob: AtprotoBlobRef
  archiveBytes: Uint8Array
  createdAt: string
}) {
  const archive = await atprotoArchiveRecordFromUploadBody({
    project,
    body,
    archiveBlob,
    archiveBytes,
    manifest: await projectManifestFromFiles(files),
    createdAt,
    source: config.source,
  })

  return config.client.putRecord({
    repo: parseAtprotoUri(project.uri).repo,
    collection: ATPROTO_CAD_ARCHIVE_COLLECTION,
    rkey: newRecordKey(config),
    record: archive,
  })
}

function remoteProjectCategoryIds(project: RemoteProject) {
  if (!Array.isArray(project.category_ids)) {
    return []
  }
  return project.category_ids.filter(
    (categoryId): categoryId is string => typeof categoryId === 'string'
  )
}

async function buildProjectArchiveZip(files: ProjectArchiveFile[]) {
  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.relativePath, toArrayBuffer(file.data))
  }
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
  })
}

function newTidLikeRecordKey() {
  const alphabet = '234567abcdefghijklmnopqrstuvwxyz'
  let value =
    BigInt(Date.now()) * 4096n +
    BigInt((generatedRecordKeyCounter = (generatedRecordKeyCounter + 1) % 4096))
  let key = ''

  while (value > 0n) {
    key = alphabet[Number(value % BigInt(alphabet.length))] + key
    value /= BigInt(alphabet.length)
  }

  return key.padStart(13, alphabet[0]).slice(-13)
}
