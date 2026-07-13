import env from '@src/env'
import {
  getMimeType,
  prepareProjectFilesForCloudUpload,
  toArrayBuffer,
} from '@src/lib/cloudSync/projectArchive'
import type {
  CloudSyncConfig,
  ProjectArchiveFile,
  RemoteProject,
  RemoteProjectSummary,
  Revision,
} from '@src/lib/cloudSync/types'
import { isArray } from '@src/lib/utils'

export class CloudApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function getBaseUrl(config: CloudSyncConfig) {
  return (config.baseUrl || env().VITE_ZOO_API_BASE_URL || '').replace(
    /\/+$/g,
    ''
  )
}

async function cloudFetch(
  config: CloudSyncConfig,
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
  config: CloudSyncConfig,
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

export async function listRemoteProjects(config: CloudSyncConfig) {
  return cloudJson<RemoteProjectSummary[]>(config, '/user/projects')
}

export async function getRemoteProject(
  config: CloudSyncConfig,
  projectId: string
) {
  return cloudJson<RemoteProject>(config, `/user/projects/${projectId}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isDisplayableImageUrl(value: string) {
  return /^(https?:|blob:|data:image\/)/i.test(value)
}

export function normalizeRemoteProjectThumbnailUrl(value: string) {
  if (!/^https?:/i.test(value)) {
    return value
  }

  const withoutExtension = (pathname: string) =>
    pathname.replace(
      /(\/user\/projects\/[^/]+\/thumbnail)\.(?:png|jpe?g|webp|gif)$/i,
      '$1'
    )

  try {
    const url = new URL(value)
    url.pathname = withoutExtension(url.pathname)
    return url.toString()
  } catch {
    return value.replace(
      /(\/user\/projects\/[^/?#]+\/thumbnail)\.(?:png|jpe?g|webp|gif)(?=[?#]|$)/i,
      '$1'
    )
  }
}

export function remoteProjectThumbnailTargetPathFromUrl(value: string) {
  const normalizedValue = normalizeRemoteProjectThumbnailUrl(value)
  try {
    const url = new URL(normalizedValue)
    return /^\/user\/projects\/[^/]+\/thumbnail$/i.test(url.pathname)
      ? `${url.pathname}${url.search}`
      : undefined
  } catch {
    const match = normalizedValue.match(
      /(\/user\/projects\/[^/?#]+\/thumbnail)(\?[^#]*)?(?:#.*)?$/i
    )
    return match ? `${match[1]}${match[2] ?? ''}` : undefined
  }
}

function imageMimeTypeFromRecord(record: Record<string, unknown>) {
  const mimeType =
    stringValue(record.mime_type) ||
    stringValue(record.mimeType) ||
    stringValue(record.content_type) ||
    stringValue(record.contentType)

  return mimeType?.startsWith('image/') ? mimeType : 'image/png'
}

function maybeDataUrlFromBase64(value: string, mimeType = 'image/png') {
  const base64 = value.replace(/\s/g, '')
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return undefined
  }

  return `data:${mimeType};base64,${base64}`
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}

export function thumbnailUrlFromRemoteProjectPayload(
  payload: unknown
): string | undefined {
  const directValue = stringValue(payload)
  if (directValue) {
    if (isDisplayableImageUrl(directValue)) {
      return normalizeRemoteProjectThumbnailUrl(directValue)
    }

    return maybeDataUrlFromBase64(directValue)
  }

  if (!isRecord(payload)) {
    return undefined
  }

  const directUrlFields = [
    'url',
    'uri',
    'href',
    'src',
    'thumbnail_url',
    'thumbnailUrl',
    'image_url',
    'imageUrl',
    'preview_url',
    'previewUrl',
    'data_url',
    'dataUrl',
  ]
  for (const field of directUrlFields) {
    const fieldValue = stringValue(payload[field])
    if (fieldValue && isDisplayableImageUrl(fieldValue)) {
      return normalizeRemoteProjectThumbnailUrl(fieldValue)
    }
  }

  const nestedThumbnail: string | undefined =
    thumbnailUrlFromRemoteProjectPayload(payload.thumbnail) ||
    thumbnailUrlFromRemoteProjectPayload(payload.image) ||
    thumbnailUrlFromRemoteProjectPayload(payload.preview)
  if (nestedThumbnail) {
    return nestedThumbnail
  }

  const mimeType = imageMimeTypeFromRecord(payload)
  const base64Fields = ['base64', 'data', 'content', 'contents']
  for (const field of base64Fields) {
    const fieldValue = stringValue(payload[field])
    if (!fieldValue) {
      continue
    }

    const dataUrl = maybeDataUrlFromBase64(fieldValue, mimeType)
    if (dataUrl) {
      return dataUrl
    }
  }

  return undefined
}

export async function getRemoteProjectThumbnailUrl(
  config: CloudSyncConfig,
  project: RemoteProjectSummary
) {
  const urlFromProjectList = thumbnailUrlFromRemoteProjectPayload(project)
  const thumbnailTargetPath = urlFromProjectList
    ? remoteProjectThumbnailTargetPathFromUrl(urlFromProjectList)
    : undefined
  if (urlFromProjectList && !thumbnailTargetPath) {
    return urlFromProjectList
  }

  let response: Response
  try {
    response = await cloudFetch(
      config,
      thumbnailTargetPath ?? `/user/projects/${project.id}/thumbnail`,
      {
        headers: {
          Accept: 'application/json,image/*',
        },
      }
    )
  } catch (error) {
    if (error instanceof CloudApiError && error.status === 404) {
      return undefined
    }

    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw error
  }
  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ??
    ''

  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    try {
      return thumbnailUrlFromRemoteProjectPayload(await response.json())
    } catch {
      return undefined
    }
  }

  try {
    const thumbnailFromJson = thumbnailUrlFromRemoteProjectPayload(
      await response.clone().json()
    )
    if (thumbnailFromJson) {
      return thumbnailFromJson
    }
  } catch {
    // The thumbnail endpoint may return an image payload instead of JSON.
  }

  try {
    const thumbnailFromText = thumbnailUrlFromRemoteProjectPayload(
      await response.clone().text()
    )
    if (thumbnailFromText) {
      return thumbnailFromText
    }
  } catch {
    // Fall through to binary handling below.
  }

  const imageBytes = await response.arrayBuffer()
  if (!imageBytes.byteLength) {
    return undefined
  }

  const mimeType = contentType.startsWith('image/') ? contentType : 'image/png'
  return `data:${mimeType};base64,${arrayBufferToBase64(imageBytes)}`
}

export async function deleteRemoteProject(
  config: CloudSyncConfig,
  projectId: string
) {
  await cloudFetch(config, `/user/projects/${projectId}`, {
    method: 'DELETE',
  })
}

export async function downloadRemoteProjectArchive(
  config: CloudSyncConfig,
  projectId: string
) {
  const response = await cloudFetch(
    config,
    `/user/projects/${projectId}/download?format=zip`
  )
  return response.arrayBuffer()
}

export async function createRemoteProject(
  config: CloudSyncConfig,
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
  config: CloudSyncConfig
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
