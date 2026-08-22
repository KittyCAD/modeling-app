import { createAtprotoCloudSyncRemoteApi } from '@src/lib/atprotoSync/cloudSyncAdapter'
import type {
  AtprotoOAuthConnector,
  AtprotoOAuthIdentity,
} from '@src/lib/atprotoSync/oauth'
import { collectLocalProjectFilesForCloudSync } from '@src/lib/cloudSync/localManifest'
import { ATPROTO_SYNC_META_FILE } from '@src/lib/cloudSync/paths'
import {
  parseProjectArchive,
  projectManifestFromFiles,
  projectManifestsEqual,
  withUpdatedProjectTomlInArchiveFiles,
} from '@src/lib/cloudSync/projectArchive'
import type {
  ProjectArchiveFile,
  ProjectManifest,
  RemoteProjectSummary,
  Revision,
} from '@src/lib/cloudSync/types'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import {
  getAtprotoProjectIdFromProjectTomlContents,
  removeAtprotoProjectIdFromProjectTomlContents,
} from '@src/lib/projectTomlMetadata'

const ATPROTO_SYNC_LOCAL_METADATA_SCHEMA_VERSION = 1

export type AtprotoSyncLocalMetadata = {
  schemaVersion: 1
  remoteProjectId: string
  remoteRevision?: Revision
  remoteUpdatedAt?: string
  baseManifest?: ProjectManifest
  updatedAt: string
}

export class AtprotoSyncRemoteDivergedError extends Error {
  remoteProjectId: string
  baseRevision?: Revision
  remoteRevision?: Revision

  constructor({
    remoteProjectId,
    baseRevision,
    remoteRevision,
  }: {
    remoteProjectId: string
    baseRevision?: Revision
    remoteRevision?: Revision
  }) {
    super(
      'ATProto sync cannot upload local changes because the remote project changed since this local copy was last synced.'
    )
    this.name = 'AtprotoSyncRemoteDivergedError'
    this.remoteProjectId = remoteProjectId
    this.baseRevision = baseRevision
    this.remoteRevision = remoteRevision
  }
}

export class AtprotoSyncMissingBaseError extends Error {
  remoteProjectId: string

  constructor(remoteProjectId: string) {
    super(
      'ATProto sync cannot upload local changes because this local project has no trusted sync base.'
    )
    this.name = 'AtprotoSyncMissingBaseError'
    this.remoteProjectId = remoteProjectId
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProjectManifest(value: unknown): value is ProjectManifest {
  if (!isRecord(value) || !isRecord(value.files)) {
    return false
  }

  return Object.values(value.files).every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.byteSize === 'number' &&
      typeof entry.sha256 === 'string'
  )
}

function normalizeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function getRevision(project: RemoteProjectSummary) {
  return typeof project.revision === 'string' ? project.revision : undefined
}

function getUpdatedAt(project: RemoteProjectSummary) {
  return typeof project.updated_at === 'string' ? project.updated_at : undefined
}

function getAtprotoSyncMetadataPath(projectRoot: string) {
  return fsZds.join(projectRoot, ATPROTO_SYNC_META_FILE)
}

export function removeAtprotoMetadataFromArchiveFiles(
  files: ProjectArchiveFile[]
) {
  return withUpdatedProjectTomlInArchiveFiles(files, (projectToml) =>
    removeAtprotoProjectIdFromProjectTomlContents(projectToml)
  )
}

export async function collectProjectFilesForAtprotoUpload(projectRoot: string) {
  const files = await collectLocalProjectFilesForCloudSync({
    localFs: fsZds,
    projectRoot,
  })

  return removeAtprotoMetadataFromArchiveFiles(files)
}

export async function readAtprotoSyncLocalMetadata(projectRoot: string) {
  const metadataPath = getAtprotoSyncMetadataPath(projectRoot)
  const contents = await fsZds
    .readFile(metadataPath, { encoding: 'utf-8' })
    .catch(() => undefined)
  if (!contents) {
    return undefined
  }

  try {
    const parsed = JSON.parse(contents)
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== ATPROTO_SYNC_LOCAL_METADATA_SCHEMA_VERSION
    ) {
      return undefined
    }
    const remoteProjectId = normalizeString(parsed.remoteProjectId)
    if (!remoteProjectId) {
      return undefined
    }
    const baseManifest = isProjectManifest(parsed.baseManifest)
      ? parsed.baseManifest
      : undefined

    return {
      schemaVersion: ATPROTO_SYNC_LOCAL_METADATA_SCHEMA_VERSION,
      remoteProjectId,
      ...(normalizeString(parsed.remoteRevision)
        ? { remoteRevision: normalizeString(parsed.remoteRevision) }
        : {}),
      ...(normalizeString(parsed.remoteUpdatedAt)
        ? { remoteUpdatedAt: normalizeString(parsed.remoteUpdatedAt) }
        : {}),
      ...(baseManifest ? { baseManifest } : {}),
      updatedAt: normalizeString(parsed.updatedAt) ?? new Date(0).toISOString(),
    } satisfies AtprotoSyncLocalMetadata
  } catch {
    return undefined
  }
}

