import { posix as archivePaths } from '@chainner/node-path'
import { withCloudFailureContext } from '@src/lib/cloudProjects/runtime/failureContext'
import { normalizeRelativePath } from '@src/lib/cloudProjects/runtime/paths'
import type {
  ProjectArchiveFile,
  ProjectUploadBody,
  ProjectUploadPublicationMetadata,
  Revision,
} from '@src/lib/cloudProjects/runtime/types'
import {
  PROJECT_ENTRYPOINT,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import {
  getProjectDefaultFileFromProjectTomlContents,
  getProjectTitleFromProjectTomlContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import JSZip from 'jszip'

type PrepareProjectFilesForCloudUploadOptions = {
  expectedRevision?: Revision
  entrypointPath?: string
  publicationMetadata?: ProjectUploadPublicationMetadata
  deletedPaths?: string[]
}

export function prepareProjectFilesForCloudUpload(
  projectPath: string,
  files: ProjectArchiveFile[],
  options: PrepareProjectFilesForCloudUploadOptions = {}
) {
  const normalizedFiles = normalizeProjectArchiveFiles(files)
  const entrypointPath = getUploadEntrypointPath(
    normalizedFiles,
    options.entrypointPath
  )
  const projectTomlPath = getUploadProjectTomlPath(normalizedFiles)
  const projectTitle =
    getProjectTomlTitle(normalizedFiles) ||
    archivePaths.basename(
      projectPath.replaceAll('\\', '/').replace(/\/+$/g, '')
    )
  const publicationMetadata = options.publicationMetadata
  const body: ProjectUploadBody = {
    title: projectTitle || 'project',
    description: publicationMetadata?.description ?? '',
    category_ids: publicationMetadata?.category_ids ?? [],
    entrypoint_path: entrypointPath,
    project_toml_path: projectTomlPath,
  }
  if (options.expectedRevision) {
    body.expected_revision = options.expectedRevision
  }
  if (options.deletedPaths?.length) {
    body.deleted_paths = Array.from(
      new Set(options.deletedPaths.map(normalizeRelativePath))
    ).sort()
  }

  return {
    body,
    files: normalizedFiles,
  }
}

export function normalizeProjectArchiveFiles(files: ProjectArchiveFile[]) {
  return files.map((file) => {
    const relativePath = normalizeRelativePath(file.relativePath)
    return {
      ...file,
      relativePath,
      data: file.data,
    }
  })
}

function getUploadProjectTomlPath(files: ProjectArchiveFile[]) {
  const projectTomlFile = files.find(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  if (projectTomlFile) {
    return projectTomlFile.relativePath
  }

  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  throw new Error('Cloud project uploads require an existing project.toml.')
}

function getProjectTomlTitle(files: ProjectArchiveFile[]) {
  const projectTomlFile = files.find(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  if (!projectTomlFile) {
    return undefined
  }

  return getProjectTitleFromProjectTomlContents(
    new TextDecoder().decode(projectTomlFile.data)
  )
}

export function getProjectArchiveEntrypointPath(
  files: ProjectArchiveFile[],
  preferredEntrypointPath?: string
) {
  const filePaths = new Set(files.map((file) => file.relativePath))
  const normalizedPreferredEntrypointPath = preferredEntrypointPath
    ? normalizeRelativePath(preferredEntrypointPath)
    : undefined
  if (
    normalizedPreferredEntrypointPath &&
    filePaths.has(normalizedPreferredEntrypointPath)
  ) {
    return normalizedPreferredEntrypointPath
  }

  const projectTomlDefaultFile = getProjectTomlDefaultFile(files)
  if (projectTomlDefaultFile && filePaths.has(projectTomlDefaultFile)) {
    return projectTomlDefaultFile
  }
  if (filePaths.has(PROJECT_ENTRYPOINT)) {
    return PROJECT_ENTRYPOINT
  }

  const fallbackKclFile = files
    .map((file) => file.relativePath)
    .filter(
      (relativePath) =>
        archivePaths.extname(relativePath).toLowerCase() === '.kcl'
    )
    .toSorted((a, b) => a.localeCompare(b))[0]
  if (fallbackKclFile) {
    return fallbackKclFile
  }

  return undefined
}

function getUploadEntrypointPath(
  files: ProjectArchiveFile[],
  preferredEntrypointPath?: string
) {
  const entrypointPath = getProjectArchiveEntrypointPath(
    files,
    preferredEntrypointPath
  )
  if (entrypointPath) {
    return entrypointPath
  }

  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  throw new Error('Cloud sync needs at least one KCL file to upload a project.')
}

function getProjectTomlDefaultFile(files: ProjectArchiveFile[]) {
  const projectTomlFile = files.find(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  if (!projectTomlFile) {
    return undefined
  }

  return getProjectDefaultFileFromProjectTomlContents(
    new TextDecoder().decode(projectTomlFile.data)
  )
}

export function getMimeType(fileName: string) {
  const extension = archivePaths.extname(fileName).toLowerCase()
  if (extension === '.kcl' || extension === '.toml') {
    return 'text/plain'
  }
  if (extension === '.png') {
    return 'image/png'
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  if (extension === '.webp') {
    return 'image/webp'
  }
  return 'application/octet-stream'
}

export function withProjectTitleInArchiveFiles(
  files: ProjectArchiveFile[],
  title?: string
) {
  if (!title?.trim()) {
    return files
  }

  return withUpdatedProjectTomlInArchiveFiles(files, (contents) =>
    setProjectTitleInProjectTomlContents(contents, title)
  )
}

export function withUpdatedProjectTomlInArchiveFiles(
  files: ProjectArchiveFile[],
  update: (contents: string) => string
): ProjectArchiveFile[]
export function withUpdatedProjectTomlInArchiveFiles(
  files: ProjectArchiveFile[],
  update: (contents: string) => string | Error
): ProjectArchiveFile[] | Error
export function withUpdatedProjectTomlInArchiveFiles(
  files: ProjectArchiveFile[],
  update: (contents: string) => string | Error
) {
  const nextFiles = [...files]
  const projectTomlFileIndex = nextFiles.findIndex(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  const existingProjectToml =
    projectTomlFileIndex === -1
      ? ''
      : new TextDecoder().decode(nextFiles[projectTomlFileIndex].data)
  const nextProjectToml = update(existingProjectToml)
  if (nextProjectToml instanceof Error) {
    return nextProjectToml
  }
  const nextProjectTomlFile = {
    relativePath: PROJECT_SETTINGS_FILE_NAME,
    data: new TextEncoder().encode(nextProjectToml),
  }

  if (projectTomlFileIndex === -1) {
    nextFiles.push(nextProjectTomlFile)
  } else {
    nextFiles[projectTomlFileIndex] = nextProjectTomlFile
  }

  return nextFiles
}

export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

export async function parseProjectArchive(archive: ArrayBuffer) {
  return withCloudFailureContext(
    { stage: 'archive', point: 'parse-project-archive' },
    async () => {
      const zip = await JSZip.loadAsync(archive)
      return Promise.all(
        Object.values(zip.files)
          .filter((entry) => !entry.dir && !entry.name.startsWith('__MACOSX/'))
          .map(async (entry) => ({
            relativePath: normalizeRelativePath(entry.name),
            data: Uint8Array.from(await entry.async('uint8array')),
          }))
      )
    }
  )
}
