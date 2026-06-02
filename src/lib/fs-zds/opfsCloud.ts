import { signal } from '@preact/signals-core'
import env from '@src/env'
import {
  PROJECT_ENTRYPOINT,
  PROJECT_FOLDER,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import opfs, { type OPFSOptions } from '@src/lib/fs-zds/opfs'
import { sanitizeProjectName } from '@src/lib/projectName'
import {
  getCloudProjectIdFromProjectTomlContents,
  getProjectTitleFromProjectTomlContents,
  setCloudProjectIdInProjectTomlContents,
  setProjectTitleInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import JSZip from 'jszip'

type Revision = string

type ProjectManifestEntry = {
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

type OutboxEntry = {
  id?: number
  projectPath: string
  kind: 'upsert' | 'delete'
  targetPath: string
  sourcePath?: string
  createdAt: string
}

type RemoteProjectSummary = {
  id: string
  title?: string
  updated_at?: string
  revision?: Revision | number
  [key: string]: unknown
}

type RemoteProject = RemoteProjectSummary

type ProjectUploadBody = {
  title: string
  description: string
  category_ids: string[]
  entrypoint_path: string
  project_toml_path: string
  expected_revision?: Revision
}

type OPFSCloudConfig = {
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

const DB_NAME = 'zds-opfs-cloud-sync'
const DB_VERSION = 1
const PROJECTS_STORE = 'projects'
const OUTBOX_STORE = 'outbox'
const INTERNAL_OPFS_META_FILE = '._meta'
const SYNC_DEBOUNCE_MS = 2500
const SYNC_RETRY_MS = 30_000
const REMOTE_INDEX_INTERVAL_MS = 5 * 60 * 1000

const localFs = opfs.impl

let config: OPFSCloudConfig = {
  enabled: false,
}
let syncTimer: ReturnType<typeof setTimeout> | undefined
let syncInProgress = false
let lastRemoteIndexSyncAt = 0
let initialLocalScanComplete = false
let pendingStatusSyncedAt: string | undefined

export const opfsCloudSyncStatus = signal<OPFSCloudSyncStatus>({
  enabled: false,
  state: 'disabled',
  pendingCount: 0,
})

class CloudApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function updateStatus(next: Partial<OPFSCloudSyncStatus>) {
  opfsCloudSyncStatus.value = {
    ...opfsCloudSyncStatus.value,
    ...next,
  }
}

function nowIso() {
  return new Date().toISOString()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function normalizePathForSync(targetPath: string) {
  const normalized = targetPath.replaceAll('\\', '/')
  if (normalized === '/') {
    return normalized
  }
  return normalized.replace(/\/+$/g, '')
}

function normalizeRelativePath(relativePath: string) {
  return relativePath
    .replaceAll('\\', '/')
    .replace(/^\/+/g, '')
    .replace(/^(?:\.\/)+/g, '')
}

export function getOpfsCloudProjectRoot(
  targetPath: string
): string | undefined {
  const normalized = normalizePathForSync(targetPath)
  const parts = normalized.split('/').filter(Boolean)
  const projectDirectoryIndex = parts.lastIndexOf(PROJECT_FOLDER)
  if (
    projectDirectoryIndex === -1 ||
    parts.length <= projectDirectoryIndex + 1
  ) {
    return undefined
  }

  return `/${parts.slice(0, projectDirectoryIndex + 2).join('/')}`
}

function isOpfsCloudProjectDirectoryPath(targetPath: string) {
  const normalized = normalizePathForSync(targetPath)
  return normalized.endsWith(`/${PROJECT_FOLDER}`)
}

function getConfiguredProjectDirectoryPath() {
  return normalizePathForSync(
    config.projectDirectoryPath?.trim() ||
      localFs.join(`${localFs.sep}documents`, PROJECT_FOLDER)
  )
}

function projectNameFromPath(projectPath: string) {
  return localFs.basename(normalizePathForSync(projectPath))
}

function isProjectPathInDirectory(
  projectPath: string,
  projectDirectory: string
) {
  return (
    localFs.dirname(normalizePathForSync(projectPath)) ===
    normalizePathForSync(projectDirectory)
  )
}

function projectPathInDirectory(
  metadata: ProjectMetadata,
  projectDirectory: string
) {
  return isProjectPathInDirectory(metadata.localProjectPath, projectDirectory)
    ? metadata.localProjectPath
    : undefined
}

function isInternalOpfsPath(targetPath: string) {
  return normalizePathForSync(targetPath)
    .split('/')
    .includes(INTERNAL_OPFS_META_FILE)
}

function isProjectRootPath(targetPath: string, projectRoot: string) {
  return normalizePathForSync(targetPath) === normalizePathForSync(projectRoot)
}

function isConfiguredForCloud() {
  return config.enabled === true
}

function getBaseUrl() {
  return (config.baseUrl || env().VITE_ZOO_API_BASE_URL || '').replace(
    /\/+$/g,
    ''
  )
}

function getEnvironmentName() {
  if (config.environmentName) {
    return config.environmentName
  }

  const baseDomain = env().VITE_ZOO_BASE_DOMAIN
  if (baseDomain) {
    return baseDomain
  }

  const apiBaseUrl = env().VITE_ZOO_API_BASE_URL
  if (apiBaseUrl) {
    return new URL(apiBaseUrl).hostname.replace(/^api\./, '')
  }

  return undefined
}

function getRevision(project: RemoteProject | undefined): Revision | undefined {
  if (!project) {
    return undefined
  }
  const revision = project.revision ?? project.updated_at
  if (revision === undefined || revision === null) {
    return undefined
  }
  return String(revision)
}

function getRemoteUpdatedAt(project: RemoteProject | undefined) {
  if (!project?.updated_at || Number.isNaN(Date.parse(project.updated_at))) {
    return undefined
  }

  return project.updated_at
}

function remoteSyncMetadata(
  project: RemoteProject | undefined,
  options: { useNowAsUpdatedAtFallback?: boolean } = {}
) {
  return {
    revision: getRevision(project),
    updatedAt:
      getRemoteUpdatedAt(project) ||
      (options.useNowAsUpdatedAtFallback ? nowIso() : undefined),
  }
}

export function getOpfsCloudProjectModifiedTime(
  metadata: OpfsCloudProjectMetadataIndexEntry | undefined,
  localModified: number | null | undefined
) {
  const remoteUpdatedAt = metadata?.remoteUpdatedAt
    ? Date.parse(metadata.remoteUpdatedAt)
    : Number.NaN
  if (!metadata?.hasPendingChanges && !Number.isNaN(remoteUpdatedAt)) {
    return remoteUpdatedAt
  }

  return localModified ?? null
}

async function cloudFetch(
  targetPath: string,
  init: RequestInit = {}
): Promise<Response> {
  const baseUrl = getBaseUrl()
  if (!baseUrl) {
    throw new Error('Cloud sync is missing an API base URL.')
  }

  const headers = new Headers(init.headers)
  if (config.token) {
    headers.set('Authorization', `Bearer ${config.token}`)
  }

  const response = await fetch(`${baseUrl}${targetPath}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    let message = response.statusText || `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (body?.message) {
        message = body.message
      }
    } catch {
      const text = await response.text().catch(() => '')
      if (text) {
        message = text
      }
    }

    throw new CloudApiError(response.status, message)
  }

  return response
}

async function cloudJson<T>(
  targetPath: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await cloudFetch(targetPath, init)
  return response.json() as Promise<T>
}

function appendExpectedRevisionParam(pathname: string, revision?: Revision) {
  if (!revision) {
    return pathname
  }
  const url = new URL(pathname, 'https://zds.local')
  url.searchParams.set('expected_revision', revision)
  return `${url.pathname}${url.search}`
}

async function listRemoteProjects() {
  return cloudJson<RemoteProjectSummary[]>('/user/projects')
}

async function getRemoteProject(projectId: string) {
  return cloudJson<RemoteProject>(`/user/projects/${projectId}`)
}

async function deleteRemoteProject(projectId: string) {
  await cloudFetch(`/user/projects/${projectId}`, {
    method: 'DELETE',
  })
}

async function downloadRemoteProjectArchive(projectId: string) {
  const response = await cloudFetch(
    `/user/projects/${projectId}/download?format=zip`
  )
  return response.arrayBuffer()
}

async function createRemoteProject(
  projectPath: string,
  files: ProjectArchiveFile[]
) {
  return cloudJson<RemoteProject>('/user/projects', {
    method: 'POST',
    body: buildProjectFormData(projectPath, files),
  })
}

async function updateRemoteProject({
  projectPath,
  projectId,
  files,
  expectedRevision,
}: {
  projectPath: string
  projectId: string
  files: ProjectArchiveFile[]
  expectedRevision?: Revision
}) {
  return cloudJson<RemoteProject>(
    appendExpectedRevisionParam(
      `/user/projects/${projectId}`,
      expectedRevision
    ),
    {
      method: 'PUT',
      body: buildProjectFormData(projectPath, files, expectedRevision),
    }
  )
}

function buildProjectFormData(
  projectPath: string,
  files: ProjectArchiveFile[],
  expectedRevision?: Revision
) {
  const uploadPayload = prepareProjectFilesForCloudUpload(
    projectPath,
    files,
    expectedRevision
  )

  const formData = new FormData()
  formData.append(
    'body',
    new Blob([JSON.stringify(uploadPayload.body)], {
      type: 'application/json',
    }),
    'body'
  )

  for (const file of uploadPayload.files) {
    formData.append(
      file.relativePath,
      new Blob([toArrayBuffer(file.data)], {
        type: getMimeType(file.relativePath),
      }),
      file.relativePath
    )
  }

  return formData
}

export function prepareProjectFilesForCloudUpload(
  projectPath: string,
  files: ProjectArchiveFile[],
  expectedRevision?: Revision
) {
  const normalizedFiles = normalizeProjectArchiveFiles(files)
  const entrypointPath = getUploadEntrypointPath(normalizedFiles)
  const projectTomlPath = ensureProjectTomlUploadFile(
    normalizedFiles,
    entrypointPath
  )
  const projectTitle =
    getProjectTomlTitle(normalizedFiles) || projectNameFromPath(projectPath)
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

function normalizeProjectArchiveFiles(files: ProjectArchiveFile[]) {
  return files.map((file) => ({
    ...file,
    relativePath: normalizeRelativePath(file.relativePath),
  }))
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

function withProjectTitleInArchiveFiles(
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

function withProjectCloudProjectIdInArchiveFiles(
  files: ProjectArchiveFile[],
  projectId: string
) {
  const environmentName = getEnvironmentName()
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

function withRemoteProjectMetadataInArchiveFiles(
  files: ProjectArchiveFile[],
  title: string | undefined,
  projectId: string
) {
  return withProjectCloudProjectIdInArchiveFiles(
    withProjectTitleInArchiveFiles(files, title),
    projectId
  )
}

async function writeLocalProjectTitle(projectPath: string, title: string) {
  return updateLocalProjectToml(projectPath, (projectToml) =>
    getProjectTitleFromProjectTomlContents(projectToml) === title
      ? projectToml
      : setProjectTitleInProjectTomlContents(projectToml, title)
  )
}

async function writeLocalProjectCloudProjectId(
  projectPath: string,
  projectId: string
) {
  const environmentName = getEnvironmentName()
  if (!environmentName) {
    return false
  }

  return updateLocalProjectToml(projectPath, (projectToml) =>
    getCloudProjectIdFromProjectTomlContents(projectToml, environmentName) ===
    projectId
      ? projectToml
      : setCloudProjectIdInProjectTomlContents(
          projectToml,
          environmentName,
          projectId
        )
  )
}

async function updateLocalProjectToml(
  projectPath: string,
  update: (contents: string) => string
) {
  const projectTomlPath = localFs.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  let projectToml = ''
  if (await exists(projectTomlPath)) {
    projectToml = await localFs.readFile(projectTomlPath, {
      encoding: 'utf-8',
    })
  }

  const nextProjectToml = update(projectToml)
  if (nextProjectToml === projectToml) {
    return false
  }

  await localFs.writeFile(
    projectTomlPath,
    new TextEncoder().encode(nextProjectToml)
  )
  return true
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

function getMimeType(fileName: string) {
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

function openSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable for cloud sync metadata.'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: 'localProjectPath' })
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        })
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | T
): Promise<T> {
  const db = await openSyncDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    let callbackResult: IDBRequest<T> | T

    transaction.oncomplete = () => {
      db.close()
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error)
    }

    try {
      callbackResult = callback(store)
    } catch (error) {
      transaction.abort()
      reject(error)
      return
    }

    if (
      callbackResult &&
      typeof callbackResult === 'object' &&
      'onsuccess' in callbackResult
    ) {
      callbackResult.onsuccess = () => resolve(callbackResult.result)
      callbackResult.onerror = () => reject(callbackResult.error)
      return
    }

    transaction.oncomplete = () => {
      db.close()
      resolve(callbackResult as T)
    }
  })
}

async function getProjectMetadata(projectPath: string) {
  return withStore<ProjectMetadata | undefined>(
    PROJECTS_STORE,
    'readonly',
    (store) => store.get(normalizePathForSync(projectPath))
  )
}

export async function getOpfsCloudProjectMetadata(projectPath: string) {
  return getProjectMetadata(normalizePathForSync(projectPath))
}

export async function getOpfsCloudProjectMetadataIndex() {
  const [metadata, outboxEntries] = await Promise.all([
    getAllProjectMetadata(),
    getAllOutboxEntries(),
  ])
  const pendingProjectPaths = new Set(
    outboxEntries.map((entry) => normalizePathForSync(entry.projectPath))
  )

  return new Map(
    metadata.map((entry) => [
      normalizePathForSync(entry.localProjectPath),
      {
        ...entry,
        hasPendingChanges:
          pendingProjectPaths.has(
            normalizePathForSync(entry.localProjectPath)
          ) || Boolean(entry.tombstone),
      },
    ])
  )
}

async function putProjectMetadata(metadata: ProjectMetadata) {
  await withStore<IDBValidKey>(PROJECTS_STORE, 'readwrite', (store) =>
    store.put({
      ...metadata,
      localProjectPath: normalizePathForSync(metadata.localProjectPath),
    })
  )
}

async function deleteProjectMetadata(projectPath: string) {
  await withStore<undefined>(PROJECTS_STORE, 'readwrite', (store) =>
    store.delete(normalizePathForSync(projectPath))
  )
}

async function getAllProjectMetadata() {
  return withStore<ProjectMetadata[]>(PROJECTS_STORE, 'readonly', (store) =>
    store.getAll()
  )
}

async function appendOutboxEntry(entry: Omit<OutboxEntry, 'id'>) {
  await withStore<IDBValidKey>(OUTBOX_STORE, 'readwrite', (store) =>
    store.add(entry)
  )
  await refreshPendingCount()
}

async function getAllOutboxEntries() {
  return withStore<OutboxEntry[]>(OUTBOX_STORE, 'readonly', (store) =>
    store.getAll()
  )
}

async function clearOutboxEntriesForProject(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const db = await openSyncDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OUTBOX_STORE, 'readwrite')
    const store = transaction.objectStore(OUTBOX_STORE)
    const request = store.openCursor()

    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        return
      }
      const entry = cursor.value as OutboxEntry
      if (normalizePathForSync(entry.projectPath) === normalizedProjectPath) {
        cursor.delete()
      }
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
  })
  await refreshPendingCount()
}

