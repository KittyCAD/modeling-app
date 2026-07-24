import 'fake-indexeddb/auto'
import {
  cloudSyncRemoteProjects,
  configureCloudSyncEngine,
  deleteRemoteCloudProject,
  getCloudSyncProjectMetadata,
  renameRemoteCloudProject,
} from '@src/lib/cloudSync'
import { putProjectMetadata } from '@src/lib/cloudSync/syncDb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const syncDatabaseName = 'zds-opfs-cloud-sync'
const projectPath = '/documents/Projects/bracket'
const remoteProjectId = 'remote-project-123'
const baseUrl = 'https://example.test'
const remoteProjectUrl = `${baseUrl}/user/projects/${remoteProjectId}`
const remoteProjectDownloadUrl = `${remoteProjectUrl}/download?format=zip`

const fetchMock = vi.fn<typeof fetch>()

function getFetchUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

function getFetchMethod(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) {
  if (init?.method) {
    return init.method
  }
  if (typeof input === 'object' && 'method' in input) {
    return input.method
  }
  return 'GET'
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function deleteSyncDatabase() {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`IndexedDB database ${syncDatabaseName} is blocked.`))
    }, 1000)
    const request = indexedDB.deleteDatabase(syncDatabaseName)
    request.onerror = () => {
      clearTimeout(timeout)
      reject(
        request.error ??
          new Error(`Failed to delete IndexedDB database ${syncDatabaseName}.`)
      )
    }
    request.onblocked = () => undefined
    request.onsuccess = () => {
      clearTimeout(timeout)
      resolve()
    }
  })
}

describe('renameRemoteCloudProject', () => {
  beforeEach(async () => {
    await deleteSyncDatabase()
    fetchMock.mockReset()
    cloudSyncRemoteProjects.value = [{ id: remoteProjectId, title: 'Bracket' }]
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: '/documents/Projects',
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteSyncDatabase()
  })

  it('re-uploads the remote project archive with the new title', async () => {
    let uploadedTitle: string | undefined
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)

      if (url === remoteProjectUrl && method === 'GET') {
        return jsonResponse({
          id: remoteProjectId,
          title: 'Bracket',
          revision: 'rev-1',
        })
      }
      if (url === remoteProjectDownloadUrl && method === 'GET') {
        return jsonResponse({
          files: [
            { relativePath: 'main.kcl', contents: 'foo = 1' },
            { relativePath: 'project.toml', contents: 'title = "Bracket"\n' },
          ],
        })
      }
      if (url.startsWith(remoteProjectUrl) && method === 'PUT') {
        const body = init?.body as FormData
        uploadedTitle = JSON.parse(
          await (body.get('body') as Blob).text()
        ).title
        return jsonResponse({
          id: remoteProjectId,
          title: 'Housing',
          revision: 'rev-2',
        })
      }

      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })

    await renameRemoteCloudProject(remoteProjectId, 'Housing')

    expect(uploadedTitle).toBe('Housing')
    expect(fetchMock).toHaveBeenCalledWith(
      remoteProjectDownloadUrl,
      expect.objectContaining({ credentials: 'include' })
    )
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          getFetchUrl(input) ===
            `${remoteProjectUrl}?expected_revision=rev-1` &&
          getFetchMethod(input, init) === 'PUT'
      )
    ).toBe(true)
    expect(cloudSyncRemoteProjects.value).toEqual([
      { id: remoteProjectId, title: 'Housing' },
    ])
  })

  it('does nothing when the requested name is blank', async () => {
    await renameRemoteCloudProject(remoteProjectId, '   ')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('deleteRemoteCloudProject', () => {
  beforeEach(async () => {
    await deleteSyncDatabase()
    fetchMock.mockReset()
    cloudSyncRemoteProjects.value = [
      { id: remoteProjectId },
      { id: 'other-project' },
    ]
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: '/documents/Projects',
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteSyncDatabase()
  })

  it('deletes the remote project and clears any lingering local metadata', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)
      if (url === remoteProjectUrl && method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId,
    })

    await deleteRemoteCloudProject(remoteProjectId)

    expect(fetchMock).toHaveBeenCalledWith(
      remoteProjectUrl,
      expect.objectContaining({ credentials: 'include', method: 'DELETE' })
    )
    expect(await getCloudSyncProjectMetadata(projectPath)).toBeUndefined()
    expect(cloudSyncRemoteProjects.value).toEqual([{ id: 'other-project' }])
  })

  it('tolerates a remote project that is already gone (404)', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ message: 'Not found.' }, 404)
    )

    await expect(
      deleteRemoteCloudProject(remoteProjectId)
    ).resolves.toBeUndefined()
    expect(cloudSyncRemoteProjects.value).toEqual([{ id: 'other-project' }])
  })
})
