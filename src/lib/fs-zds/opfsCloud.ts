import path from 'node:path'
import {
  type ProjectResponse,
  type ProjectSummaryResponse,
  projects,
  users,
} from '@kittycad/lib'
import JSZip from 'jszip'

import env from '@src/env'
import {
  COOKIE_NAME_PREFIX,
  IS_PLAYWRIGHT_KEY,
  LEGACY_COOKIE_NAME,
  PROJECT_FOLDER,
  TOKEN_PERSIST_KEY,
  VERCEL_PLAYWRIGHT_TOKEN_QUERY_PARAM,
} from '@src/lib/constants'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import opfs from '@src/lib/fs-zds/opfs'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import { err } from '@src/lib/trap'

const WEB_APP_FILE_BROWSER_FEATURE_FLAG = 'web_app_file_browser'
const PROJECT_DOWNLOAD_FORMAT = 'zip'
const CLOUD_WRITE_DEBOUNCE_MS = 5_000
const CLOUD_READ_CACHE_MS = 10_000
const CLOUD_SYNC_METADATA_KEY = 'zdsFS:cloudSyncMetadata'

type CloudSyncProjectMetadata = {
  projectId?: string
  title?: string
  lastCloudFailedAt?: string
  lastCloudFailedMessage?: string
  lastCloudSyncedAt?: string
}

type CloudSyncMetadata = {
  projects: Record<string, CloudSyncProjectMetadata>
}

type DownloadedProjectArchive = {
  archive: ArrayBuffer
  contentDisposition: string | null
}

type ParsedArchiveFile = {
  relativePath: string
  data: Uint8Array<ArrayBuffer>
}

type RemoteProjectFiles = {
  files: ParsedArchiveFile[]
  entrypointPath?: string
}

type ReadFileOptions = undefined | 'utf8' | { encoding?: 'utf-8' }
type ReadFileReturn<T> = T extends 'utf8' | { encoding: 'utf-8' }
  ? string
  : Uint8Array<ArrayBuffer>

export type OPFSCloudOptions = Record<string, never>

const local = opfs.impl

const projectHydratedAt = new Map<string, number>()
const pendingProjectWrites = new Map<string, ReturnType<typeof setTimeout>>()
const dirtyProjects = new Set<string>()
const deletedProjects = new Set<string>()
let webAppFileBrowserFeatureEnabled = false
let projectsListCache:
  | {
      fetchedAt: number
      projects: ProjectSummaryResponse[]
    }
  | undefined
let projectRootHydrationPromise: Promise<void> | undefined

export async function userHasWebAppFileBrowserFeature(): Promise<boolean> {
  const token = getTokenFromEnvOrCookie()
  if (!token) {
    webAppFileBrowserFeatureEnabled = false
    return false
  }

  const result = await kcCall(() =>
    users.user_features_get({ client: createKCClient(token) })
  )
  if (err(result)) {
    console.error(
      `Error checking feature flag ${WEB_APP_FILE_BROWSER_FEATURE_FLAG}:`,
      result.message
    )
    webAppFileBrowserFeatureEnabled = false
    return false
  }

  webAppFileBrowserFeatureEnabled = result.features.some(
    (feature: { id: string }) =>
      feature.id === WEB_APP_FILE_BROWSER_FEATURE_FLAG
  )
  return webAppFileBrowserFeatureEnabled
}

export function hasWebAppFileBrowserFeatureEnabled() {
  return webAppFileBrowserFeatureEnabled
}

export function getCloudSyncMetadata(): CloudSyncMetadata {
  if (typeof window === 'undefined') {
    return { projects: {} }
  }

  const stored = window.localStorage?.getItem(CLOUD_SYNC_METADATA_KEY)
  if (!stored) {
    return { projects: {} }
  }

  try {
    const parsed = JSON.parse(stored) as Partial<CloudSyncMetadata>
    return {
      projects: parsed.projects ?? {},
    }
  } catch {
    return { projects: {} }
  }
}

