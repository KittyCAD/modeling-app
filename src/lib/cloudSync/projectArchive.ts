import { normalizeRelativePath } from '@src/lib/cloudSync/paths'
import type {
  ProjectArchiveFile,
  ProjectManifest,
  ProjectUploadBody,
  Revision,
} from '@src/lib/cloudSync/types'
import {
  PROJECT_ENTRYPOINT,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import opfs from '@src/lib/fs-zds/opfs'
import { webSafePathSplit } from '@src/lib/pathUtils'
import {
  getProjectTitleFromProjectTomlContents,
  normalizeProjectTomlContents,
  setCloudProjectIdInProjectTomlContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { isArray } from '@src/lib/utils'
import JSZip from 'jszip'

const localFs = opfs.impl
export const CLOUD_SYNC_UNTITLED_PROJECT_TITLE = 'Untitled'

export function getRemoteProjectTitleForProjectToml(title?: string) {
  return title?.trim() || CLOUD_SYNC_UNTITLED_PROJECT_TITLE
}

export function prepareProjectFilesForCloudUpload(
  projectPath: string,
  files: ProjectArchiveFile[],
  expectedRevision?: Revision
) {
  const normalizedFiles = normalizeProjectArchiveFilesForCloudSync(files)
  const entrypointPath = getUploadEntrypointPath(normalizedFiles)
  const projectTomlPath = ensureProjectTomlUploadFile(
    normalizedFiles,
    entrypointPath
  )
  const projectTitle =
    getProjectTomlTitle(normalizedFiles) ||
    localFs.basename(projectPath.replaceAll('\\', '/').replace(/\/+$/g, ''))
  ensureProjectTomlUploadTitle(normalizedFiles, projectTitle || 'project')
  const body: ProjectUploadBody = {
    title: projectTitle || 'project',
    description: '',
    category_ids: [],
    entrypoint_path: entrypointPath,
    project_toml_path: projectTomlPath,
  }
  if (expectedRevision) {
    body.expected_revision = expectedRevision
  }

  return {
    body,
    files: normalizedFiles,
  }
}

export function normalizeProjectArchiveFilesForCloudSync(
  files: ProjectArchiveFile[]
) {
  return files.map((file) => {
    const relativePath = normalizeRelativePath(file.relativePath)
    return {
      ...file,
      relativePath,
      data:
        relativePath === PROJECT_SETTINGS_FILE_NAME
          ? new TextEncoder().encode(
              normalizeProjectTomlContents(new TextDecoder().decode(file.data))
            )
          : file.data,
    }
  })
}

function ensureProjectTomlUploadFile(
  files: ProjectArchiveFile[],
  entrypointPath: string
) {
  const projectTomlFile = files.find(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  if (projectTomlFile) {
    return projectTomlFile.relativePath
  }

  files.push({
    relativePath: PROJECT_SETTINGS_FILE_NAME,
    data: new TextEncoder().encode(
      `default_file = ${JSON.stringify(entrypointPath)}\n`
    ),
  })
  return PROJECT_SETTINGS_FILE_NAME
}

function ensureProjectTomlUploadTitle(
  files: ProjectArchiveFile[],
  title: string
) {
  const projectTomlFile = files.find(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  if (!projectTomlFile) {
    return
  }

  const existingProjectToml = new TextDecoder().decode(projectTomlFile.data)
  if (getProjectTitleFromProjectTomlContents(existingProjectToml)) {
    return
  }

  projectTomlFile.data = new TextEncoder().encode(
    setProjectTitleInProjectTomlContents(existingProjectToml, title)
  )
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

function getUploadEntrypointPath(files: ProjectArchiveFile[]) {
  const filePaths = new Set(files.map((file) => file.relativePath))
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
      (relativePath) => localFs.extname(relativePath).toLowerCase() === '.kcl'
    )
    .toSorted((a, b) => a.localeCompare(b))[0]
  if (fallbackKclFile) {
    return fallbackKclFile
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

  const projectToml = new TextDecoder().decode(projectTomlFile.data)
  const defaultFile = projectToml.match(
    /^\s*default_file\s*=\s*["']([^"']+)["']/m
  )?.[1]
  return defaultFile ? normalizeRelativePath(defaultFile) : undefined
}

export function getMimeType(fileName: string) {
  const extension = localFs.extname(fileName).toLowerCase()
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

  return withProjectTomlArchiveFile(files, (contents) =>
    setProjectTitleInProjectTomlContents(contents, title)
  )
}

export function withProjectCloudProjectIdInArchiveFiles(
  files: ProjectArchiveFile[],
  projectId: string,
  environmentName?: string
) {
  if (!environmentName) {
    return files
  }

  return withProjectTomlArchiveFile(files, (contents) =>
    setCloudProjectIdInProjectTomlContents(contents, environmentName, projectId)
  )
}

function withProjectTomlArchiveFile(
  files: ProjectArchiveFile[],
  update: (contents: string) => string
) {
  const nextFiles = [...files]
  const projectTomlFileIndex = nextFiles.findIndex(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  const existingProjectToml =
    projectTomlFileIndex === -1
      ? ''
      : new TextDecoder().decode(nextFiles[projectTomlFileIndex].data)
  const nextProjectTomlFile = {
    relativePath: PROJECT_SETTINGS_FILE_NAME,
    data: new TextEncoder().encode(update(existingProjectToml)),
  }

  if (projectTomlFileIndex === -1) {
    nextFiles.push(nextProjectTomlFile)
  } else {
    nextFiles[projectTomlFileIndex] = nextProjectTomlFile
  }

  return nextFiles
}

export function withRemoteProjectMetadataInArchiveFiles(
  files: ProjectArchiveFile[],
  title: string | undefined,
  projectId: string,
  environmentName?: string
) {
  return withProjectCloudProjectIdInArchiveFiles(
    withProjectTitleInArchiveFiles(
      files,
      getRemoteProjectTitleForProjectToml(title)
    ),
    projectId,
    environmentName
  )
}

export function projectManifestsEqual(
  a: ProjectManifest | undefined,
  b: ProjectManifest | undefined
) {
  if (!a || !b) {
    return false
  }
  const aEntries = Object.entries(a.files).sort(([left], [right]) =>
    left.localeCompare(right)
  )
  const bEntries = Object.entries(b.files).sort(([left], [right]) =>
    left.localeCompare(right)
  )
  if (aEntries.length !== bEntries.length) {
    return false
  }

  return aEntries.every(([aPath, aEntry], index) => {
    const [bPath, bEntry] = bEntries[index]
    return (
      aPath === bPath &&
      aEntry.byteSize === bEntry.byteSize &&
      aEntry.sha256 === bEntry.sha256
    )
  })
}

export async function projectManifestFromFiles(files: ProjectArchiveFile[]) {
  const manifest: ProjectManifest = { files: {} }
  for (const file of files) {
    manifest.files[normalizeRelativePath(file.relativePath)] = {
      byteSize: file.data.byteLength,
      sha256: await sha256Hex(file.data),
    }
  }
  return manifest
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
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

export async function parseProjectArchive(archive: ArrayBuffer) {
  try {
    return await parseZipProjectArchive(archive)
  } catch (zipError) {
    const jsonProject = parseJsonProjectArchive(archive)
    if (jsonProject) {
      return jsonProject
    }
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw zipError
  }
}

async function parseZipProjectArchive(archive: ArrayBuffer) {
  const zip = await JSZip.loadAsync(archive)
  const zipEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !entry.name.startsWith('__MACOSX/')
  )
  const rootDirectory = getCommonArchiveRoot(
    zipEntries.map((entry) => entry.name)
  )

  return Promise.all(
    zipEntries.map(async (entry) => ({
      relativePath: normalizeRelativePath(
        stripArchiveRoot(entry.name, rootDirectory)
      ),
      data: Uint8Array.from(await entry.async('uint8array')),
    }))
  )
}

function parseJsonProjectArchive(archive: ArrayBuffer) {
  try {
    const decoded = new TextDecoder().decode(new Uint8Array(archive))
    const parsed = JSON.parse(decoded)
    if (!parsed || typeof parsed !== 'object' || !isArray(parsed.files)) {
      return undefined
    }

    const files: ProjectArchiveFile[] = []
    for (const file of parsed.files) {
      if (!file || typeof file !== 'object') {
        continue
      }
      const relativePath =
        typeof file.relativePath === 'string'
          ? file.relativePath
          : typeof file.requestedFileName === 'string'
            ? file.requestedFileName
            : undefined
      if (!relativePath) {
        continue
      }

      if (typeof file.contents === 'string') {
        files.push({
          relativePath: normalizeRelativePath(relativePath),
          data: new TextEncoder().encode(file.contents),
        })
      }
    }
    return files
  } catch {
    return undefined
  }
}

function getCommonArchiveRoot(fileNames: string[]) {
  if (fileNames.length === 0) {
    return ''
  }
  const splitPaths = fileNames.map((name) =>
    webSafePathSplit(name).filter(Boolean)
  )
  const firstPath = splitPaths[0]
  if (firstPath.length <= 1) {
    return ''
  }

  const firstSegment = firstPath[0]
  if (splitPaths.every((parts) => parts[0] === firstSegment)) {
    return firstSegment
  }
  return ''
}

function stripArchiveRoot(fileName: string, rootDirectory: string) {
  if (!rootDirectory) {
    return fileName
  }
  return fileName.startsWith(`${rootDirectory}/`)
    ? fileName.slice(rootDirectory.length + 1)
    : fileName
}
