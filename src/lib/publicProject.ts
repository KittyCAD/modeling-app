import JSZip from 'jszip'
import { projects } from '@kittycad/lib'

import env from '@src/env'
import {
  ASK_TO_OPEN_QUERY_PARAM,
  PROJECT_ENTRYPOINT,
  PROJECT_SETTINGS_FILE_NAME,
  PUBLIC_PROJECT_QUERY_PARAM,
} from '@src/lib/constants'
import { createKCClient, kcCall } from '@src/lib/kcClient'
import { webSafePathSplit } from '@src/lib/paths'
import { isArray } from '@src/lib/utils'
import type { RequestedProjectFile } from '@src/machines/systemIO/utils'

const DEFAULT_PUBLIC_PROJECT_NAME = 'shared-project'
const PUBLIC_PROJECT_DOWNLOAD_FORMAT = 'zip'

type DownloadedProjectArchive = {
  archive: ArrayBuffer
  contentDisposition: string | null
}

export function createOpenPublicProjectUrl(projectId: string) {
  const origin = env().VITE_ZOO_SITE_APP_URL
  const searchParams = new URLSearchParams({
    [PUBLIC_PROJECT_QUERY_PARAM]: projectId,
    [ASK_TO_OPEN_QUERY_PARAM]: String(true),
  })

  return new URL(`?${searchParams.toString()}`, origin)
}

export async function downloadPublicProject(projectId: string): Promise<{
  projectName: string
  files: RequestedProjectFile[]
  entrypointFilePath?: string
} | Error> {
  console.info('[public-project] starting download', { projectId })
  const archive = await downloadPublicProjectArchive(projectId)
  if (archive instanceof Error) {
    console.error('[public-project] download failed', {
      projectId,
      message: archive.message,
    })
    return archive
  }

  const parsedProject = await parseDownloadedProject(archive)
  if (parsedProject instanceof Error) {
    console.error('[public-project] failed to parse downloaded archive', {
      projectId,
      message: parsedProject.message,
    })
    return parsedProject
  }

  console.info('[public-project] parsed download', {
    projectId,
    projectName: parsedProject.projectName,
    fileCount: parsedProject.files.length,
    entrypointFilePath: parsedProject.entrypointFilePath || null,
  })

  return parsedProject
}

async function downloadPublicProjectArchive(
  projectId: string
): Promise<DownloadedProjectArchive | Error> {
  const client = createKCClient()
  const originalFetch = client.fetch || fetch

  client.fetch = async (input, init) => {
    const response = await originalFetch(
      ensurePublicProjectDownloadFormat(input),
      init
    )
    if (!response.ok || isJsonResponse(response)) {
      return response
    }

    const archive = await response.arrayBuffer()
    return createArchiveResponse(response, archive)
  }

  const result = await kcCall(() =>
    projects.download_public_project({
      client,
      id: projectId,
      format: PUBLIC_PROJECT_DOWNLOAD_FORMAT,
    })
  )

  if (result instanceof Error) {
    return result
  }

  return result as DownloadedProjectArchive
}

function ensurePublicProjectDownloadFormat(input: RequestInfo | URL) {
  const url = getRequestUrl(input)
  if (
    !url ||
    !/\/projects\/public\/[^/]+\/download$/.test(url.pathname) ||
    url.searchParams.has('format')
  ) {
    return input
  }

  url.searchParams.set('format', PUBLIC_PROJECT_DOWNLOAD_FORMAT)

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
  contentDisposition,
}: {
  archive: ArrayBuffer
  contentDisposition: string | null
}): Promise<{
  projectName: string
  files: RequestedProjectFile[]
  entrypointFilePath?: string
} | Error> {
  const zipResult = await parseZipArchive({
    archive,
    contentDisposition,
  })
  if (!(zipResult instanceof Error)) {
    return zipResult
  }

  const jsonResult = parseJsonArchive(archive)
  if (!(jsonResult instanceof Error)) {
    return jsonResult
  }

  return zipResult
}

async function parseZipArchive({
  archive,
  contentDisposition,
}: {
  archive: ArrayBuffer
  contentDisposition: string | null
}): Promise<{
  projectName: string
  files: RequestedProjectFile[]
  entrypointFilePath?: string
} | Error> {
  const zip = await JSZip.loadAsync(archive)
  const entries = Object.values(zip.files).filter((entry) => {
    return !entry.dir && !entry.name.startsWith('__MACOSX/')
  })

  if (entries.length === 0) {
    return new Error('The shared project download did not contain any files.')
  }

  const rootDirectory = getCommonArchiveRoot(entries.map((entry) => entry.name))
  const projectName = sanitizeProjectName(
    rootDirectory ||
      getFilenameStemFromContentDisposition(contentDisposition) ||
      DEFAULT_PUBLIC_PROJECT_NAME
  )

  const files = await Promise.all(
    entries.map(async (entry) => {
      const requestedFileName = stripArchiveRoot(entry.name, rootDirectory)
      return {
        requestedProjectName: projectName,
        requestedFileName,
        requestedData: Uint8Array.from(await entry.async('uint8array')),
      }
    })
  )

  const entrypointFilePath = getRequiredProjectEntrypoint(files)
  if (entrypointFilePath instanceof Error) {
    return entrypointFilePath
  }

  return {
    projectName,
    files,
    entrypointFilePath,
  }
}