async function refreshPendingCount() {
  try {
    const entries = await getAllOutboxEntries()
    updateStatus({ pendingCount: entries.length })
  } catch {
    updateStatus({ pendingCount: 0 })
  }
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

async function projectManifestFromFiles(files: ProjectArchiveFile[]) {
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

function toArrayBuffer(data: Uint8Array) {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer
}

async function exists(targetPath: string) {
  try {
    await localFs.stat(targetPath)
    return true
  } catch (error) {
    if (error === 'ENOENT') {
      return false
    }
    throw error
  }
}

function statIsDirectory(stat: IStat) {
  return Boolean(stat.mode & 0o040000)
}

async function collectLocalProjectFiles(projectRoot: string) {
  const files: ProjectArchiveFile[] = []

  const walk = async (currentPath: string) => {
    const entries = await localFs.readdir(currentPath)
    for (const entry of entries) {
      if (entry === INTERNAL_OPFS_META_FILE) {
        continue
      }

      const absolutePath = localFs.join(currentPath, entry)
      const stat = await localFs.stat(absolutePath)
      if (statIsDirectory(stat)) {
        await walk(absolutePath)
        continue
      }

      const data = await localFs.readFile(absolutePath)
      files.push({
        relativePath: normalizeRelativePath(
          localFs.relative(projectRoot, absolutePath)
        ),
        data: Uint8Array.from(data),
      })
    }
  }

  await walk(projectRoot)
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function parseProjectArchive(archive: ArrayBuffer) {
  try {
    return await parseZipProjectArchive(archive)
  } catch (zipError) {
    const jsonProject = parseJsonProjectArchive(archive)
    if (jsonProject) {
      return jsonProject
    }
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
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.files)) {
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
  const splitPaths = fileNames.map((name) => name.split('/').filter(Boolean))
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

async function replaceLocalProjectWithFiles(
  projectPath: string,
  files: ProjectArchiveFile[]
) {
  if (await exists(projectPath)) {
    await localFs.rm(projectPath, { recursive: true })
  }

  await localFs.mkdir(projectPath, { recursive: true })
  for (const file of files) {
    if (!file.relativePath) {
      continue
    }
    const targetPath = localFs.join(projectPath, file.relativePath)
    await localFs.mkdir(localFs.dirname(targetPath), { recursive: true })
    await localFs.writeFile(
      targetPath,
      new Uint8Array(toArrayBuffer(file.data))
    )
  }
}

async function uniqueProjectPath(
  projectDirectory: string,
  projectName: string
) {
  let candidate = localFs.join(projectDirectory, projectName)
  if (!(await exists(candidate))) {
    return candidate
  }

  let index = 2
  while (await exists(candidate)) {
    candidate = localFs.join(projectDirectory, `${projectName} ${index}`)
    index += 1
  }
  return candidate
}

function localProjectFromMetadata(
  metadata: ProjectMetadata
): OpfsCloudLocalProject | undefined {
  if (!metadata.remoteProjectId) {
    return undefined
  }

  return {
    projectPath: metadata.localProjectPath,
    projectName: metadata.projectName,
    remoteProjectId: metadata.remoteProjectId,
    remoteRevision: metadata.remoteRevision,
  }
}

async function findLocalProjectPathByRemoteProjectId(
  projectDirectory: string,
  remoteProjectId: string,
  preferredProjectName?: string
) {
  const candidateNames = new Set<string>()
  if (preferredProjectName) {
    candidateNames.add(preferredProjectName)
  }

  const entries = await localFs.readdir(projectDirectory).catch((error) => {
    if (error === 'ENOENT') {
      return []
    }
    throw error
  })
  for (const entry of entries) {
    candidateNames.add(entry)
  }

  for (const entry of candidateNames) {
    if (entry.startsWith('.')) {
      continue
    }
    const candidatePath = localFs.join(projectDirectory, entry)
    if (!(await exists(candidatePath))) {
      continue
    }
    const candidateRemoteProjectId = await readProjectTomlCloudProjectId(
      candidatePath
    ).catch(() => undefined)
    if (candidateRemoteProjectId === remoteProjectId) {
      return candidatePath
    }
  }

  return undefined
}

async function cloneRemoteProjectToLocal(
  remoteProject: RemoteProject,
  projectDirectory = getConfiguredProjectDirectoryPath(),
  preferredProjectPath?: string
): Promise<OpfsCloudLocalProject> {
  await localFs.mkdir(projectDirectory, { recursive: true })
  const projectName = sanitizeProjectName(
    remoteProject.title || 'cloud-project',
    'cloud-project'
  )
  const projectPath =
    preferredProjectPath && !(await exists(preferredProjectPath))
      ? preferredProjectPath
      : await uniqueProjectPath(projectDirectory, projectName)
  const archive = await downloadRemoteProjectArchive(remoteProject.id)
  const files = withRemoteProjectMetadataInArchiveFiles(
    await parseProjectArchive(archive),
    remoteProject.title,
    remoteProject.id
  )
  const nextMetadata = {
    ...metadataForProject(projectPath),
    remoteProjectId: remoteProject.id,
  }

  await replaceLocalProjectWithFiles(projectPath, files)
  await markProjectSynced(
    nextMetadata,
    await projectManifestFromFiles(files),
    remoteSyncMetadata(remoteProject)
  )

  return {
    projectPath,
    projectName: projectNameFromPath(projectPath),
    remoteProjectId: remoteProject.id,
    remoteRevision: getRevision(remoteProject),
  }
}

export async function ensureOpfsCloudProjectLocallySynced(
  remoteProjectId: string
): Promise<OpfsCloudLocalProject | undefined> {
  if (!isConfiguredForCloud()) {
    return undefined
  }

  const projectId = remoteProjectId.trim()
  if (!projectId) {
    return undefined
  }

  const metadata = await getAllProjectMetadata()
  const knownLocalMetadata = metadata.find(
    (entry) => entry.remoteProjectId === projectId && !entry.tombstone
  )
  const projectDirectory = getConfiguredProjectDirectoryPath()
  const knownLocalProjectPath = knownLocalMetadata
    ? projectPathInDirectory(knownLocalMetadata, projectDirectory)
    : undefined
  if (
    knownLocalMetadata &&
    knownLocalProjectPath &&
    (await exists(knownLocalProjectPath))
  ) {
    scheduleSync(0)
    return localProjectFromMetadata(knownLocalMetadata)
  }
  if (knownLocalMetadata) {
    await deleteProjectMetadata(knownLocalMetadata.localProjectPath)
  }

  const remoteProject = await getRemoteProject(projectId)
  const projectName = sanitizeProjectName(
    remoteProject.title || 'cloud-project',
    'cloud-project'
  )
  await localFs.mkdir(projectDirectory, { recursive: true })

  const existingProjectPath = await findLocalProjectPathByRemoteProjectId(
    projectDirectory,
    projectId,
    projectName
  )
  if (existingProjectPath) {
    const nextMetadata = {
      ...(await getOrCreateProjectMetadata(existingProjectPath)),
      remoteProjectId: projectId,
      tombstone: false,
    }
    await putProjectMetadata(nextMetadata)
    scheduleSync(0)
    return localProjectFromMetadata(nextMetadata)
  }

  return cloneRemoteProjectToLocal(
    remoteProject,
    projectDirectory,
    knownLocalProjectPath
  )
}

async function readProjectTomlCloudProjectId(projectPath: string) {
  const environmentName = getEnvironmentName()
  const projectTomlPath = localFs.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  if (!(await exists(projectTomlPath))) {
    return undefined
  }

  const projectToml = await localFs.readFile(projectTomlPath, {
    encoding: 'utf-8',
  })
  const projectIdPattern = /project_id\s*=\s*"([^"]+)"/

  if (environmentName) {
    const escapedEnvironmentName = environmentName.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    )
    const sectionPattern = new RegExp(
      `\\[cloud\\."${escapedEnvironmentName}"\\]([\\s\\S]*?)(?=\\n\\[|$)`
    )
    const sectionMatch = sectionPattern.exec(projectToml)
    const projectIdMatch = sectionMatch
      ? projectIdPattern.exec(sectionMatch[1])
      : undefined
    if (projectIdMatch?.[1]) {
      return projectIdMatch[1]
    }
  }

  return projectIdPattern.exec(projectToml)?.[1]
}

function metadataForProject(projectPath: string): ProjectMetadata {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  return {
    schemaVersion: 1,
    localProjectPath: normalizedProjectPath,
    projectName: projectNameFromPath(normalizedProjectPath),
  }
}

async function getOrCreateProjectMetadata(projectPath: string) {
  const normalizedProjectPath = normalizePathForSync(projectPath)
  const existing = await getProjectMetadata(normalizedProjectPath)
  if (existing) {
    return existing
  }

  return metadataForProject(normalizedProjectPath)
}

async function bindRemoteProjectIdFromToml(metadata: ProjectMetadata) {
  if (metadata.remoteProjectId) {
    return metadata
  }

  const projectId = await readProjectTomlCloudProjectId(
    metadata.localProjectPath
  ).catch(() => undefined)
  if (!projectId) {
    return metadata
  }

  const next = {
    ...metadata,
    remoteProjectId: projectId,
  }
  await putProjectMetadata(next)
  return next
}

async function markProjectFailure(
  metadata: ProjectMetadata,
  error: unknown
): Promise<void> {
  const message = errorMessage(error)
  const next = {
    ...metadata,
    lastFailure: {
      message,
      at: nowIso(),
    },
  }
  await putProjectMetadata(next)
  updateStatus({
    state: 'failed',
    lastFailure: message,
    lastFailureAt: next.lastFailure.at,
  })
}

function markCloudMetadataFailure(error: unknown) {
  if (!isConfiguredForCloud()) {
    return
  }

  initialLocalScanComplete = false
  updateStatus({
    enabled: true,
    state: 'failed',
    lastFailure: errorMessage(error),
    lastFailureAt: nowIso(),
  })
  scheduleSync(SYNC_RETRY_MS)
}

async function markProjectSynced(
  metadata: ProjectMetadata,
  baseManifest: ProjectManifest,
  remote?: {
    revision?: Revision
    updatedAt?: string
  }
) {
  const syncedAt = nowIso()
  await putProjectMetadata({
    ...metadata,
    baseManifest,
    remoteRevision: remote?.revision ?? metadata.remoteRevision,
    remoteUpdatedAt: remote?.updatedAt ?? metadata.remoteUpdatedAt,
    tombstone: false,
    conflict: undefined,
    lastFailure: undefined,
    lastSyncedAt: syncedAt,
  })
  if (syncInProgress) {
    pendingStatusSyncedAt = syncedAt
    updateStatus({
      lastSyncedAt: syncedAt,
      lastFailure: undefined,
      lastFailureAt: undefined,
    })
    return
  }

  updateStatus({
    state: 'idle',
    activeProjectPath: undefined,
    lastSyncedAt: syncedAt,
    lastFailure: undefined,
    lastFailureAt: undefined,
  })
}

async function hydrateCleanLocalProjectTitle(
  metadata: ProjectMetadata,
  remoteTitle?: string
) {
  if (!remoteTitle?.trim() || !(await exists(metadata.localProjectPath))) {
    return metadata
  }

  const projectTomlPath = localFs.join(
    metadata.localProjectPath,
    PROJECT_SETTINGS_FILE_NAME
  )
  const existingProjectToml = (await exists(projectTomlPath))
    ? await localFs.readFile(projectTomlPath, { encoding: 'utf-8' })
    : ''
  if (
    getProjectTitleFromProjectTomlContents(existingProjectToml) === remoteTitle
  ) {
    return metadata
  }

  const beforeFiles = await collectLocalProjectFiles(metadata.localProjectPath)
  const beforeManifest = await projectManifestFromFiles(beforeFiles)
  const localClean =
    !metadata.baseManifest ||
    projectManifestsEqual(beforeManifest, metadata.baseManifest)
  if (!localClean) {
    return metadata
  }

  const titleChanged = await writeLocalProjectTitle(
    metadata.localProjectPath,
    remoteTitle
  )
  if (!titleChanged) {
    return metadata
  }

  const afterFiles = await collectLocalProjectFiles(metadata.localProjectPath)
  const nextMetadata = {
    ...metadata,
    baseManifest: await projectManifestFromFiles(afterFiles),
  }
  await putProjectMetadata(nextMetadata)
  return nextMetadata
}

async function markProjectConflict(
  metadata: ProjectMetadata,
  remoteRevision: Revision | undefined,
  remoteFiles: ProjectArchiveFile[],
  remoteTitle?: string
) {
  const parentDirectory = localFs.dirname(metadata.localProjectPath)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const conflictName = `${metadata.projectName} (cloud conflict ${stamp})`
  const conflictProjectPath = await uniqueProjectPath(
    parentDirectory,
    conflictName
  )

  await replaceLocalProjectWithFiles(
    conflictProjectPath,
    withProjectTitleInArchiveFiles(remoteFiles, remoteTitle)
  )

  await putProjectMetadata({
    ...metadata,
    conflict: {
      remoteRevision,
      conflictProjectPath,
      createdAt: nowIso(),
    },
    lastFailure: {
      message: 'Cloud sync conflict: local and remote both changed.',
      at: nowIso(),
    },
  })
  updateStatus({
    state: 'conflict',
    activeProjectPath: metadata.localProjectPath,
    lastFailure: 'Cloud sync conflict: local and remote both changed.',
    lastFailureAt: nowIso(),
  })
}

function latestOutboxKind(entries: OutboxEntry[]) {
  return entries.toSorted((a, b) => (a.id ?? 0) - (b.id ?? 0)).at(-1)?.kind
}

async function syncDeletedProject(metadata: ProjectMetadata) {
  if (metadata.remoteProjectId) {
    try {
      await deleteRemoteProject(metadata.remoteProjectId)
    } catch (error) {
      if (!(error instanceof CloudApiError && error.status === 404)) {
        throw error
      }
    }
  }

  await clearOutboxEntriesForProject(metadata.localProjectPath)
  await deleteProjectMetadata(metadata.localProjectPath)
}

async function syncProject(projectPath: string, entries: OutboxEntry[]) {
  let metadata = await getOrCreateProjectMetadata(projectPath)
  updateStatus({
    state: 'syncing',
    activeProjectPath: metadata.localProjectPath,
  })

  try {
    const latestKind = latestOutboxKind(entries)
    if (latestKind === 'delete' || metadata.tombstone) {
      await syncDeletedProject(metadata)
      return
    }

    if (!(await exists(metadata.localProjectPath))) {
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      return
    }

    metadata = await bindRemoteProjectIdFromToml(metadata)
    if (metadata.remoteProjectId) {
      await writeLocalProjectCloudProjectId(
        metadata.localProjectPath,
        metadata.remoteProjectId
      )
    }
    const localFiles = await collectLocalProjectFiles(metadata.localProjectPath)
    const localManifest = await projectManifestFromFiles(localFiles)

    if (!metadata.remoteProjectId) {
      const created = await createRemoteProject(
        metadata.localProjectPath,
        localFiles
      )
      await writeLocalProjectCloudProjectId(
        metadata.localProjectPath,
        created.id
      )
      const nextLocalFiles = await collectLocalProjectFiles(
        metadata.localProjectPath
      )
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        {
          ...metadata,
          remoteProjectId: created.id,
        },
        await projectManifestFromFiles(nextLocalFiles),
        remoteSyncMetadata(created, { useNowAsUpdatedAtFallback: true })
      )
      return
    }

    const remoteProject = await getRemoteProject(metadata.remoteProjectId)
    const remoteRevision = getRevision(remoteProject)
    const remoteChanged =
      Boolean(metadata.remoteRevision && remoteRevision) &&
      metadata.remoteRevision !== remoteRevision
    const localChanged = metadata.baseManifest
      ? !projectManifestsEqual(localManifest, metadata.baseManifest)
      : true

    if (!localChanged && !remoteChanged) {
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        localManifest,
        remoteSyncMetadata(remoteProject)
      )
      return
    }

    if (localChanged && !remoteChanged && metadata.remoteRevision) {
      const updated = await updateRemoteProject({
        projectPath: metadata.localProjectPath,
        projectId: metadata.remoteProjectId,
        files: localFiles,
        expectedRevision: metadata.remoteRevision,
      })
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        localManifest,
        remoteSyncMetadata(updated, { useNowAsUpdatedAtFallback: true })
      )
      return
    }

    const remoteArchive = await downloadRemoteProjectArchive(
      metadata.remoteProjectId
    )
    const remoteFiles = withRemoteProjectMetadataInArchiveFiles(
      await parseProjectArchive(remoteArchive),
      remoteProject.title,
      metadata.remoteProjectId
    )
    const remoteManifest = await projectManifestFromFiles(remoteFiles)

    if (
      !metadata.baseManifest &&
      projectManifestsEqual(localManifest, remoteManifest)
    ) {
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        localManifest,
        remoteSyncMetadata(remoteProject)
      )
      return
    }

    const localClean = Boolean(
      metadata.baseManifest &&
        projectManifestsEqual(localManifest, metadata.baseManifest)
    )
    if (localClean) {
      await replaceLocalProjectWithFiles(metadata.localProjectPath, remoteFiles)
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        remoteManifest,
        remoteSyncMetadata(remoteProject)
      )
      return
    }

    if (projectManifestsEqual(localManifest, remoteManifest)) {
      await clearOutboxEntriesForProject(metadata.localProjectPath)
      await markProjectSynced(
        metadata,
        localManifest,
        remoteSyncMetadata(remoteProject)
      )
      return
    }

    await markProjectConflict(
      metadata,
      remoteRevision,
      remoteFiles,
      remoteProject.title
    )
  } catch (error) {
    await markProjectFailure(metadata, error)
    throw error
  }
}