function setCloudSyncMetadata(metadata: CloudSyncMetadata) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage?.setItem(
    CLOUD_SYNC_METADATA_KEY,
    JSON.stringify(metadata)
  )
}

function updateProjectMetadata(
  projectPath: string,
  update: (
    metadata: CloudSyncProjectMetadata
  ) => CloudSyncProjectMetadata | undefined
) {
  const metadata = getCloudSyncMetadata()
  const current = metadata.projects[projectPath] ?? {}
  const next = update(current)
  if (next) {
    metadata.projects[projectPath] = next
  } else {
    delete metadata.projects[projectPath]
  }
  setCloudSyncMetadata(metadata)
}

function recordCloudFailure(projectPath: string, error: unknown) {
  updateProjectMetadata(projectPath, (metadata) => ({
    ...metadata,
    lastCloudFailedAt: new Date().toISOString(),
    lastCloudFailedMessage:
      error instanceof Error ? error.message : String(error),
  }))
}

function recordCloudSuccess(
  projectPath: string,
  project: Pick<ProjectResponse | ProjectSummaryResponse, 'id' | 'title'>
) {
  updateProjectMetadata(projectPath, (metadata) => ({
    ...metadata,
    projectId: project.id,
    title: project.title,
    lastCloudSyncedAt: new Date().toISOString(),
    lastCloudFailedAt: undefined,
    lastCloudFailedMessage: undefined,
  }))
}

function getTokenFromEnvOrCookie(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const queryParams = new URLSearchParams(window.location?.search ?? '')
  const queryToken = queryParams.get(VERCEL_PLAYWRIGHT_TOKEN_QUERY_PARAM)
  if (queryToken) {
    window.localStorage?.setItem(TOKEN_PERSIST_KEY, queryToken)
    window.localStorage?.setItem(IS_PLAYWRIGHT_KEY, 'true')
    return queryToken
  }

  const envToken = env().VITE_ZOO_API_TOKEN
  if (envToken) {
    return envToken
  }

  const cookieToken = getCookie()
  if (cookieToken) {
    return cookieToken
  }

  if (window.localStorage?.getItem(IS_PLAYWRIGHT_KEY) === 'true') {
    return window.localStorage?.getItem(TOKEN_PERSIST_KEY) ?? ''
  }

  return ''
}

function getCookie() {
  const baseDomain = env().VITE_ZOO_BASE_DOMAIN
  if (baseDomain === 'zoo.dev' || baseDomain === 'zoogov.dev') {
    return getCookieByName(LEGACY_COOKIE_NAME)
  }
  return getCookieByName(COOKIE_NAME_PREFIX + baseDomain)
}

function getCookieByName(name: string): string {
  const cookieName = `${name}=`
  const decodedCookie = decodeURIComponent(document.cookie)
  const cookies = decodedCookie.split(';')

  for (let cookie of cookies) {
    while (cookie.charAt(0) === ' ') {
      cookie = cookie.substring(1)
    }
    if (cookie.indexOf(cookieName) === 0) {
      return cookie.substring(cookieName.length, cookie.length)
    }
  }

  return ''
}

async function getProjectRootDirectory() {
  return path.join(await local.getPath('documents'), PROJECT_FOLDER)
}

async function getProjectPathForPath(targetPath: string) {
  const projectRootDirectory = await getProjectRootDirectory()
  const relativePath = path.relative(projectRootDirectory, targetPath)

  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    return undefined
  }

  const projectName = relativePath.split(path.sep)[0]
  if (!projectName) {
    return undefined
  }

  return path.join(projectRootDirectory, projectName)
}

async function isProjectRootDirectory(targetPath: string) {
  return (
    path.resolve(targetPath) === path.resolve(await getProjectRootDirectory())
  )
}

async function isProjectDirectory(targetPath: string) {
  const projectRootDirectory = await getProjectRootDirectory()
  return (
    path.dirname(path.resolve(targetPath)) ===
    path.resolve(projectRootDirectory)
  )
}

