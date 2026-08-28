import type { RemoteCloudProject } from '@src/contracts/cloudSync'
import {
  type CloudArchiveFile,
  mimeType,
  projectEntrypoint,
  projectTitle,
  toArrayBuffer,
} from '@src/features/cloudSync/cloudArchive'

export interface CloudApi {
  listProjects(): Promise<RemoteCloudProject[]>
  getProject(id: string): Promise<RemoteCloudProject>
  downloadProject(id: string): Promise<ArrayBuffer>
  createProject(
    projectPath: string,
    files: CloudArchiveFile[]
  ): Promise<RemoteCloudProject>
  updateProject(
    project: RemoteCloudProject,
    projectPath: string,
    files: CloudArchiveFile[],
    expectedRevision?: string
  ): Promise<RemoteCloudProject>
  deleteProject(id: string): Promise<void>
}

export class CloudApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** The narrow archive API cloudSync needs, independently replaceable in tests. */
export function createCloudApi(options: {
  token: () => string | null
  baseUrl?: string
  fetch?: typeof fetch
}): CloudApi {
  const request = options.fetch ?? fetch
  const baseUrl = (
    options.baseUrl ??
    (import.meta.env?.VITE_KC_API_BASE_URL as string | undefined) ??
    ''
  ).replace(/\/+$/, '')

  const cloudFetch = async (path: string, init: RequestInit = {}) => {
    if (!baseUrl) throw new Error('Cloud sync is missing an API base URL.')
    const headers = new Headers(init.headers)
    const token = options.token()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await request(`${baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    })
    if (response.ok) return response

    let message = response.statusText || `HTTP ${response.status}`
    try {
      const body = (await response.clone().json()) as { message?: unknown }
      if (typeof body.message === 'string') message = body.message
    } catch {
      const body = await response.text().catch(() => '')
      if (body) message = body
    }
    throw new CloudApiError(response.status, message)
  }

  const json = async <T>(path: string, init?: RequestInit) =>
    (await cloudFetch(path, init)).json() as Promise<T>

  const bodyFor = (
    projectPath: string,
    files: CloudArchiveFile[],
    project?: RemoteCloudProject,
    expectedRevision?: string
  ) => {
    const title = projectTitle(projectPath, files)
    const uploadFiles = files.some(
      (file) => file.relativePath === 'project.toml'
    )
      ? files
      : [
          ...files,
          {
            relativePath: 'project.toml',
            data: new TextEncoder().encode(
              `title = ${JSON.stringify(title)}\n`
            ),
          },
        ]
    const body = {
      title,
      description: project?.description ?? '',
      category_ids: project?.category_ids ?? [],
      entrypoint_path: projectEntrypoint(uploadFiles, project?.entrypoint_path),
      project_toml_path: 'project.toml',
      ...(expectedRevision ? { expected_revision: expectedRevision } : {}),
    }
    const form = new FormData()
    form.append(
      'body',
      new Blob([JSON.stringify(body)], { type: 'application/json' }),
      'body'
    )
    for (const file of uploadFiles) {
      form.append(
        file.relativePath,
        new Blob([toArrayBuffer(file.data)], {
          type: mimeType(file.relativePath),
        }),
        file.relativePath
      )
    }
    return form
  }

  return {
    listProjects: () => json('/user/projects'),
    getProject: (id) => json(`/user/projects/${encodeURIComponent(id)}`),
    downloadProject: async (id) =>
      (
        await cloudFetch(
          `/user/projects/${encodeURIComponent(id)}/download?format=zip`
        )
      ).arrayBuffer(),
    createProject: (projectPath, files) =>
      json('/user/projects', {
        method: 'POST',
        body: bodyFor(projectPath, files),
      }),
    updateProject: (project, projectPath, files, expectedRevision) => {
      const query = expectedRevision
        ? `?expected_revision=${encodeURIComponent(expectedRevision)}`
        : ''
      return json(`/user/projects/${encodeURIComponent(project.id)}${query}`, {
        method: 'PUT',
        body: bodyFor(projectPath, files, project, expectedRevision),
      })
    },
    deleteProject: async (id) => {
      await cloudFetch(`/user/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    },
  }
}
