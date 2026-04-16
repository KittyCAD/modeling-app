import { type KclProjectPublicationStatus, projects } from '@kittycad/lib'
import { serializeProjectConfiguration } from '@src/lang/wasm'
import toast from 'react-hot-toast'

import env from '@src/env'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import {
  readProjectSettingsFile,
  writeProjectSettingsFile,
} from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import type { FileEntry, Project } from '@src/lib/project'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export type PublishCurrentProjectArgs = {
  token: string
  project: Project | undefined
  currentFilePath: string
  currentFileContents: string
  wasmInstance: ModuleType
}

export type CurrentProjectPublicationDetails = {
  projectId: string
  publicationStatus: KclProjectPublicationStatus
  publishedAt?: string
  updatedAt: string
}

type CurrentProjectUploadArgs = Omit<PublishCurrentProjectArgs, 'project'> & {
  project: Project
}

type ProjectSettingsCloud = Record<
  string,
  {
    project_id?: string
  }
>

type UploadFile = {
  name: string
  data: Blob
}

type ProjectUpsertBody = {
  title: string
  description: string
}

export async function publishCurrentProject(
  args: PublishCurrentProjectArgs
): Promise<boolean> {
  if (!args.token) {
    toast.error('You need to be signed in to publish a project.', {
      duration: 5000,
    })
    return false
  }

  if (!args.project) {
    toast.error('You need an open project to publish.', {
      duration: 5000,
    })
    return false
  }

  const uploadedProject = await ensureCurrentProjectUploaded({
    ...args,
    project: args.project,
  })
  if (err(uploadedProject)) {
    toast.error(uploadedProject.message, {
      duration: 5000,
    })
    return false
  }

  const publishedProject = await kcCall(() =>
    projects.publish_project({
      client: uploadedProject.client,
      id: uploadedProject.projectId,
    })
  )
  if (err(publishedProject)) {
    toast.error(publishedProject.message, {
      duration: 5000,
    })
    return false
  }

  toast.success(
    publishedProject.publication_status === 'published'
      ? 'Project published.'
      : 'Project submitted for review.',
    {
      duration: 5000,
    }
  )

  return true
}

export async function getCurrentProjectPublicationDetails({
  token,
  project,
  wasmInstance,
}: {
  token: string
  project: Project | undefined
  wasmInstance: ModuleType
}): Promise<CurrentProjectPublicationDetails | null | Error> {
  if (!token || !project) {
    return null
  }

  const environmentName = getCurrentEnvironmentName()
  if (err(environmentName)) {
    return environmentName
  }

  const projectId = await getCloudProjectIdForEnvironment(
    project.path,
    wasmInstance,
    environmentName
  )
  if (err(projectId)) {
    return projectId
  }

  if (!projectId) {
    return null
  }

  const client = createKCClient(token)
  const remoteProject = await getRemoteProject({
    client,
    projectId,
  })
  if (err(remoteProject)) {
    return remoteProject
  }

  return {
    projectId,
    publicationStatus: remoteProject.publication_status,
    publishedAt: remoteProject.publication.last_published_at,
    updatedAt: remoteProject.updated_at,
  }
}

async function ensureCurrentProjectUploaded(
  args: CurrentProjectUploadArgs
): Promise<
  | {
      client: ReturnType<typeof createKCClient>
      projectId: string
    }
  | Error
> {
  const project = args.project
  const environmentName = getCurrentEnvironmentName()
  if (err(environmentName)) {
    return environmentName
  }

  const uploadFiles = await buildProjectUploadFiles({
    project,
    currentFilePath: args.currentFilePath,
    currentFileContents: args.currentFileContents,
    wasmInstance: args.wasmInstance,
  })
  if (err(uploadFiles)) {
    return uploadFiles
  }

  const client = createKCClient(args.token)
  const existingProjectId = await getCloudProjectIdForEnvironment(
    project.path,
    args.wasmInstance,
    environmentName
  )
  if (err(existingProjectId)) {
    return existingProjectId
  }

  if (existingProjectId) {
    const projectBody = await getProjectUpsertBody({
      client,
      project,
      projectId: existingProjectId,
    })
    if (err(projectBody)) {
      return projectBody
    }

    const projectResp = await kcCall(() =>
      projects.update_project({
        client,
        id: existingProjectId,
        files: toKittyCadFiles(uploadFiles, projectBody),
      })
    )
    if (err(projectResp)) {
      return projectResp
    }

    return {
      client,
      projectId: existingProjectId,
    }
  }

  const projectBody = getDefaultProjectUpsertBody(project)
  const projectResp = await kcCall(() =>
    projects.create_project({
      client,
      files: toKittyCadFiles(uploadFiles, projectBody),
    })
  )
  if (err(projectResp)) {
    return projectResp
  }

  const projectId = projectResp.id
  const persisted = await persistCloudProjectIdForEnvironment(
    project.path,
    args.wasmInstance,
    environmentName,
    projectId
  )
  if (err(persisted)) {
    return persisted
  }

  return {
    client,
    projectId,
  }
}

async function getProjectUpsertBody({
  client,
  project,
  projectId,
}: {
  client: ReturnType<typeof createKCClient>
  project: Project
  projectId: string
}): Promise<ProjectUpsertBody | Error> {
  const remoteProject = await getRemoteProject({
    client,
    projectId,
  })
  if (err(remoteProject)) {
    return remoteProject
  }

  return {
    title: remoteProject.title || getDefaultProjectTitle(project),
    description: remoteProject.description || '',
  }
}

