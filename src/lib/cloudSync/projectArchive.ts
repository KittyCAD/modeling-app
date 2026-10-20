import { withCloudSyncFailureContext } from '@src/lib/cloudSync/failureContext'
import { normalizeRelativePath } from '@src/lib/cloudSync/paths'
import type {
  ProjectArchiveFile,
  ProjectManifest,
  ProjectUploadBody,
  ProjectUploadPublicationMetadata,
  Revision,
} from '@src/lib/cloudSync/types'
import {
  PROJECT_ENTRYPOINT,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import opfs from '@src/lib/fs-zds/opfs'
import { webSafePathSplit } from '@src/lib/pathUtils'
import {
  getProjectDefaultFileFromProjectTomlContents,
  getProjectTitleFromProjectTomlContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { isArray, isRecord } from '@src/lib/utils'
import JSZip from 'jszip'

const localFs = opfs.impl
export const CLOUD_SYNC_UNTITLED_PROJECT_TITLE = 'Untitled'

export function getRemoteProjectTitleForProjectToml(title?: string) {
  return title?.trim() || CLOUD_SYNC_UNTITLED_PROJECT_TITLE
}

type PrepareProjectFilesForCloudUploadOptions = {
  expectedRevision?: Revision
  entrypointPath?: string
  publicationMetadata?: ProjectUploadPublicationMetadata
  deletedPaths?: string[]
}

export function prepareProjectFilesForCloudUpload(
  projectPath: string,
  files: ProjectArchiveFile[],
  expectedRevision?: Revision
): {
  body: ProjectUploadBody
  files: ProjectArchiveFile[]
}
export function prepareProjectFilesForCloudUpload(
  projectPath: string,
  files: ProjectArchiveFile[],
  options?: PrepareProjectFilesForCloudUploadOptions
): {
  body: ProjectUploadBody
  files: ProjectArchiveFile[]
}
export function prepareProjectFilesForCloudUpload(
  projectPath: string,
  files: ProjectArchiveFile[],
  optionsOrExpectedRevision?:
    | Revision
    | PrepareProjectFilesForCloudUploadOptions
) {
  const expectedRevision =
    typeof optionsOrExpectedRevision === 'string'
      ? optionsOrExpectedRevision
      : optionsOrExpectedRevision?.expectedRevision
  const preferredEntrypointPath =
    typeof optionsOrExpectedRevision === 'string'
      ? undefined
      : optionsOrExpectedRevision?.entrypointPath
  const normalizedFiles = normalizeProjectArchiveFilesForCloudSync(files)
  const entrypointPath = getUploadEntrypointPath(
    normalizedFiles,
    preferredEntrypointPath
  )
  const projectTomlPath = getUploadProjectTomlPath(normalizedFiles)
  const projectTitle =
    getProjectTomlTitle(normalizedFiles) ||
    localFs.basename(projectPath.replaceAll('\\', '/').replace(/\/+$/g, ''))
  const publicationMetadata =
    typeof optionsOrExpectedRevision === 'string'
      ? undefined
      : optionsOrExpectedRevision?.publicationMetadata
  const body: ProjectUploadBody = {
    title: projectTitle || 'project',
    description: publicationMetadata?.description ?? '',
    category_ids: publicationMetadata?.category_ids ?? [],
    entrypoint_path: entrypointPath,
    project_toml_path: projectTomlPath,
  }
  if (expectedRevision) {
    body.expected_revision = expectedRevision
  }
  if (
    typeof optionsOrExpectedRevision !== 'string' &&
    optionsOrExpectedRevision?.deletedPaths?.length
  ) {
    body.deleted_paths = Array.from(
      new Set(optionsOrExpectedRevision.deletedPaths.map(normalizeRelativePath))
    ).sort()
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
      (relativePath) => localFs.extname(relativePath).toLowerCase() === '.kcl'
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
  return withCloudSyncFailureContext(
    { stage: 'manifest', point: 'hash-project-manifest' },
    async () => {
      const manifest: ProjectManifest = { files: {} }
      for (const file of files) {
        manifest.files[normalizeRelativePath(file.relativePath)] = {
          byteSize: file.data.byteLength,
          sha256: await sha256Hex(file.data),
        }
      }
      return manifest
    }
  )
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

export type ProjectArchiveReadLimits = {
  includePath: (relativePath: string) => boolean
  maxArchiveEntries: number
  maxFileBytes: number
  maxFiles: number
  maxTotalBytes: number
}

class ProjectArchiveLimitError extends Error {}

/** Reject large JSON arrays before JSON.parse allocates their entries. */
function checkJsonEntryLimit(archive: ArrayBuffer, maxEntries: number): void {
  const bytes = new Uint8Array(archive)
  let offset =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  while (
    bytes[offset] === 0x20 ||
    bytes[offset] === 0x09 ||
    bytes[offset] === 0x0a ||
    bytes[offset] === 0x0d
  ) {
    offset += 1
  }
  if (bytes[offset] !== 0x7b && bytes[offset] !== 0x5b) {
    return
  }

  const containers: Array<{ kind: 'array' | 'object'; entries: number }> = []
  let inString = false
  let escaped = false
  let structuralTokens = 0
  // Bound metadata objects too, while allowing several fields per file.
  const maxStructuralTokens = Math.max(8, maxEntries * 8)
  const markStructure = () => {
    structuralTokens += 1
    if (structuralTokens > maxStructuralTokens) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new ProjectArchiveLimitError('Archive JSON is too complex.')
    }
  }
  const markArrayValue = () => {
    const current = containers.at(-1)
    if (current?.kind === 'array' && current.entries === 0) {
      current.entries = 1
      if (current.entries > maxEntries) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new ProjectArchiveLimitError('Too many archive entries.')
      }
    }
  }
  for (; offset < bytes.length; offset += 1) {
    const byte = bytes[offset]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (byte === 0x5c) {
        escaped = true
      } else if (byte === 0x22) {
        inString = false
      }
      continue
    }
    if (byte === 0x22) {
      markArrayValue()
      inString = true
    } else if (byte === 0x5b || byte === 0x7b) {
      markStructure()
      markArrayValue()
      containers.push({
        kind: byte === 0x5b ? 'array' : 'object',
        entries: 0,
      })
      if (containers.length > 128) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new ProjectArchiveLimitError('Archive JSON is too deeply nested.')
      }
    } else if (byte === 0x5d || byte === 0x7d) {
      containers.pop()
    } else if (byte === 0x2c) {
      markStructure()
      const current = containers.at(-1)
      if (current?.kind === 'array' && ++current.entries > maxEntries) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new ProjectArchiveLimitError('Too many archive entries.')
      }
    } else if (
      byte !== 0x20 &&
      byte !== 0x09 &&
      byte !== 0x0a &&
      byte !== 0x0d
    ) {
      markArrayValue()
    }
  }
}

