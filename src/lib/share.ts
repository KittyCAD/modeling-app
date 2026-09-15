import { type KclProjectPublicationStatus, projects } from '@kittycad/lib'
import env, { getEnvironmentNameFromEnv } from '@src/env'
import { collectLocalProjectFilesForCloudSync } from '@src/lib/cloudSync/localManifest'
import {
  getMimeType,
  prepareProjectFilesForCloudUpload,
} from '@src/lib/cloudSync/projectArchive'
import type {
  ProjectArchiveFile,
  ProjectUploadPublicationMetadata,
} from '@src/lib/cloudSync/types'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { readProjectSettingsFile } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import { toProjectRelativePath } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import { getProjectTomlContents } from '@src/lib/projectToml'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import toast from 'react-hot-toast'

export type PublishCurrentProjectArgs = {
  token: string
  project: Project | undefined
  currentFilePath: string
  currentFileContents: string
  wasmInstance: ModuleType
  submission: ProjectPublishSubmission
  remoteProjectId?: string
}

export type ProjectPublishSubmission = {
  title: string
  description: string
  categoryIds: string[]
}

export type CurrentProjectPublicationDetails = {
  projectId: string
  publicationStatus: KclProjectPublicationStatus
  title: string
  description: string
  categoryIds: string[]
  publishedAt?: string
  submittedAt?: string
  updatedAt: string
}

/** Remote identity of the project submitted to Aquarium. */
export type PublishedProject = {
  remoteProjectId: string
}

type CurrentProjectUploadArgs = Omit<PublishCurrentProjectArgs, 'project'> & {
  project: Project
}

export async function publishCurrentProject(
  args: PublishCurrentProjectArgs
): Promise<PublishedProject | false> {
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
    toast.error(getPublishErrorMessage(uploadedProject), {
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
    toast.error(getPublishErrorMessage(publishedProject), {
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

  return {
    remoteProjectId: uploadedProject.projectId,
  }
}

function getPublishErrorMessage(error: Error) {
  if (
    /(?:category|categories)/i.test(error.message) &&
    /not active|inactive|does not exist|invalid/i.test(error.message)
  ) {
    return 'One or more selected categories are no longer available. Choose an active category and try again.'
  }

  return error.message
}

export async function getCurrentProjectPublicationDetails({
  token,
  project,
  wasmInstance,
  remoteProjectId,
}: {
  token: string
  project: Project | undefined
  wasmInstance: ModuleType
  remoteProjectId?: string
}): Promise<CurrentProjectPublicationDetails | null | Error> {
  if (!token || !project) {
    return null
  }

  let projectId = remoteProjectId
  if (!projectId) {
    const environmentName = getCurrentEnvironmentName()
    if (err(environmentName)) {
      return environmentName
    }
    const localProjectId = await getCloudProjectIdForEnvironment(
      project.path,
      wasmInstance,
      environmentName
    )
    if (err(localProjectId)) {
      return localProjectId
    }
    projectId = localProjectId
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
    title: remoteProject.title || getDefaultProjectTitle(project),
    description: remoteProject.description || '',
    categoryIds: remoteProject.category_ids || [],
    publishedAt: remoteProject.publication.last_published_at,
    submittedAt: remoteProject.publication.submitted_at,
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
  const existingProjectId =
    args.remoteProjectId ??
    (await getCloudProjectIdForEnvironment(
      project.path,
      args.wasmInstance,
      environmentName
    ))
  if (err(existingProjectId)) {
    return existingProjectId
  }

  if (existingProjectId) {
    const projectResp = await kcCall(() =>
      projects.update_project({
        client,
        id: existingProjectId,
        files: toKittyCadFiles(
          project.path,
          uploadFiles,
          getProjectUploadPublicationMetadata(args.submission)
        ),
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

  const projectResp = await kcCall(() =>
    projects.create_project({
      client,
      files: toKittyCadFiles(
        project.path,
        uploadFiles,
        getProjectUploadPublicationMetadata(args.submission)
      ),
    })
  )
  if (err(projectResp)) {
    return projectResp
  }

  return {
    client,
    projectId: projectResp.id,
  }
}

function getProjectUploadPublicationMetadata(
  submission: ProjectPublishSubmission
): ProjectUploadPublicationMetadata {
  return {
    description: submission.description.trim(),
    category_ids: submission.categoryIds,
  }
}

function getDefaultProjectTitle(project: Project) {
  return (
    getProjectDisplayName(project) || getPathLeaf(project.path) || 'project'
  )
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
}: Omit<PublishCurrentProjectArgs, 'token' | 'project' | 'submission'> & {
  project: Project
}): Promise<ProjectArchiveFile[] | Error> {
  let files: ProjectArchiveFile[]
  try {
    files = await collectLocalProjectFilesForCloudSync({
      localFs: fsZds,
      projectRoot: project.path,
    })
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('Could not read the project files for publication.')
  }

  const currentRelativePath = toProjectRelativePath(
    project.path,
    currentFilePath
  )
  files = files.map((file) =>
    file.relativePath === currentRelativePath
      ? {
          ...file,
          data: new TextEncoder().encode(currentFileContents),
        }
      : file
  )

  const hasProjectSettings = files.some(
    (file) => file.relativePath === PROJECT_SETTINGS_FILE_NAME
  )
  if (hasProjectSettings) {
    return files
  }

  const projectToml = await getProjectTomlContents({
    projectPath: project.path,
    wasmInstance,
  })
  if (err(projectToml)) {
    return projectToml
  }

  return [
    ...files,
    {
      relativePath: PROJECT_SETTINGS_FILE_NAME,
      data: new TextEncoder().encode(projectToml),
    },
  ]
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
    const cloud = projectSettings.cloud ?? {}
    return cloud[environmentName]?.project_id
  } catch (error) {
    return new Error(
      `Failed to read local project settings: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function toKittyCadFiles(
  projectPath: string,
  files: ProjectArchiveFile[],
  publicationMetadata: ProjectUploadPublicationMetadata
): Parameters<typeof projects.create_project>[0]['files'] {
  const upload = prepareProjectFilesForCloudUpload(projectPath, files, {
    publicationMetadata,
  })
  return [
    {
      name: 'body',
      data: new Blob([JSON.stringify(upload.body)], {
        type: 'application/json',
      }),
    },
    ...upload.files.map((file) => ({
      name: file.relativePath,
      data: new Blob([Uint8Array.from(file.data)], {
        type: getMimeType(file.relativePath),
      }),
    })),
  ]
}

function getCurrentEnvironmentName(): string | Error {
  const environmentName = getEnvironmentNameFromEnv(env())
  if (environmentName !== undefined) {
    return environmentName
  }

  return new Error('Could not determine the active API environment.')
}

function getPathLeaf(path: string) {
  return path.split(fsZds.sep).filter(Boolean).at(-1)
}