function getDefaultProjectUpsertBody(project: Project): ProjectUpsertBody {
  return {
    title: getDefaultProjectTitle(project),
    description: '',
  }
}

function getDefaultProjectTitle(project: Project) {
  return project.name || getPathLeaf(project.path) || 'project'
}

function getRemoteProject({
  client,
  projectId,
}: {
  client: ReturnType<typeof createKCClient>
  projectId: string
}) {
  return kcCall(() =>
    projects.get_project({
      client,
      id: projectId,
    })
  )
}

async function buildProjectUploadFiles({
  project,
  currentFilePath,
  currentFileContents,
  wasmInstance,
}: Omit<PublishCurrentProjectArgs, 'token' | 'project'> & {
  project: Project
}): Promise<UploadFile[] | Error> {
  if (!project.children) {
    return new Error('This project does not have any files to share.')
  }

  const files: UploadFile[] = await Promise.all(
    flattenProjectFiles(project.children).map(async (fileEntry) => {
      const relativePath = toProjectRelativePath(project.path, fileEntry.path)
      const data =
        fileEntry.path === currentFilePath
          ? new Blob([currentFileContents], {
              type: getMimeType(fileEntry.name),
            })
          : new Blob([cloneFileBytes(await fsZds.readFile(fileEntry.path))], {
              type: getMimeType(fileEntry.name),
            })

      return {
        name: relativePath,
        data,
      }
    })
  )

  const hasProjectSettings = files.some(
    (file) => file.name === PROJECT_SETTINGS_FILE_NAME
  )
  if (hasProjectSettings) {
    return files
  }

  const projectToml = await getProjectTomlContents(project.path, wasmInstance)
  if (err(projectToml)) {
    return projectToml
  }

  return [
    ...files,
    {
      name: PROJECT_SETTINGS_FILE_NAME,
      data: new Blob([projectToml], { type: 'text/plain' }),
    },
  ]
}

async function getProjectTomlContents(
  projectPath: string,
  wasmInstance: ModuleType
): Promise<string | Error> {
  const projectTomlPath = fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)

  try {
    return await fsZds.readFile(projectTomlPath, { encoding: 'utf-8' })
  } catch {
    const projectSettings = await readProjectSettingsFile(
      projectPath,
      wasmInstance
    )
    const serialized = serializeProjectConfiguration(
      projectSettings,
      wasmInstance
    )
    if (err(serialized)) {
      return serialized
    }

    return serialized
  }
}

async function getCloudProjectIdForEnvironment(
  projectPath: string,
  wasmInstance: ModuleType,
  environmentName: string
): Promise<string | undefined | Error> {
  try {
    const projectSettings = await readProjectSettingsFile(
      projectPath,
      wasmInstance
    )
    const cloud = (projectSettings.cloud ?? {}) as ProjectSettingsCloud
    return cloud[environmentName]?.project_id
  } catch (error) {
    return new Error(
      `Failed to read local project settings: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function persistCloudProjectIdForEnvironment(
  projectPath: string,
  wasmInstance: ModuleType,
  environmentName: string,
  projectId: string
) {
  try {
    const projectSettings = await readProjectSettingsFile(
      projectPath,
      wasmInstance
    )
    const cloud = { ...(projectSettings.cloud ?? {}) } as ProjectSettingsCloud
    cloud[environmentName] = {
      ...(cloud[environmentName] ?? {}),
      project_id: projectId,
    }

    const serialized = serializeProjectConfiguration(
      {
        ...projectSettings,
        cloud,
      },
      wasmInstance
    )
    if (err(serialized)) {
      return serialized
    }

    await writeProjectSettingsFile(projectPath, serialized)
    return true
  } catch (error) {
    return new Error(
      `Failed to save local cloud project binding: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function flattenProjectFiles(fileEntries: FileEntry[]): FileEntry[] {
  const files: FileEntry[] = []

  for (const entry of fileEntries) {
    if (entry.children) {
      files.push(...flattenProjectFiles(entry.children))
      continue
    }

    files.push(entry)
  }

  return files
}

function cloneFileBytes(fileBytes: Uint8Array) {
  return Uint8Array.from(fileBytes)
}

function toProjectRelativePath(projectPath: string, filePath: string) {
  return fsZds.relative(projectPath, filePath).replaceAll(fsZds.sep, '/')
}

function toKittyCadFiles(
  files: UploadFile[],
  body: ProjectUpsertBody
): Parameters<typeof projects.create_project>[0]['files'] {
  return [
    {
      name: 'body',
      data: new Blob([JSON.stringify(body)], { type: 'application/json' }),
    },
    ...files.map((file) => ({
      name: file.name,
      data: file.data,
    })),
  ]
}

function getCurrentEnvironmentName(): string | Error {
  const baseDomain = env().VITE_ZOO_BASE_DOMAIN
  if (baseDomain) {
    return baseDomain
  }

  const apiBaseUrl = env().VITE_ZOO_API_BASE_URL
  if (apiBaseUrl) {
    return new URL(apiBaseUrl).hostname.replace(/^api\./, '')
  }

  return new Error('Could not determine the active API environment.')
}

function getMimeType(fileName: string) {
  const extension = fsZds.extname(fileName).toLowerCase()
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

function getPathLeaf(path: string) {
  return path.split(fsZds.sep).filter(Boolean).at(-1)
}