/** Count central-directory records before JSZip allocates an object per entry. */
function checkZipEntryLimit(archive: ArrayBuffer, maxEntries: number): boolean {
  const view = new DataView(archive)
  const endOfDirectorySize = 22
  const firstCandidate = Math.max(
    0,
    archive.byteLength - 65_535 - endOfDirectorySize
  )
  let endOfDirectory = -1
  for (
    let offset = archive.byteLength - endOfDirectorySize;
    offset >= firstCandidate;
    offset -= 1
  ) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + endOfDirectorySize + view.getUint16(offset + 20, true) ===
        archive.byteLength
    ) {
      endOfDirectory = offset
      break
    }
  }
  if (endOfDirectory < 0) {
    return false
  }

  const declaredEntries = view.getUint16(endOfDirectory + 10, true)
  const directorySize = view.getUint32(endOfDirectory + 12, true)
  const directoryOffset = view.getUint32(endOfDirectory + 16, true)
  const directoryEnd = directoryOffset + directorySize
  if (
    declaredEntries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    directoryEnd !== endOfDirectory ||
    declaredEntries > maxEntries
  ) {
    // Limited reference reads accept ordinary single-volume ZIP files only.
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new ProjectArchiveLimitError(
      'Too many or unsupported archive entries.'
    )
  }

  let cursor = directoryOffset
  let entries = 0
  while (cursor < directoryEnd) {
    if (
      cursor + 46 > directoryEnd ||
      view.getUint32(cursor, true) !== 0x02014b50
    ) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new ProjectArchiveLimitError('Invalid archive directory.')
    }
    cursor +=
      46 +
      view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true)
    entries += 1
    if (cursor > directoryEnd || entries > maxEntries) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new ProjectArchiveLimitError('Too many or invalid archive entries.')
    }
  }
  if (entries !== declaredEntries) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new ProjectArchiveLimitError('Invalid archive directory.')
  }
  return true
}

export async function parseProjectArchive(
  archive: ArrayBuffer,
  limits?: ProjectArchiveReadLimits
) {
  return withCloudSyncFailureContext(
    { stage: 'archive', point: 'parse-project-archive' },
    async () => {
      try {
        return await parseZipProjectArchive(archive, limits)
      } catch (zipError) {
        if (zipError instanceof ProjectArchiveLimitError) {
          return Promise.reject(zipError)
        }
        const jsonProject = parseJsonProjectArchive(archive, limits)
        if (jsonProject) {
          return jsonProject
        }
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw zipError
      }
    }
  )
}

