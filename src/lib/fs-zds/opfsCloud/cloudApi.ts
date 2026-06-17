import env from '@src/env'
import {
  getMimeType,
  prepareProjectFilesForCloudUpload,
  toArrayBuffer,
} from '@src/lib/fs-zds/opfsCloud/projectArchive'
import type {
  OPFSCloudConfig,
  ProjectArchiveFile,
  RemoteProject,
  RemoteProjectSummary,
  Revision,
} from '@src/lib/fs-zds/opfsCloud/types'

export class CloudApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function getBaseUrl(config: OPFSCloudConfig) {
  return (config.baseUrl || env().VITE_ZOO_API_BASE_URL || '').replace(
    /\/+$/g,
    ''
  )
}

async function cloudFetch(
  config: OPFSCloudConfig,
  targetPath: string,
  init: RequestInit = {}
): Promise<Response> {
  const baseUrl = getBaseUrl(config)
  if (!baseUrl) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
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

    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new CloudApiError(response.status, message)
  }

  return response
}

async function cloudJson<T>(
  config: OPFSCloudConfig,
  targetPath: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await cloudFetch(config, targetPath, init)
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

export async function listRemoteProjects(config: OPFSCloudConfig) {
  return cloudJson<RemoteProjectSummary[]>(config, '/user/projects')
}

export async function getRemoteProject(
  config: OPFSCloudConfig,
  projectId: string
) {
  return cloudJson<RemoteProject>(config, `/user/projects/${projectId}`)
}

export async function deleteRemoteProject(
  config: OPFSCloudConfig,
  projectId: string
) {
  await cloudFetch(config, `/user/projects/${projectId}`, {
    method: 'DELETE',
  })
}

export async function downloadRemoteProjectArchive(
  config: OPFSCloudConfig,
  projectId: string
) {
  const response = await cloudFetch(
    config,
    `/user/projects/${projectId}/download?format=zip`
  )
  return response.arrayBuffer()
}

export async function createRemoteProject(
  config: OPFSCloudConfig,
  projectPath: string,
  files: ProjectArchiveFile[]
) {
  return cloudJson<RemoteProject>(config, '/user/projects', {
    method: 'POST',
    body: buildProjectFormData(projectPath, files),
  })
}

export async function updateRemoteProject({
  config,
  projectPath,
  projectId,
  files,
  expectedRevision,
}: {
  config: OPFSCloudConfig
  projectPath: string
  projectId: string
  files: ProjectArchiveFile[]
  expectedRevision?: Revision
}) {
  return cloudJson<RemoteProject>(
    config,
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
