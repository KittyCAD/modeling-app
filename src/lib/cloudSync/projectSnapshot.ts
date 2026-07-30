import {
  isCloudSyncExcludedPath,
  normalizeRelativePath,
} from '@src/lib/cloudSync/paths'
import {
  normalizeProjectArchiveFilesForCloudSync,
  projectManifestFromFiles,
} from '@src/lib/cloudSync/projectArchive'
import { recordCloudSyncDiagnosticEvent } from '@src/lib/cloudSync/diagnostics'
import type {
  ProjectArchiveFile,
  ProjectManifest,
} from '@src/lib/cloudSync/types'
import {
  PROJECT_ENTRYPOINT,
  PROJECT_IMAGE_NAME,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import {
  createGitignoreStackFromFiles,
  isPathIgnoredByGitignore,
} from '@src/lib/gitignore'
import {
  getProjectDefaultFileFromProjectTomlContents,
  normalizeProjectTomlContentsForCloudSyncSnapshot,
} from '@src/lib/projectTomlMetadata'
import { webSafePathSplit } from '@src/lib/pathUtils'

export type CloudSyncSnapshotAnnotationKind =
  | 'excluded-generated-thumbnail'
  | 'excluded-generated-gitignore'
  | 'ignored-by-gitignore'
  | 'normalized-project-toml'
  | 'neutralized-generated-gitignore'
  | 'synthesized-default-file'
  | 'remote-entrypoint-equivalent'

export type CloudSyncSnapshotAnnotation = {
  path: string
  kind: CloudSyncSnapshotAnnotationKind
  detail?: string
}

export type CloudSyncProjectSnapshot = {
  rawFiles: ProjectArchiveFile[]
  uploadFiles: ProjectArchiveFile[]
  syncFiles: ProjectArchiveFile[]
  manifest: ProjectManifest
  annotations: CloudSyncSnapshotAnnotation[]
  projectToml?: {
    rawText?: string
    canonicalText?: string
    defaultFile?: string
    effectiveEntrypoint?: string
    defaultFileEquivalentToEntrypoint: boolean
  }
}

export type CloudSyncProjectSnapshotOptions = {
  source: 'local' | 'remote' | 'upload' | 'conflict' | 'test'
  projectPath?: string
  remoteProjectId?: string
  entrypointPath?: string
}

export type ProjectManifestChangedPath = {
  path: string
  status: 'changed' | 'left-only' | 'right-only'
}

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

function fileNameFromRelativePath(relativePath: string) {
  return webSafePathSplit(normalizeRelativePath(relativePath)).at(-1) || ''
}

function isGeneratedThumbnailPath(relativePath: string) {
  return normalizeRelativePath(relativePath) === PROJECT_IMAGE_NAME
}

export function isCloudSyncGeneratedArtifactRelativePath(relativePath: string) {
  return isGeneratedThumbnailPath(relativePath)
}

function isGeneratedThumbnailGitignore(contents: string) {
  return contents.replace(/\r\n/g, '\n').trim() === PROJECT_IMAGE_NAME
}

export function isCloudSyncGeneratedThumbnailGitignoreContents(
  contents: string
) {
  return isGeneratedThumbnailGitignore(contents)
}

function normalizeGitignoreContentsForSnapshot(contents: string) {
  const nextLines = contents
    .split(/\r?\n/g)
    .filter((line) => line.trim() !== PROJECT_IMAGE_NAME)
  const normalized = nextLines.join('\n').trim()

  return normalized ? `${normalized}\n` : ''
}

function getProjectTomlDefaultFile(files: ProjectArchiveFile[]) {
  const projectTomlFile = files.find(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  if (!projectTomlFile) {
    return undefined
  }

  return getProjectDefaultFileFromProjectTomlContents(
    textDecoder.decode(projectTomlFile.data)
  )
}

export function getCloudSyncProjectEntrypointPath(
  files: ProjectArchiveFile[],
  preferredEntrypointPath?: string
) {
  const normalizedPreferredEntrypointPath = preferredEntrypointPath
    ? normalizeRelativePath(preferredEntrypointPath)
    : undefined
  if (normalizedPreferredEntrypointPath) {
    return normalizedPreferredEntrypointPath
  }

  const normalizedFiles = normalizeProjectArchiveFilesForCloudSync(files)
  const filePaths = new Set(normalizedFiles.map((file) => file.relativePath))
  const projectTomlDefaultFile = getProjectTomlDefaultFile(normalizedFiles)
  if (projectTomlDefaultFile && filePaths.has(projectTomlDefaultFile)) {
    return projectTomlDefaultFile
  }
  if (filePaths.has(PROJECT_ENTRYPOINT)) {
    return PROJECT_ENTRYPOINT
  }

  return normalizedFiles
    .map((file) => file.relativePath)
    .filter((relativePath) => relativePath.toLowerCase().endsWith('.kcl'))
    .toSorted((a, b) => a.localeCompare(b))[0]
}

function cloudSyncProjectFilesForUpload(files: ProjectArchiveFile[]) {
  const normalizedFiles = normalizeProjectArchiveFilesForCloudSync(files)
  const annotations: CloudSyncSnapshotAnnotation[] = []
  const gitignoreStack = createGitignoreStackFromFiles(
    normalizedFiles
      .filter(
        (file) => fileNameFromRelativePath(file.relativePath) === '.gitignore'
      )
      .map((file) => ({
        relativePath: file.relativePath,
        contents: textDecoder.decode(file.data),
      }))
  )
  const uploadFiles: ProjectArchiveFile[] = []

  for (const file of normalizedFiles) {
    if (isCloudSyncExcludedPath(file.relativePath)) {
      continue
    }
    if (isGeneratedThumbnailPath(file.relativePath)) {
      annotations.push({
        path: file.relativePath,
        kind: 'excluded-generated-thumbnail',
      })
      continue
    }
    if (
      fileNameFromRelativePath(file.relativePath) === '.gitignore' &&
      isGeneratedThumbnailGitignore(textDecoder.decode(file.data))
    ) {
      annotations.push({
        path: file.relativePath,
        kind: 'excluded-generated-gitignore',
      })
      continue
    }
    if (isPathIgnoredByGitignore(gitignoreStack, file.relativePath, false)) {
      annotations.push({
        path: file.relativePath,
        kind: 'ignored-by-gitignore',
      })
      continue
    }

    uploadFiles.push(file)
  }

  return {
    uploadFiles,
    rawFiles: normalizedFiles,
    annotations,
  }
}

export function filterCloudSyncProjectFilesForSync(
  files: ProjectArchiveFile[]
) {
  return cloudSyncProjectFilesForUpload(files).uploadFiles
}

function addOrReplaceFile(
  files: ProjectArchiveFile[],
  relativePath: string,
  contents: string
) {
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  const file = {
    relativePath: normalizedRelativePath,
    data: textEncoder.encode(contents),
  }
  const existingIndex = files.findIndex(
    (candidate) => candidate.relativePath === normalizedRelativePath
  )
  if (existingIndex === -1) {
    files.push(file)
  } else {
    files[existingIndex] = file
  }
}

function canonicalizeProjectTomlFile({
  file,
  effectiveEntrypoint,
  annotations,
}: {
  file: ProjectArchiveFile
  effectiveEntrypoint?: string
  annotations: CloudSyncSnapshotAnnotation[]
}) {
  const rawText = textDecoder.decode(file.data)
  const normalized = normalizeProjectTomlContentsForCloudSyncSnapshot(rawText, {
    entrypointPath: effectiveEntrypoint,
  })
  if (normalized.contents !== rawText) {
    annotations.push({
      path: file.relativePath,
      kind: 'normalized-project-toml',
    })
  }
  if (normalized.defaultFileSynthesized) {
    annotations.push({
      path: file.relativePath,
      kind: 'synthesized-default-file',
      detail: normalized.effectiveEntrypointPath,
    })
  } else if (normalized.defaultFileMatchesEffectiveEntrypoint) {
    annotations.push({
      path: file.relativePath,
      kind: 'remote-entrypoint-equivalent',
      detail: normalized.effectiveEntrypointPath,
    })
  }

  return {
    file: {
      ...file,
      data: textEncoder.encode(normalized.contents),
    },
    projectToml: {
      rawText,
      canonicalText: normalized.contents,
      defaultFile: normalized.defaultFile,
      effectiveEntrypoint: normalized.effectiveEntrypointPath,
      defaultFileEquivalentToEntrypoint:
        normalized.defaultFileMatchesEffectiveEntrypoint,
    },
  }
}

function canonicalizeGitignoreFile(
  file: ProjectArchiveFile,
  annotations: CloudSyncSnapshotAnnotation[]
) {
  const rawText = textDecoder.decode(file.data)
  const normalizedText = normalizeGitignoreContentsForSnapshot(rawText)
  if (normalizedText === rawText) {
    return file
  }
  annotations.push({
    path: file.relativePath,
    kind: 'neutralized-generated-gitignore',
  })
  if (!normalizedText) {
    return undefined
  }
  return {
    ...file,
    data: textEncoder.encode(normalizedText),
  }
}

export async function createCloudSyncProjectSnapshot(
  files: ProjectArchiveFile[],
  options: CloudSyncProjectSnapshotOptions
): Promise<CloudSyncProjectSnapshot> {
  const { rawFiles, uploadFiles, annotations } =
    cloudSyncProjectFilesForUpload(files)
  const effectiveEntrypoint = getCloudSyncProjectEntrypointPath(
    uploadFiles,
    options.entrypointPath
  )
  const syncFiles: ProjectArchiveFile[] = []
  let projectToml: CloudSyncProjectSnapshot['projectToml']

  for (const file of uploadFiles) {
    if (file.relativePath === PROJECT_SETTINGS_FILE_NAME) {
      const canonicalized = canonicalizeProjectTomlFile({
        file,
        effectiveEntrypoint,
        annotations,
      })
      syncFiles.push(canonicalized.file)
      projectToml = canonicalized.projectToml
      continue
    }
    if (fileNameFromRelativePath(file.relativePath) === '.gitignore') {
      const canonicalized = canonicalizeGitignoreFile(file, annotations)
      if (canonicalized) {
        syncFiles.push(canonicalized)
      }
      continue
    }

    syncFiles.push(file)
  }

  if (!projectToml && effectiveEntrypoint) {
    const normalized = normalizeProjectTomlContentsForCloudSyncSnapshot('', {
      entrypointPath: effectiveEntrypoint,
    })
    addOrReplaceFile(syncFiles, PROJECT_SETTINGS_FILE_NAME, normalized.contents)
    annotations.push({
      path: PROJECT_SETTINGS_FILE_NAME,
      kind: 'synthesized-default-file',
      detail: effectiveEntrypoint,
    })
    projectToml = {
      rawText: undefined,
      canonicalText: normalized.contents,
      defaultFile: undefined,
      effectiveEntrypoint: normalized.effectiveEntrypointPath,
      defaultFileEquivalentToEntrypoint: false,
    }
  }

  syncFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const manifest = await projectManifestFromFiles(syncFiles)
  recordCloudSyncDiagnosticEvent({
    type: 'snapshot-built',
    source: options.source,
    projectPath: options.projectPath,
    remoteProjectId: options.remoteProjectId,
    rawFileCount: rawFiles.length,
    uploadFileCount: uploadFiles.length,
    syncFileCount: syncFiles.length,
    effectiveEntrypoint,
    annotations,
  })

  return {
    rawFiles,
    uploadFiles,
    syncFiles,
    manifest,
    annotations,
    projectToml,
  }
}

export function getProjectManifestChangedPaths(
  left: ProjectManifest | undefined,
  right: ProjectManifest | undefined
): ProjectManifestChangedPath[] {
  if (!left || !right) {
    return []
  }

  const paths = new Set([
    ...Object.keys(left.files),
    ...Object.keys(right.files),
  ])
  return Array.from(paths)
    .toSorted((a, b) => a.localeCompare(b))
    .flatMap((path): ProjectManifestChangedPath[] => {
      const leftEntry = left.files[path]
      const rightEntry = right.files[path]
      if (!leftEntry) {
        return [{ path, status: 'right-only' }]
      }
      if (!rightEntry) {
        return [{ path, status: 'left-only' }]
      }
      if (
        leftEntry.byteSize === rightEntry.byteSize &&
        leftEntry.sha256 === rightEntry.sha256
      ) {
        return []
      }
      return [{ path, status: 'changed' }]
    })
}
