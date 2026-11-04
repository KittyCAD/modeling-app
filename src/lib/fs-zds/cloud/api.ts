import { collectApiPages } from '@src/lib/apiPagination'
import { ApiError, type Client, projects } from '@kittycad/lib'
import { createKCClient } from '@src/lib/kcClient'
import {
  CloudStorageError,
  withCloudFailureContext,
  withCloudFailureContextSync,
} from '@src/lib/fs-zds/cloud/failureContext'
import {
  getMimeType,
  prepareProjectFilesForCloudUpload,
  toArrayBuffer,
} from '@src/lib/fs-zds/cloud/archive'
import type {
  CloudApiConfig,
  ProjectArchiveFile,
  ProjectUploadPublicationMetadata,
  RemoteProject,
  RemoteProjectSummary,
  Revision,
} from '@src/lib/fs-zds/cloud/types'
import { isArray } from '@src/lib/utils'

/** HTTP failure returned by the cloud API request boundary. */
export class CloudApiError extends CloudStorageError {
  status: number
  retryAfterMs?: number

  constructor(
    status: number,
    message: string,
    options: { retryAfterMs?: number } = {}
  ) {
    super({ stage: 'network', point: 'cloud-api-request' }, message)
    this.name = 'CloudApiError'
    this.status = status
    this.retryAfterMs = options.retryAfterMs
  }
}

async function cloudCall<T>(
  config: CloudApiConfig,
  call: (client: Client) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return withCloudFailureContext(
    { stage: 'network', point: 'cloud-api-request' },
    async () => {
      try {
        return await call(
          createKCClient(config.token, config.baseUrl, { signal })
        )
      } catch (error) {
        if (error instanceof ApiError) {
          return Promise.reject(
            new CloudApiError(error.status, error.message, {
              retryAfterMs: error.retryAfterMs,
            })
          )
        }
        return Promise.reject(error)
      }
    }
  )
}

function isRemoteProjectSummary(value: unknown): value is RemoteProjectSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0
  )
}

export async function listRemoteProjects(
  config: CloudApiConfig,
  beforeRequest: () => Promise<void> = async () => undefined,
  signal?: AbortSignal
): Promise<RemoteProjectSummary[]> {
  await beforeRequest()
  const response: unknown = await cloudCall(
    config,
    (client) => collectApiPages(projects.list_projects_pager({ client })),
    signal
  )
  if (!isArray(response) || !response.every(isRemoteProjectSummary)) {
    return Promise.reject(
      new CloudStorageError(
        { stage: 'network', point: 'parse-cloud-api-response' },
        'Invalid remote project list.'
      )
    )
  }
  return [...response]
}

export interface RemoteProjectLibrary {
  id: string
  name: string
  source?: string
}

export async function listRemoteProjectLibraries(
  config: CloudApiConfig,
  signal?: AbortSignal
): Promise<RemoteProjectLibrary[]> {
  const libraries = await cloudCall(
    config,
    (client) =>
      collectApiPages(projects.list_project_libraries_pager({ client })),
    signal
  )
  if (
    !libraries.every(
      (library) =>
        library !== null &&
        typeof library === 'object' &&
        typeof library.id === 'string' &&
        library.id.trim().length > 0 &&
        typeof library.name === 'string' &&
        (library.source === undefined || typeof library.source === 'string')
    )
  )
    return Promise.reject(new Error('Invalid remote project library list.'))
  return [
    ...new Map(libraries.map((library) => [library.id, library])).values(),
  ]
}

export async function getRemoteProject(
  config: CloudApiConfig,
  projectId: string,
  signal?: AbortSignal
): Promise<RemoteProject> {
  return cloudCall(
    config,
    (client) => projects.get_project({ client, id: projectId }),
    signal
  )
}