function readZipEntryWithinLimit(entry: JSZip.JSZipObject, limit: number) {
  return new Promise<Uint8Array>((resolve, reject) => {
    // JSZip exposes internalStream at runtime, but omits it from JSZipObject's
    // declaration. Streaming lets us stop expansion at the byte limit.
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>
      }
    ).internalStream('uint8array')
    const chunks: Uint8Array[] = []
    let size = 0
    let exceeded = false
    stream
      .on('data', (chunk: Uint8Array) => {
        if (exceeded) {
          return
        }
        if (size + chunk.byteLength > limit) {
          exceeded = true
          stream.pause()
          reject(new ProjectArchiveLimitError('Project archive is too large.'))
          return
        }
        chunks.push(chunk)
        size += chunk.byteLength
      })
      .on('error', reject)
      .on('end', () => {
        if (exceeded) {
          return
        }
        const data = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          data.set(chunk, offset)
          offset += chunk.byteLength
        }
        resolve(data)
      })
      .resume()
  })
}

async function parseZipProjectArchive(
  archive: ArrayBuffer,
  limits?: ProjectArchiveReadLimits
) {
  if (limits && !checkZipEntryLimit(archive, limits.maxArchiveEntries)) {
    return Promise.reject(new Error('Archive has no ZIP central directory.'))
  }
  const zip = await JSZip.loadAsync(archive)
  const zipEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !entry.name.startsWith('__MACOSX/')
  )
  const rootDirectory = getCommonArchiveRoot(
    zipEntries.map((entry) => entry.name)
  )

  const selected = zipEntries
    .map((entry) => ({
      entry,
      relativePath: normalizeRelativePath(
        stripArchiveRoot(entry.name, rootDirectory)
      ),
    }))
    .filter(({ relativePath }) => !limits || limits.includePath(relativePath))

  if (!limits) {
    return Promise.all(
      selected.map(async ({ entry, relativePath }) => ({
        relativePath,
        data: Uint8Array.from(await entry.async('uint8array')),
      }))
    )
  }
  if (selected.length > limits.maxFiles) {
    return Promise.reject(
      new ProjectArchiveLimitError('Too many project files.')
    )
  }

  const files: ProjectArchiveFile[] = []
  let total = 0
  for (const { entry, relativePath } of selected) {
    const data = await readZipEntryWithinLimit(
      entry,
      Math.min(limits.maxFileBytes, limits.maxTotalBytes - total)
    )
    total += data.byteLength
    files.push({ relativePath, data })
  }
  return files
}

function parseJsonProjectArchive(
  archive: ArrayBuffer,
  limits?: ProjectArchiveReadLimits
) {
  if (limits) {
    checkJsonEntryLimit(archive, limits.maxArchiveEntries)
  }
  let parsed: unknown
  try {
    const decoded = new TextDecoder().decode(new Uint8Array(archive))
    parsed = JSON.parse(decoded)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) {
    return undefined
  }
  const entries = parsed.files
  if (!isArray(entries)) {
    return undefined
  }
  if (limits && entries.length > limits.maxArchiveEntries) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new ProjectArchiveLimitError('Too many archive entries.')
  }

  const files: ProjectArchiveFile[] = []
  let total = 0
  const encoder = new TextEncoder()
  for (const file of entries) {
    if (!isRecord(file)) {
      continue
    }
    const relativePath =
      typeof file.relativePath === 'string'
        ? file.relativePath
        : typeof file.requestedFileName === 'string'
          ? file.requestedFileName
          : undefined
    if (!relativePath || typeof file.contents !== 'string') {
      continue
    }
    const normalizedPath = normalizeRelativePath(relativePath)
    if (limits && !limits.includePath(normalizedPath)) {
      continue
    }
    if (limits && files.length >= limits.maxFiles) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new ProjectArchiveLimitError('Too many project files.')
    }
    if (
      limits &&
      (file.contents.length > limits.maxFileBytes ||
        file.contents.length > limits.maxTotalBytes - total)
    ) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new ProjectArchiveLimitError('Project archive is too large.')
    }
    const data = encoder.encode(file.contents)
    total += data.byteLength
    if (
      limits &&
      (data.byteLength > limits.maxFileBytes || total > limits.maxTotalBytes)
    ) {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new ProjectArchiveLimitError('Project archive is too large.')
    }
    files.push({ relativePath: normalizedPath, data })
  }
  return files
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