function parseJsonArchive(archive: ArrayBuffer): {
  projectName: string
  files: RequestedProjectFile[]
  entrypointFilePath?: string
} | Error {
  let parsed:
    | {
        projectName?: string
        name?: string
        files?:
          | Array<{
              path?: string
              name?: string
              content?: string
              data?: string
              encoding?: 'base64' | 'utf-8'
            }>
          | Record<string, string>
      }
    | undefined

  try {
    const decoded = new TextDecoder().decode(new Uint8Array(archive))
    parsed = JSON.parse(decoded) as typeof parsed
  } catch {
    return new Error('The shared project download was not valid JSON.')
  }

  const projectName = sanitizeProjectName(
    parsed?.projectName || parsed?.name || DEFAULT_PUBLIC_PROJECT_NAME
  )
  const files = coerceJsonFiles(parsed?.files, projectName)

  if (files.length === 0) {
    return new Error('The shared project download did not contain any files.')
  }

  const entrypointFilePath = getRequiredProjectEntrypoint(files)
  if (entrypointFilePath instanceof Error) {
    return entrypointFilePath
  }

  return {
    projectName,
    files,
    entrypointFilePath,
  }
}

function getRequiredProjectEntrypoint(files: RequestedProjectFile[]) {
  const projectSettingsFile = files.find((file) => {
    return file.requestedFileName === PROJECT_SETTINGS_FILE_NAME
  })

  const configuredEntrypoint = projectSettingsFile
    ? getProjectTomlDefaultFile(projectSettingsFile.requestedData)
    : undefined

  if (
    configuredEntrypoint &&
    files.some((file) => file.requestedFileName === configuredEntrypoint)
  ) {
    return configuredEntrypoint
  }

  const mainFile = files.find((file) => {
    return file.requestedFileName === PROJECT_ENTRYPOINT
  })
  if (mainFile) {
    return mainFile.requestedFileName
  }

  const firstKclFile = files.find((file) => file.requestedFileName.endsWith('.kcl'))
  if (firstKclFile) {
    return firstKclFile.requestedFileName
  }

  return new Error(
    'The shared project did not include an openable KCL entry file.'
  )
}

function getProjectTomlDefaultFile(fileData: Uint8Array<ArrayBuffer>) {
  const toml = new TextDecoder().decode(fileData)
  const matchedDefaultFile = toml.match(
    /^\s*default_file\s*=\s*["']([^"']+)["']/m
  )?.[1]

  if (!matchedDefaultFile) {
    return undefined
  }

  return normalizeArchivePath(matchedDefaultFile)
}

function coerceJsonFiles(
  files:
    | Array<{
        path?: string
        name?: string
        content?: string
        data?: string
        encoding?: 'base64' | 'utf-8'
      }>
    | Record<string, string>
    | undefined,
  projectName: string
): RequestedProjectFile[] {
  if (!files) {
    return []
  }

  if (isArray(files)) {
    return files.flatMap((file) => {
      const requestedFileName = normalizeArchivePath(file.path || file.name || '')
      const contents = file.data ?? file.content ?? ''

      if (!requestedFileName) {
        return []
      }

      return [
        {
          requestedProjectName: projectName,
          requestedFileName,
          requestedData:
            file.encoding === 'base64'
              ? Uint8Array.from(atob(contents), (char) => char.charCodeAt(0))
              : new TextEncoder().encode(contents),
        },
      ]
    })
  }

  return Object.entries(files).flatMap(([path, contents]) => {
    const requestedFileName = normalizeArchivePath(path)
    if (!requestedFileName) {
      return []
    }

    return [
      {
        requestedProjectName: projectName,
        requestedFileName,
        requestedData: new TextEncoder().encode(contents),
      },
    ]
  })
}

function getCommonArchiveRoot(paths: string[]) {
  const normalizedPaths = paths
    .map((path) => normalizeArchivePath(path))
    .filter(Boolean)

  if (normalizedPaths.length === 0) {
    return undefined
  }

  const firstSegments = normalizedPaths.map((path) => {
    return webSafePathSplit(path)[0] || ''
  })
  const [firstSegment] = firstSegments

  if (
    firstSegment &&
    firstSegments.every((segment) => segment === firstSegment) &&
    normalizedPaths.every((path) => path.includes('/'))
  ) {
    return firstSegment
  }

  return undefined
}

function stripArchiveRoot(path: string, rootDirectory?: string) {
  const normalized = normalizeArchivePath(path)

  if (!rootDirectory) {
    return normalized
  }

  return normalized.replace(new RegExp(`^${escapeRegExp(rootDirectory)}/`), '')
}

function getFilenameStemFromContentDisposition(contentDisposition: string | null) {
  if (!contentDisposition) {
    return undefined
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return stripFileExtension(decodeURIComponent(utf8Match[1]))
  }

  const quotedMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i)
  if (quotedMatch?.[1]) {
    return stripFileExtension(quotedMatch[1])
  }

  return undefined
}

function normalizeArchivePath(path: string) {
  return path.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/')
}

function sanitizeProjectName(name: string) {
  const trimmed = name.trim().replace(/[\\/]/g, '-')
  return trimmed || DEFAULT_PUBLIC_PROJECT_NAME
}

function stripFileExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, '')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