function getClient() {
  const token = getTokenFromEnvOrCookie()
  if (!token) {
    return undefined
  }

  return createKCClient(token)
}

async function listRemoteProjects() {
  const client = getClient()
  if (!client) {
    return undefined
  }

  const now = Date.now()
  if (
    projectsListCache &&
    now - projectsListCache.fetchedAt < CLOUD_READ_CACHE_MS
  ) {
    return projectsListCache.projects
  }

  const result = await kcCall(() => projects.list_projects({ client }))
  if (err(result)) {
    return undefined
  }

  projectsListCache = {
    fetchedAt: now,
    projects: result,
  }
  return result
}

async function findRemoteProjectByPath(projectPath: string) {
  const metadata = getCloudSyncMetadata().projects[projectPath]
  const remoteProjects = await listRemoteProjects()
  if (!remoteProjects) {
    return undefined
  }

  if (metadata?.projectId) {
    const project = remoteProjects.find(({ id }) => id === metadata.projectId)
    if (project) {
      return project
    }
  }

  const projectName = path.basename(projectPath)
  return remoteProjects.find(({ title }) => title === projectName)
}

export function hydrateProjectRootFromCloud(): Promise<void> {
  if (projectRootHydrationPromise) {
    return projectRootHydrationPromise
  }

  projectRootHydrationPromise = hydrateProjectRootFromCloudNow().finally(() => {
    projectRootHydrationPromise = undefined
  })
  return projectRootHydrationPromise
}

async function hydrateProjectRootFromCloudNow() {
  const remoteProjects = await hydrateProjectListFromCloud()
  if (!remoteProjects) {
    return
  }

  const projectRootDirectory = await getProjectRootDirectory()
  await Promise.all(
    remoteProjects.map(async (remoteProject) => {
      const projectPath = path.join(projectRootDirectory, remoteProject.title)
      if (dirtyProjects.has(projectPath) || deletedProjects.has(projectPath)) {
        return
      }
      await hydrateProjectFromCloud(projectPath, remoteProject)
    })
  )
}

async function hydrateProjectListFromCloud() {
  const remoteProjects = await listRemoteProjects()
  if (!remoteProjects) {
    return undefined
  }

  const projectRootDirectory = await getProjectRootDirectory()
  await ensureLocalDirectory(projectRootDirectory)

  for (const remoteProject of remoteProjects) {
    const projectPath = path.join(projectRootDirectory, remoteProject.title)
    if (deletedProjects.has(projectPath)) {
      continue
    }
    await ensureLocalDirectory(projectPath)
    recordCloudSuccess(projectPath, remoteProject)
  }

  return remoteProjects
}

async function hydratePathFromCloud(targetPath: string) {
  if (await isProjectRootDirectory(targetPath)) {
    await hydrateProjectRootFromCloud()
    return
  }

  const projectPath = await getProjectPathForPath(targetPath)
  if (!projectPath || dirtyProjects.has(projectPath)) {
    return
  }

  const hydratedAt = projectHydratedAt.get(projectPath) ?? 0
  if (Date.now() - hydratedAt < CLOUD_READ_CACHE_MS) {
    return
  }

  await hydrateProjectFromCloud(projectPath)
}

async function hydrateProjectFromCloud(
  projectPath: string,
  knownRemoteProject?: ProjectSummaryResponse
) {
  const remoteProject =
    knownRemoteProject ?? (await findRemoteProjectByPath(projectPath))
  if (!remoteProject) {
    return
  }

  const remoteFiles = await downloadRemoteProject(remoteProject.id)
  if (err(remoteFiles)) {
    recordCloudFailure(projectPath, remoteFiles)
    return
  }
  if (!remoteFiles) {
    return
  }

  await ensureLocalDirectory(projectPath)
  await removeLocalFilesMissingFromRemote(projectPath, remoteFiles.files)

  for (const file of remoteFiles.files) {
    const targetPath = path.join(projectPath, file.relativePath)
    await ensureLocalDirectory(path.dirname(targetPath))
    await local.writeFile(targetPath, file.data)
  }

  recordCloudSuccess(projectPath, remoteProject)
  projectHydratedAt.set(projectPath, Date.now())
}

