import {
  isCloudSyncExcludedPath,
  normalizeRelativePath,
} from '@src/lib/cloudSync/paths'
import type {
  ProjectArchiveFile,
  ProjectMetadata,
  Revision,
} from '@src/lib/cloudSync/types'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { getProjectTitleFromProjectTomlContents } from '@src/lib/projectTomlMetadata'

export type ScannedProjectFile = {
  absolutePath: string
  data: Uint8Array
  modifiedAtMs: number
  relativePath: string
  size: number
}

export type ConflictFileStatus = 'changed' | 'local-only' | 'cloud-only'

export type ConflictFileComparison = {
  status: ConflictFileStatus
  relativePath: string
  local?: ScannedProjectFile
  cloud?: ScannedProjectFile
  localText?: string
  cloudText?: string
  textUnavailableReason?: string
}

export type ConflictInspection = {
  projectTitle?: string
  remoteProjectId?: string
  remoteRevision?: Revision
  localSavedAtMs?: number
  cloudSavedAtMs?: number
  changedFiles: ConflictFileComparison[]
}

const MAX_MERGE_TEXT_BYTES = 512 * 1024
const textDecoder = new TextDecoder('utf-8', { fatal: true })

function statIsDirectory(mode: number) {
  return Boolean(mode & fsZdsConstants.S_IFDIR)
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) {
    return false
  }

  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) {
      return false
    }
  }

  return true
}

export function formatFileSize(size: number | undefined) {
  if (size === undefined) {
    return '—'
  }

  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function decodeMergeableText(file: ScannedProjectFile | undefined) {
  if (!file) {
    return ''
  }

  if (file.data.byteLength > MAX_MERGE_TEXT_BYTES) {
    return undefined
  }

  try {
    const text = textDecoder.decode(file.data)
    if (text.includes('\u0000')) {
      return undefined
    }
    return text
  } catch {
    return undefined
  }
}

function getTextUnavailableReason(
  local: ScannedProjectFile | undefined,
  cloud: ScannedProjectFile | undefined,
  localText: string | undefined,
  cloudText: string | undefined
) {
  const largestSize = Math.max(local?.size ?? 0, cloud?.size ?? 0)
  if (largestSize > MAX_MERGE_TEXT_BYTES) {
    return `File is larger than ${formatFileSize(MAX_MERGE_TEXT_BYTES)}.`
  }

  if (localText === undefined || cloudText === undefined) {
    return 'Binary or non-UTF-8 file.'
  }

  return undefined
}

function latestModifiedAt(files: Iterable<ScannedProjectFile>) {
  let latest: number | undefined
  for (const file of files) {
    latest =
      latest === undefined
        ? file.modifiedAtMs
        : Math.max(latest, file.modifiedAtMs)
  }
  return latest
}

function getProjectTitleFromScannedFiles(
  files: Map<string, ScannedProjectFile>
) {
  const projectToml = files.get(PROJECT_SETTINGS_FILE_NAME)
  const projectTomlText = decodeMergeableText(projectToml)
  return projectTomlText
    ? getProjectTitleFromProjectTomlContents(projectTomlText)
    : undefined
}

async function scanProjectFiles(
  projectRoot: string,
  fileSystem: IZooDesignStudioFS = fsZds
) {
  const files = new Map<string, ScannedProjectFile>()

  async function walk(currentPath: string) {
    const entries = (await fileSystem.readdir(currentPath)).toSorted()

    for (const entry of entries) {
      if (isCloudSyncExcludedPath(entry)) {
        continue
      }

      const absolutePath = fileSystem.join(currentPath, entry)
      const stat = await fileSystem.stat(absolutePath)
      if (statIsDirectory(stat.mode)) {
        await walk(absolutePath)
        continue
      }

      const relativePath = normalizeRelativePath(
        fileSystem.relative(projectRoot, absolutePath) ?? ''
      )
      const data = Uint8Array.from(await fileSystem.readFile(absolutePath))
      files.set(relativePath, {
        absolutePath,
        data,
        modifiedAtMs: stat.mtimeMs,
        relativePath,
        size: data.byteLength,
      })
    }
  }

  await walk(projectRoot)
  return files
}

function projectArchiveFilesToScannedFiles(
  files: ProjectArchiveFile[],
  modifiedAtMs: number
) {
  const scannedFiles = new Map<string, ScannedProjectFile>()

  for (const file of files) {
    const relativePath = normalizeRelativePath(file.relativePath)
    scannedFiles.set(relativePath, {
      absolutePath: relativePath,
      data: file.data,
      modifiedAtMs,
      relativePath,
      size: file.data.byteLength,
    })
  }

  return scannedFiles
}

function buildChangedFileComparison({
  relativePath,
  local,
  cloud,
}: {
  relativePath: string
  local?: ScannedProjectFile
  cloud?: ScannedProjectFile
}): ConflictFileComparison | undefined {
  if (local && cloud && bytesEqual(local.data, cloud.data)) {
    return undefined
  }

  const localText = decodeMergeableText(local)
  const cloudText = decodeMergeableText(cloud)

  return {
    status: local && cloud ? 'changed' : local ? 'local-only' : 'cloud-only',
    relativePath,
    local,
    cloud,
    localText,
    cloudText,
    textUnavailableReason: getTextUnavailableReason(
      local,
      cloud,
      localText,
      cloudText
    ),
  }
}

export async function buildConflictInspectionFromCloudFiles({
  projectPath,
  metadata,
  cloudFiles,
  cloudSavedAtMs,
  fileSystem,
  remoteRevision,
}: {
  projectPath: string
  metadata: ProjectMetadata
  cloudFiles: ProjectArchiveFile[]
  cloudSavedAtMs?: number
  fileSystem?: IZooDesignStudioFS
  remoteRevision?: Revision
}): Promise<ConflictInspection | Error> {
  if (!metadata?.conflict) {
    return new Error('Cloud conflict metadata was not found for this project.')
  }

  const cloudModifiedAtMs =
    cloudSavedAtMs ?? Date.parse(metadata.conflict.remoteUpdatedAt ?? '')
  const [localFiles, cloudScannedFiles] = await Promise.all([
    scanProjectFiles(projectPath, fileSystem),
    Promise.resolve(
      projectArchiveFilesToScannedFiles(cloudFiles, cloudModifiedAtMs)
    ),
  ])
  const relativePaths = new Set([
    ...localFiles.keys(),
    ...cloudScannedFiles.keys(),
  ])
  const changedFiles: ConflictFileComparison[] = []

  for (const relativePath of Array.from(relativePaths).toSorted()) {
    const comparison = buildChangedFileComparison({
      relativePath,
      local: localFiles.get(relativePath),
      cloud: cloudScannedFiles.get(relativePath),
    })

    if (comparison) {
      changedFiles.push(comparison)
    }
  }

  return {
    projectTitle:
      getProjectTitleFromScannedFiles(localFiles) ??
      getProjectTitleFromScannedFiles(cloudScannedFiles),
    remoteProjectId: metadata.remoteProjectId,
    remoteRevision,
    localSavedAtMs: latestModifiedAt(localFiles.values()),
    cloudSavedAtMs: cloudModifiedAtMs,
    changedFiles,
  }
}