export async function getRemoteProjectThumbnailUrl(
  config: CloudApiConfig,
  project: RemoteProjectSummary
) {
  try {
    const response = await cloudCall(config, (client) =>
      projects.get_project_thumbnail({ client, id: project.id })
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.length) return undefined
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim()
    if (!mimeType?.startsWith('image/')) {
      return Promise.reject(
        new CloudStorageError(
          { stage: 'network', point: 'parse-cloud-api-response' },
          'Invalid cloud project thumbnail content type.'
        )
      )
    }
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    return `data:${mimeType};base64,${btoa(binary)}`
  } catch (error) {
    if (error instanceof CloudApiError && error.status === 404) return undefined
    return Promise.reject(error)
  }
}

export async function deleteRemoteProject(
  config: CloudApiConfig,
  projectId: string
) {
  await cloudCall(config, (client) =>
    projects.delete_project({ client, id: projectId })
  )
}

export async function downloadRemoteProjectArchive(
  config: CloudApiConfig,
  projectId: string,
  signal?: AbortSignal
) {
  const response = await cloudCall(
    config,
    (client) =>
      projects.download_project({ client, id: projectId, format: 'zip' }),
    signal
  )
  return response.arrayBuffer()
}

export async function createRemoteProject(
  config: CloudApiConfig,
  projectPath: string,
  files: ProjectArchiveFile[],
  publicationMetadata: ProjectUploadPublicationMetadata = {
    description: '',
    category_ids: [],
  }
) {
  const uploadFiles = buildProjectUploadFiles(projectPath, files, {
    publicationMetadata,
  })
  return cloudCall(config, (client) =>
    projects.create_project({ client, files: uploadFiles })
  )
}

export async function updateRemoteProject({
  config,
  projectPath,
  project,
  files,
  expectedRevision,
  entrypointPath,
  deletedPaths,
  publicationMetadata: requestedPublicationMetadata,
}: {
  config: CloudApiConfig
  projectPath: string
  project: RemoteProject
  files: ProjectArchiveFile[]
  expectedRevision?: Revision
  entrypointPath?: string
  deletedPaths?: string[]
  publicationMetadata?: ProjectUploadPublicationMetadata
}): Promise<RemoteProject> {
  const publicationMetadata =
    requestedPublicationMetadata ?? getProjectUploadPublicationMetadata(project)

  const uploadFiles = buildProjectUploadFiles(projectPath, files, {
    expectedRevision,
    entrypointPath,
    publicationMetadata,
    deletedPaths,
  })
  return cloudCall(config, (client) =>
    projects.update_project({ client, id: project.id, files: uploadFiles })
  )
}

type BuildProjectFormDataOptions = {
  expectedRevision?: Revision
  entrypointPath?: string
  publicationMetadata?: ProjectUploadPublicationMetadata
  deletedPaths?: string[]
}

function buildProjectUploadFiles(
  projectPath: string,
  files: ProjectArchiveFile[],
  options?: BuildProjectFormDataOptions
): Parameters<typeof projects.create_project>[0]['files'] {
  return withCloudFailureContextSync(
    { stage: 'archive', point: 'prepare-project-upload' },
    () => {
      const upload = prepareProjectFilesForCloudUpload(
        projectPath,
        files,
        options
      )
      return [
        {
          name: 'body',
          data: new Blob([JSON.stringify(upload.body)], {
            type: 'application/json',
          }),
        },
        ...upload.files.map((file) => ({
          name: file.relativePath,
          data: new Blob([toArrayBuffer(file.data)], {
            type: getMimeType(file.relativePath),
          }),
        })),
      ]
    }
  )
}

function getProjectUploadPublicationMetadata(
  project: RemoteProject
): ProjectUploadPublicationMetadata {
  if (typeof project.description !== 'string') {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error(
      `Cloud sync cannot preserve publication metadata for project ${project.id}: missing description.`
    )
  }
  if (!isArray(project.category_ids)) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error(
      `Cloud sync cannot preserve publication metadata for project ${project.id}: missing category_ids.`
    )
  }

  const categoryIds: string[] = []
  for (const categoryId of project.category_ids) {
    if (typeof categoryId !== 'string') {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw new Error(
        `Cloud sync cannot preserve publication metadata for project ${project.id}: invalid category_ids.`
      )
    }
    categoryIds.push(categoryId)
  }

  return {
    description: project.description,
    category_ids: categoryIds,
  }
}