export async function writeAtprotoSyncLocalMetadata(
  projectRoot: string,
  metadata: Omit<AtprotoSyncLocalMetadata, 'schemaVersion' | 'updatedAt'> &
    Partial<Pick<AtprotoSyncLocalMetadata, 'updatedAt'>>
) {
  await fsZds.writeFile(
    getAtprotoSyncMetadataPath(projectRoot),
    new TextEncoder().encode(
      JSON.stringify(
        {
          schemaVersion: ATPROTO_SYNC_LOCAL_METADATA_SCHEMA_VERSION,
          ...metadata,
          updatedAt: metadata.updatedAt ?? new Date().toISOString(),
        } satisfies AtprotoSyncLocalMetadata,
        null,
        2
      )
    )
  )
}

export async function writeAtprotoSyncBaseMetadata({
  projectRoot,
  remoteProject,
  files,
}: {
  projectRoot: string
  remoteProject: RemoteProjectSummary
  files: ProjectArchiveFile[]
}) {
  await writeAtprotoSyncLocalMetadata(projectRoot, {
    remoteProjectId: remoteProject.id,
    remoteRevision: getRevision(remoteProject),
    remoteUpdatedAt: getUpdatedAt(remoteProject),
    baseManifest: await projectManifestFromFiles(
      removeAtprotoMetadataFromArchiveFiles(files)
    ),
  })
}

async function readAtprotoProjectId(projectRoot: string) {
  const projectTomlPath = fsZds.join(projectRoot, PROJECT_SETTINGS_FILE_NAME)
  const projectToml = await fsZds.readFile(projectTomlPath, {
    encoding: 'utf-8',
  })

  return getAtprotoProjectIdFromProjectTomlContents(projectToml)
}

async function getRemoteBaseManifest({
  remoteApi,
  projectId,
}: {
  remoteApi: ReturnType<typeof createAtprotoCloudSyncRemoteApi>
  projectId: string
}) {
  const remoteFiles = await parseProjectArchive(
    await remoteApi.downloadRemoteProjectArchive({ enabled: true }, projectId)
  )

  return projectManifestFromFiles(
    removeAtprotoMetadataFromArchiveFiles(remoteFiles)
  )
}

async function bootstrapCleanBaseIfPossible({
  projectRoot,
  projectId,
  remoteProject,
  remoteApi,
  localManifest,
}: {
  projectRoot: string
  projectId: string
  remoteProject: RemoteProjectSummary
  remoteApi: ReturnType<typeof createAtprotoCloudSyncRemoteApi>
  localManifest: ProjectManifest
}) {
  const remoteManifest = await getRemoteBaseManifest({
    remoteApi,
    projectId,
  })
  if (!projectManifestsEqual(localManifest, remoteManifest)) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new AtprotoSyncMissingBaseError(projectId)
  }

  await writeAtprotoSyncLocalMetadata(projectRoot, {
    remoteProjectId: projectId,
    remoteRevision: getRevision(remoteProject),
    remoteUpdatedAt: getUpdatedAt(remoteProject),
    baseManifest: remoteManifest,
  })
}

export async function uploadAtprotoLocalProject({
  connector,
  identity,
  projectRoot,
}: {
  connector: AtprotoOAuthConnector
  identity: AtprotoOAuthIdentity
  projectRoot: string
}) {
  if (!connector.createProjectApiConfig) {
    return false
  }

  const remoteProjectId = await readAtprotoProjectId(projectRoot).catch(
    () => undefined
  )
  if (!remoteProjectId) {
    return false
  }

  const atprotoConfig = await connector.createProjectApiConfig(identity)
  const remoteApi = createAtprotoCloudSyncRemoteApi(atprotoConfig)
  const remoteProject = await remoteApi.getRemoteProject(
    { enabled: true },
    remoteProjectId
  )
  const files = await collectProjectFilesForAtprotoUpload(projectRoot)
  const localManifest = await projectManifestFromFiles(files)
  const metadata = await readAtprotoSyncLocalMetadata(projectRoot)

  if (
    !metadata ||
    metadata.remoteProjectId !== remoteProjectId ||
    !metadata.baseManifest
  ) {
    await bootstrapCleanBaseIfPossible({
      projectRoot,
      projectId: remoteProjectId,
      remoteProject,
      remoteApi,
      localManifest,
    })
    return false
  }

  if (projectManifestsEqual(localManifest, metadata.baseManifest)) {
    return false
  }

  const remoteRevision = getRevision(remoteProject)
  if (
    metadata.remoteRevision &&
    remoteRevision &&
    metadata.remoteRevision !== remoteRevision
  ) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new AtprotoSyncRemoteDivergedError({
      remoteProjectId,
      baseRevision: metadata.remoteRevision,
      remoteRevision,
    })
  }

  const updatedRemoteProject = await remoteApi.updateRemoteProject({
    config: { enabled: true },
    projectPath: projectRoot,
    project: remoteProject,
    files,
    expectedRevision: metadata.remoteRevision,
  })
  await writeAtprotoSyncLocalMetadata(projectRoot, {
    remoteProjectId,
    remoteRevision: getRevision(updatedRemoteProject),
    remoteUpdatedAt: getUpdatedAt(updatedRemoteProject),
    baseManifest: localManifest,
  })

  return true
}