async function downloadRemoteProject(projectId: string) {
  const client = getClient()
  if (!client) {
    return undefined
  }

  const originalFetch = client.fetch || fetch
  client.fetch = async (input, init) => {
    const response = await originalFetch(
      ensureProjectDownloadFormat(input),
      init
    )
    if (!response.ok || isJsonResponse(response)) {
      return response
    }

    const archive = await response.arrayBuffer()
    return createArchiveResponse(response, archive)
  }

  const result = await kcCall(async () => {
    try {
      return await projects.download_project({
        client,
        id: projectId,
      })
    } finally {
      client.fetch = originalFetch
    }
  })

  if (err(result)) {
    return result
  }

  return parseDownloadedProject(result as DownloadedProjectArchive)
}

function ensureProjectDownloadFormat(input: RequestInfo | URL) {
  const url = getRequestUrl(input)
  if (
    !url ||
    !/\/user\/projects\/[^/]+\/download$/.test(url.pathname) ||
    url.searchParams.has('format')
  ) {
    return input
  }

  url.searchParams.set('format', PROJECT_DOWNLOAD_FORMAT)

  if (typeof input === 'string' || input instanceof URL) {
    return url.toString()
  }

  return new Request(url.toString(), input)
}

function getRequestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string' || input instanceof URL) {
    return new URL(String(input), globalThis.location?.origin)
  }

  if (input instanceof Request) {
    return new URL(input.url, globalThis.location?.origin)
  }

  return undefined
}