async function syncRemoteIndex() {
  const now = Date.now()
  if (now - lastRemoteIndexSyncAt < REMOTE_INDEX_INTERVAL_MS) {
    return
  }

  const projectDirectory = getConfiguredProjectDirectoryPath()
  await localFs.mkdir(projectDirectory, { recursive: true })

  const remoteProjects = await listRemoteProjects()
  let metadata = await getAllProjectMetadata()
  const tombstonedRemoteProjectIds = new Set(
    metadata
      .filter((entry) => entry.tombstone && entry.remoteProjectId)
      .map((entry) => entry.remoteProjectId)
  )
  const failures: unknown[] = []

  const upsertMetadata = (nextMetadata: ProjectMetadata) => {
    metadata = [
      ...metadata.filter(
        (entry) =>
          normalizePathForSync(entry.localProjectPath) !==
          normalizePathForSync(nextMetadata.localProjectPath)
      ),
      nextMetadata,
    ]
  }

  for (const remoteProject of remoteProjects) {
    if (!remoteProject.id || tombstonedRemoteProjectIds.has(remoteProject.id)) {
      continue
    }

    try {
      const knownLocalMetadata = metadata.find(
        (entry) => entry.remoteProjectId === remoteProject.id
      )
      if (knownLocalMetadata) {
        const knownLocalProjectPath = projectPathInDirectory(
          knownLocalMetadata,
          projectDirectory
        )
        const knownLocalPathIsCurrent =
          knownLocalProjectPath && (await exists(knownLocalProjectPath))
        if (!knownLocalPathIsCurrent) {
          await deleteProjectMetadata(knownLocalMetadata.localProjectPath)
          metadata = metadata.filter((entry) => entry !== knownLocalMetadata)
          const clonedProject = await cloneRemoteProjectToLocal(
            remoteProject,
            projectDirectory,
            knownLocalProjectPath
          )
          const clonedMetadata = await getProjectMetadata(
            clonedProject.projectPath
          )
          if (clonedMetadata) {
            upsertMetadata(clonedMetadata)
          }
          continue
        }

        const nextLocalMetadata = await hydrateCleanLocalProjectTitle(
          knownLocalMetadata,
          remoteProject.title
        )
        const remoteRevision = getRevision(remoteProject)
        if (
          remoteRevision &&
          nextLocalMetadata.remoteRevision &&
          remoteRevision !== nextLocalMetadata.remoteRevision
        ) {
          await syncProject(nextLocalMetadata.localProjectPath, [])
          const syncedMetadata = await getProjectMetadata(
            nextLocalMetadata.localProjectPath
          )
          if (syncedMetadata) {
            upsertMetadata(syncedMetadata)
          }
        } else {
          const remoteUpdatedAt = getRemoteUpdatedAt(remoteProject)
          const indexedMetadata = remoteUpdatedAt
            ? {
                ...nextLocalMetadata,
                remoteUpdatedAt,
              }
            : nextLocalMetadata
          if (indexedMetadata !== nextLocalMetadata) {
            await putProjectMetadata(indexedMetadata)
          }
          upsertMetadata(indexedMetadata)
        }
        continue
      }

      const projectName = sanitizeProjectName(
        remoteProject.title || 'cloud-project',
        'cloud-project'
      )
      const existingProjectPath = await findLocalProjectPathByRemoteProjectId(
        projectDirectory,
        remoteProject.id,
        projectName
      )
      if (existingProjectPath) {
        const nextMetadata = {
          ...(await getOrCreateProjectMetadata(existingProjectPath)),
          remoteProjectId: remoteProject.id,
          remoteUpdatedAt: getRemoteUpdatedAt(remoteProject),
        }
        await putProjectMetadata(nextMetadata)
        upsertMetadata(nextMetadata)
        await syncProject(existingProjectPath, [])
        const syncedMetadata = await getProjectMetadata(existingProjectPath)
        if (syncedMetadata) {
          upsertMetadata(syncedMetadata)
        }
        continue
      }

      const clonedProject = await cloneRemoteProjectToLocal(
        remoteProject,
        projectDirectory
      )
      const clonedMetadata = await getProjectMetadata(clonedProject.projectPath)
      if (clonedMetadata) {
        upsertMetadata(clonedMetadata)
      }
    } catch (error) {
      failures.push(error)
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Cloud sync failed for ${failures.length} remote project${
        failures.length === 1 ? '' : 's'
      }: ${errorMessage(failures.at(-1))}`
    )
  }

  lastRemoteIndexSyncAt = Date.now()
}

async function enqueueExistingLocalProjectsForInitialSync() {
  if (initialLocalScanComplete) {
    return
  }

  const projectDirectory = getConfiguredProjectDirectoryPath()
  if (!(await exists(projectDirectory))) {
    initialLocalScanComplete = true
    return
  }

  const entries = await localFs.readdir(projectDirectory)
  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue
    }
    const projectPath = localFs.join(projectDirectory, entry)
    const stat = await localFs.stat(projectPath)
    if (!statIsDirectory(stat)) {
      continue
    }

    const metadata = await getProjectMetadata(projectPath)
    if (metadata?.baseManifest && !metadata.tombstone) {
      continue
    }

    await registerProjectMutation(projectPath, 'upsert', projectPath)
  }

  initialLocalScanComplete = true
}

async function runCloudSync() {
  if (!isConfiguredForCloud()) {
    return
  }
  if (syncInProgress) {
    scheduleSync(SYNC_DEBOUNCE_MS)
    return
  }

  syncInProgress = true
  pendingStatusSyncedAt = undefined
  updateStatus({ enabled: true, state: 'syncing' })
  let remoteIndexFailed = false
  let remoteIndexFailureMessage: string | undefined

  try {
    await enqueueExistingLocalProjectsForInitialSync()
    await syncRemoteIndex().catch((error) => {
      remoteIndexFailed = true
      remoteIndexFailureMessage = errorMessage(error)
      updateStatus({
        state: 'failed',
        lastFailure: remoteIndexFailureMessage,
        lastFailureAt: nowIso(),
      })
    })

    const entries = await getAllOutboxEntries()
    const projectPaths = Array.from(
      new Set(entries.map((entry) => normalizePathForSync(entry.projectPath)))
    )

    for (const projectPath of projectPaths) {
      const projectEntries = entries.filter(
        (entry) => normalizePathForSync(entry.projectPath) === projectPath
      )
      await syncProject(projectPath, projectEntries)
    }

    await refreshPendingCount()
    const syncedAt = pendingStatusSyncedAt
    if (opfsCloudSyncStatus.value.state !== 'conflict' && remoteIndexFailed) {
      updateStatus({
        state: 'failed',
        activeProjectPath: undefined,
        lastFailure: remoteIndexFailureMessage,
        lastFailureAt: nowIso(),
        ...(syncedAt ? { lastSyncedAt: syncedAt } : {}),
      })
      scheduleSync(SYNC_RETRY_MS)
    } else if (opfsCloudSyncStatus.value.state !== 'conflict') {
      updateStatus({
        state: 'idle',
        activeProjectPath: undefined,
        ...(syncedAt
          ? {
              lastSyncedAt: syncedAt,
              lastFailure: undefined,
              lastFailureAt: undefined,
            }
          : {}),
      })
    }
    if (
      opfsCloudSyncStatus.value.pendingCount > 0 &&
      opfsCloudSyncStatus.value.state !== 'conflict'
    ) {
      scheduleSync(SYNC_DEBOUNCE_MS)
    }
  } catch (error) {
    const syncedAt = pendingStatusSyncedAt
    updateStatus({
      state: 'failed',
      lastFailure: errorMessage(error),
      lastFailureAt: nowIso(),
      activeProjectPath: undefined,
      ...(syncedAt ? { lastSyncedAt: syncedAt } : {}),
    })
    scheduleSync(SYNC_RETRY_MS)
  } finally {
    syncInProgress = false
    pendingStatusSyncedAt = undefined
    if (
      opfsCloudSyncStatus.value.pendingCount > 0 &&
      opfsCloudSyncStatus.value.state !== 'conflict'
    ) {
      scheduleSync(SYNC_DEBOUNCE_MS)
    }
  }
}

function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  if (!isConfiguredForCloud()) {
    return
  }
  if (syncTimer) {
    clearTimeout(syncTimer)
  }

  syncTimer = setTimeout(() => {
    syncTimer = undefined
    void runCloudSync()
  }, delay)
}

async function registerProjectMutation(
  projectPath: string,
  kind: OutboxEntry['kind'],
  targetPath: string,
  sourcePath?: string
) {
  if (!isConfiguredForCloud() || isInternalOpfsPath(targetPath)) {
    return
  }

  const normalizedProjectPath = normalizePathForSync(projectPath)
  let metadata = await getOrCreateProjectMetadata(normalizedProjectPath)
  metadata = await bindRemoteProjectIdFromToml(metadata)

  if (kind === 'delete') {
    metadata = {
      ...metadata,
      tombstone: true,
    }
    await putProjectMetadata(metadata)
  } else if (!metadata.tombstone) {
    await putProjectMetadata(metadata)
  }

  await appendOutboxEntry({
    projectPath: normalizedProjectPath,
    kind,
    targetPath: normalizePathForSync(targetPath),
    sourcePath: sourcePath ? normalizePathForSync(sourcePath) : undefined,
    createdAt: nowIso(),
  })
  scheduleSync()
}

async function registerProjectRename(sourcePath: string, targetPath: string) {
  if (!isConfiguredForCloud()) {
    return
  }

  const sourceProjectRoot = getOpfsCloudProjectRoot(sourcePath)
  const targetProjectRoot = getOpfsCloudProjectRoot(targetPath)
  if (!targetProjectRoot) {
    return
  }

  if (
    sourceProjectRoot &&
    isProjectRootPath(sourcePath, sourceProjectRoot) &&
    isProjectRootPath(targetPath, targetProjectRoot)
  ) {
    const sourceMetadata = await getProjectMetadata(sourceProjectRoot)
    if (sourceMetadata) {
      await clearOutboxEntriesForProject(sourceProjectRoot)
      await deleteProjectMetadata(sourceProjectRoot)
      await putProjectMetadata({
        ...sourceMetadata,
        localProjectPath: normalizePathForSync(targetProjectRoot),
        projectName: projectNameFromPath(targetProjectRoot),
        tombstone: false,
      })
    }
  }

  await registerProjectMutation(
    targetProjectRoot,
    'upsert',
    targetPath,
    sourcePath
  )
}

async function afterWriteLikeMutation(targetPath: string) {
  const projectRoot = getOpfsCloudProjectRoot(targetPath)
  if (!projectRoot) {
    if (isOpfsCloudProjectDirectoryPath(targetPath)) {
      scheduleSync()
    }
    return
  }

  await registerProjectMutation(projectRoot, 'upsert', targetPath)
}

async function afterRemoveMutation(targetPath: string) {
  const projectRoot = getOpfsCloudProjectRoot(targetPath)
  if (!projectRoot) {
    return
  }

  await registerProjectMutation(
    projectRoot,
    isProjectRootPath(targetPath, projectRoot) ? 'delete' : 'upsert',
    targetPath
  )
}

export function configureOpfsCloudSync(nextConfig: OPFSCloudConfig) {
  const previousConfig = config
  config = {
    ...config,
    ...nextConfig,
  }
  const cloudIdentityChanged =
    previousConfig.token !== config.token ||
    previousConfig.baseUrl !== config.baseUrl ||
    previousConfig.environmentName !== config.environmentName
  const projectDirectoryChanged =
    previousConfig.projectDirectoryPath !== config.projectDirectoryPath
  if (cloudIdentityChanged || projectDirectoryChanged) {
    lastRemoteIndexSyncAt = 0
    initialLocalScanComplete = false
  }

  if (!config.enabled) {
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = undefined
    }
    initialLocalScanComplete = false
    lastRemoteIndexSyncAt = 0
    updateStatus({
      enabled: false,
      state: 'disabled',
      activeProjectPath: undefined,
    })
    return
  }

  updateStatus({
    enabled: true,
    state: 'idle',
  })
  void refreshPendingCount()
  scheduleSync(0)
}

export function retryOpfsCloudSync() {
  scheduleSync(0)
}

type ReadFileOptions = undefined | 'utf8' | { encoding: 'utf-8' }

const readFile = (async (targetPath: string, options?: ReadFileOptions) => {
  const result = await localFs.readFile(targetPath, options)
  if (isConfiguredForCloud()) {
    const projectRoot = getOpfsCloudProjectRoot(targetPath)
    if (projectRoot || isOpfsCloudProjectDirectoryPath(targetPath)) {
      scheduleSync()
    }
  }
  return result
}) as IZooDesignStudioFS['readFile']

const readdir: IZooDesignStudioFS['readdir'] = async (targetPath, options) => {
  const result = await localFs.readdir(targetPath, options)
  if (isConfiguredForCloud()) {
    const projectRoot = getOpfsCloudProjectRoot(targetPath)
    if (projectRoot || isOpfsCloudProjectDirectoryPath(targetPath)) {
      scheduleSync()
    }
  }
  return result
}

const stat: IZooDesignStudioFS['stat'] = async (targetPath, options) => {
  const result = await localFs.stat(targetPath, options)
  if (isConfiguredForCloud()) {
    const projectRoot = getOpfsCloudProjectRoot(targetPath)
    if (projectRoot || isOpfsCloudProjectDirectoryPath(targetPath)) {
      scheduleSync()
    }
  }
  return result
}

const writeFile: IZooDesignStudioFS['writeFile'] = async (
  targetPath,
  data,
  options
) => {
  const result = await localFs.writeFile(targetPath, data, options)
  await afterWriteLikeMutation(targetPath).catch(markCloudMetadataFailure)
  return result
}

const mkdir: IZooDesignStudioFS['mkdir'] = async (targetPath, options) => {
  const result = await localFs.mkdir(targetPath, options)
  await afterWriteLikeMutation(targetPath).catch(markCloudMetadataFailure)
  return result
}

const cp: IZooDesignStudioFS['cp'] = async (
  sourcePath,
  targetPath,
  options
) => {
  const result = await localFs.cp(sourcePath, targetPath, options)
  await afterWriteLikeMutation(targetPath).catch(markCloudMetadataFailure)
  return result
}

const rm: IZooDesignStudioFS['rm'] = async (targetPath, options) => {
  const result = await localFs.rm(targetPath, options)
  await afterRemoveMutation(targetPath).catch(markCloudMetadataFailure)
  return result
}

const rename: IZooDesignStudioFS['rename'] = async (
  sourcePath,
  targetPath,
  options
) => {
  const result = await localFs.rename(sourcePath, targetPath, options)
  await registerProjectRename(sourcePath, targetPath).catch(
    markCloudMetadataFailure
  )
  return result
}

const impl: IZooDesignStudioFS = {
  resolve: localFs.resolve.bind(localFs),
  join: localFs.join.bind(localFs),
  relative: localFs.relative.bind(localFs),
  extname: localFs.extname.bind(localFs),
  sep: localFs.sep,
  basename: localFs.basename.bind(localFs),
  dirname: localFs.dirname.bind(localFs),
  getPath: localFs.getPath,
  access: localFs.access,
  cp,
  readFile,
  rename,
  writeFile,
  readdir,
  stat,
  mkdir,
  rm,
  detach: async () => {
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = undefined
    }
    syncInProgress = false
    await localFs.detach()
  },
  attach: async () => {
    await localFs.attach()
    if (isConfiguredForCloud()) {
      scheduleSync(0)
    }
  },
}

export default {
  impl,
}