function createArchiveResponse(response: Response, archive: ArrayBuffer) {
  const wrappedResponse = new Response(null, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
  const payload: DownloadedProjectArchive = {
    archive,
    contentDisposition: response.headers.get('content-disposition'),
  }

  Object.defineProperty(wrappedResponse, 'json', {
    value: async () => payload,
  })

  return wrappedResponse
}

function isJsonResponse(response: Response) {
  return response.headers.get('content-type')?.includes('application/json')
}

async function parseDownloadedProject({
  archive,
}: DownloadedProjectArchive): Promise<RemoteProjectFiles | undefined> {
  try {
    const zip = await JSZip.loadAsync(archive)
    const entries = Object.values(zip.files).filter((entry) => {
      return !entry.dir && !entry.name.startsWith('__MACOSX/')
    })
    const rootDirectory = getCommonArchiveRoot(
      entries.map((entry) => entry.name)
    )
    const files = await Promise.all(
      entries.map(async (entry) => ({
        relativePath: stripArchiveRoot(entry.name, rootDirectory),
        data: Uint8Array.from(
          await entry.async('uint8array')
        ) as Uint8Array<ArrayBuffer>,
      }))
    )

    return {
      files,
      entrypointPath: files.find((file) => file.relativePath.endsWith('.kcl'))
        ?.relativePath,
    }
  } catch (error) {
    console.error('Failed to parse cloud project archive:', error)
    return undefined
  }
}

function getCommonArchiveRoot(paths: string[]) {
  const normalizedPaths = paths.map(normalizeArchivePath).filter(Boolean)
  if (normalizedPaths.length === 0) {
    return undefined
  }

  const firstSegments = normalizedPaths.map(
    (entryPath) => entryPath.split('/')[0]
  )
  const [firstSegment] = firstSegments
  if (
    firstSegment &&
    firstSegments.every((segment) => segment === firstSegment) &&
    normalizedPaths.every((entryPath) => entryPath.includes('/'))
  ) {
    return firstSegment
  }

  return undefined
}

function stripArchiveRoot(entryPath: string, rootDirectory?: string) {
  const normalized = normalizeArchivePath(entryPath)
  if (!rootDirectory) {
    return normalized
  }

  return normalized.replace(new RegExp(`^${escapeRegExp(rootDirectory)}/`), '')
}

function normalizeArchivePath(entryPath: string) {
  return entryPath.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function removeLocalFilesMissingFromRemote(
  projectPath: string,
  remoteFiles: ParsedArchiveFile[]
) {
  const remotePaths = new Set(remoteFiles.map((file) => file.relativePath))
  const localFiles = await collectLocalProjectFiles(projectPath)

  await Promise.all(
    localFiles
      .filter((file) => !remotePaths.has(file.relativePath))
      .map((file) => local.rm(path.join(projectPath, file.relativePath)))
  )
}

async function ensureLocalDirectory(directoryPath: string) {
  try {
    await local.stat(directoryPath)
  } catch (error) {
    if (error === 'ENOENT') {
      await local.mkdir(directoryPath, { recursive: true })
    }
  }
}

function scheduleCloudWriteForPath(targetPath: string) {
  void getProjectPathForPath(targetPath).then((projectPath) => {
    if (!projectPath) {
      return
    }

    dirtyProjects.add(projectPath)
    deletedProjects.delete(projectPath)
    const pending = pendingProjectWrites.get(projectPath)
    if (pending) {
      clearTimeout(pending)
    }

    pendingProjectWrites.set(
      projectPath,
      setTimeout(() => {
        pendingProjectWrites.delete(projectPath)
        void syncProjectToCloud(projectPath)
      }, CLOUD_WRITE_DEBOUNCE_MS)
    )
  })
}

function scheduleCloudDeleteForPath(targetPath: string) {
  void getProjectPathForPath(targetPath).then(async (projectPath) => {
    if (!projectPath || !(await isProjectDirectory(targetPath))) {
      scheduleCloudWriteForPath(targetPath)
      return
    }

    clearPendingCloudWrite(projectPath)
    dirtyProjects.delete(projectPath)
    deletedProjects.add(projectPath)

    const metadata = getCloudSyncMetadata().projects[projectPath]
    const remoteProject = metadata?.projectId
      ? ({
          id: metadata.projectId,
          title: metadata.title ?? path.basename(projectPath),
        } as Pick<ProjectSummaryResponse, 'id' | 'title'>)
      : await findRemoteProjectByPath(projectPath)

    updateProjectMetadata(projectPath, () => undefined)
    projectsListCache = undefined

    if (!remoteProject?.id) {
      return
    }

    const client = getClient()
    if (!client) {
      return
    }

    const result = await kcCall(() =>
      projects.delete_project({ client, id: remoteProject.id })
    )
    if (err(result)) {
      recordCloudFailure(projectPath, result)
      return
    }
  })
}

function scheduleCloudRenameForPath(sourcePath: string, targetPath: string) {
  void Promise.all([
    isProjectDirectory(sourcePath),
    isProjectDirectory(targetPath),
    getProjectPathForPath(sourcePath),
    getProjectPathForPath(targetPath),
  ]).then(
    async ([
      sourceIsProject,
      targetIsProject,
      sourceProject,
      targetProject,
    ]) => {
      if (
        sourceIsProject &&
        targetIsProject &&
        sourceProject &&
        targetProject
      ) {
        const remoteProject = await findRemoteProjectByPath(sourceProject)
        moveProjectMetadata(sourceProject, targetProject, remoteProject)
        clearPendingCloudWrite(sourceProject)
        dirtyProjects.delete(sourceProject)
        scheduleCloudWriteForPath(targetProject)
        return
      }

      scheduleCloudWriteForPath(sourcePath)
      scheduleCloudWriteForPath(targetPath)
    }
  )
}

function clearPendingCloudWrite(projectPath: string) {
  const pending = pendingProjectWrites.get(projectPath)
  if (pending) {
    clearTimeout(pending)
    pendingProjectWrites.delete(projectPath)
  }
}

function moveProjectMetadata(
  sourceProjectPath: string,
  targetProjectPath: string,
  remoteProject?: Pick<ProjectSummaryResponse, 'id' | 'title'>
) {
  const metadata = getCloudSyncMetadata()
  const sourceMetadata = metadata.projects[sourceProjectPath]
  if (!sourceMetadata && !remoteProject) {
    return
  }

  deletedProjects.add(sourceProjectPath)
  deletedProjects.delete(targetProjectPath)
  metadata.projects[targetProjectPath] = {
    ...(sourceMetadata ?? {}),
    ...(remoteProject ? { projectId: remoteProject.id } : {}),
    title: path.basename(targetProjectPath),
  }
  delete metadata.projects[sourceProjectPath]
  setCloudSyncMetadata(metadata)
}

async function syncProjectToCloud(projectPath: string) {
  const client = getClient()
  if (!client) {
    dirtyProjects.delete(projectPath)
    return
  }

  try {
    try {
      await local.stat(projectPath)
    } catch (error) {
      if (error === 'ENOENT') {
        dirtyProjects.delete(projectPath)
        return
      }
      throw error
    }

    const files = await buildProjectUploadFiles(projectPath)
    const remoteProject = await findRemoteProjectByPath(projectPath)
    const body = await getProjectUpsertBody(projectPath, remoteProject?.id)
    const uploadFiles = toKittyCadFiles(files, body)

    const result = remoteProject
      ? await kcCall(() =>
          projects.update_project({
            client,
            id: remoteProject.id,
            files: uploadFiles,
          })
        )
      : await kcCall(() =>
          projects.create_project({
            client,
            files: uploadFiles,
          })
        )

    if (err(result)) {
      recordCloudFailure(projectPath, result)
      return
    }

    dirtyProjects.delete(projectPath)
    projectsListCache = undefined
    recordCloudSuccess(projectPath, result)
  } catch (error) {
    recordCloudFailure(projectPath, error)
  }
}

async function getProjectUpsertBody(
  projectPath: string,
  projectId?: string
): Promise<{
  title: string
  description: string
  category_ids: string[]
}> {
  const title = path.basename(projectPath)
  if (!projectId) {
    return {
      title,
      description: '',
      category_ids: [],
    }
  }

  const client = getClient()
  if (!client) {
    return {
      title,
      description: '',
      category_ids: [],
    }
  }

  const result = await kcCall(() =>
    projects.get_project({ client, id: projectId })
  )
  if (err(result)) {
    return {
      title,
      description: '',
      category_ids: [],
    }
  }

  return {
    title,
    description: result.description,
    category_ids: result.category_ids,
  }
}

async function buildProjectUploadFiles(projectPath: string) {
  const files = await collectLocalProjectFiles(projectPath)
  return files.map((file) => ({
    name: file.relativePath,
    data: new Blob([file.data], { type: getMimeType(file.relativePath) }),
  }))
}

async function collectLocalProjectFiles(projectPath: string) {
  const files: Array<{
    relativePath: string
    data: Uint8Array<ArrayBuffer>
  }> = []

  async function visit(directoryPath: string) {
    let entries: string[]
    try {
      entries = await local.readdir(directoryPath)
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) {
        continue
      }

      const entryPath = path.join(directoryPath, entry)
      const stat = await local.stat(entryPath)
      if (stat.mode & fsZdsConstants.S_IFDIR) {
        await visit(entryPath)
        continue
      }

      files.push({
        relativePath: path
          .relative(projectPath, entryPath)
          .replaceAll(path.sep, '/'),
        data: Uint8Array.from(
          await local.readFile(entryPath)
        ) as Uint8Array<ArrayBuffer>,
      })
    }
  }

  await visit(projectPath)
  return files
}

function toKittyCadFiles(
  files: Array<{ name: string; data: Blob }>,
  body: {
    title: string
    description: string
    category_ids: string[]
  }
): Parameters<typeof projects.create_project>[0]['files'] {
  return [
    {
      name: 'body',
      data: new Blob([JSON.stringify(body)], { type: 'application/json' }),
    },
    ...files,
  ]
}

function getMimeType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase()
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

const readFile = async <T extends ReadFileOptions>(
  targetPath: string,
  options?: T
): Promise<ReadFileReturn<T>> => {
  try {
    await hydratePathFromCloud(targetPath)
  } catch (error) {
    const projectPath = await getProjectPathForPath(targetPath)
    if (projectPath) {
      recordCloudFailure(projectPath, error)
    }
  }

  return local.readFile(targetPath, options as never) as Promise<
    ReadFileReturn<T>
  >
}

const readdir: IZooDesignStudioFS['readdir'] = async (
  targetPath: string,
  options?: Parameters<IZooDesignStudioFS['readdir']>[1]
) => {
  if (await isProjectRootDirectory(targetPath)) {
    void hydrateProjectRootFromCloud()
    try {
      return await local.readdir(targetPath, options)
    } catch (error) {
      if (error === 'ENOENT') {
        await ensureLocalDirectory(targetPath)
        return []
      }
      throw error
    }
  }

  try {
    await hydratePathFromCloud(targetPath)
  } catch (error) {
    const projectPath = await getProjectPathForPath(targetPath)
    if (projectPath) {
      recordCloudFailure(projectPath, error)
    }
  }

  return local.readdir(targetPath, options)
}

const stat: IZooDesignStudioFS['stat'] = async (
  targetPath: string,
  options?: Parameters<IZooDesignStudioFS['stat']>[1]
) => {
  if (await isProjectRootDirectory(targetPath)) {
    void hydrateProjectRootFromCloud()
    return local.stat(targetPath, options)
  }

  const projectPath = await getProjectPathForPath(targetPath)
  if (projectPath && (await isProjectDirectory(targetPath))) {
    void hydrateProjectFromCloud(projectPath)
    return local.stat(targetPath, options)
  }

  try {
    await hydratePathFromCloud(targetPath)
  } catch (error) {
    if (projectPath) {
      recordCloudFailure(projectPath, error)
    }
  }

  return local.stat(targetPath, options)
}

const writeFile: IZooDesignStudioFS['writeFile'] = async (
  targetPath,
  data,
  options
) => {
  const result = await local.writeFile(targetPath, data, options)
  scheduleCloudWriteForPath(targetPath)
  return result
}

const mkdir: IZooDesignStudioFS['mkdir'] = async (targetPath, options) => {
  const result = await local.mkdir(targetPath, options)
  scheduleCloudWriteForPath(targetPath)
  return result
}

const rm: IZooDesignStudioFS['rm'] = async (targetPath, options) => {
  const result = await local.rm(targetPath, options)
  scheduleCloudDeleteForPath(targetPath)
  return result
}

const rename: IZooDesignStudioFS['rename'] = async (
  sourcePath,
  targetPath,
  options
) => {
  const result = await local.rename(sourcePath, targetPath, options)
  scheduleCloudRenameForPath(sourcePath, targetPath)
  return result
}

const cp: IZooDesignStudioFS['cp'] = async (
  sourcePath,
  targetPath,
  options
) => {
  const result = await local.cp(sourcePath, targetPath, options)
  scheduleCloudWriteForPath(targetPath)
  return result
}

const impl: IZooDesignStudioFS = {
  resolve: local.resolve,
  join: local.join,
  relative: local.relative,
  extname: local.extname,
  sep: local.sep,
  basename: local.basename,
  dirname: local.dirname,
  getPath: local.getPath,
  access: local.access,
  cp,
  readFile,
  rename,
  writeFile,
  readdir,
  stat,
  mkdir,
  rm,
  detach: async () => {
    for (const pending of pendingProjectWrites.values()) {
      clearTimeout(pending)
    }
    pendingProjectWrites.clear()
    dirtyProjects.clear()
    deletedProjects.clear()
    projectHydratedAt.clear()
    projectsListCache = undefined
    await local.detach()
  },
  attach: local.attach,
}

export default {
  impl,
}
