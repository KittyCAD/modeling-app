import 'fake-indexeddb/auto'
import {
  cloudSyncRemoteProjects,
  configureCloudSyncEngine,
  deleteRemoteCloudProject,
  getCloudSyncProjectMetadata,
  renameRemoteCloudProject,
} from '@src/lib/cloudSync'
import { putProjectMetadata } from '@src/lib/cloudSync/syncDb'
import {
  deleteCloudSyncTestDatabase,
  getFetchMethod,
  getFetchUrl,
  jsonResponse,
} from '@src/lib/cloudSync/testUtils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const projectPath = '/documents/Projects/bracket'
const remoteProjectId = 'remote-project-123'
const baseUrl = 'https://example.test'
const remoteProjectUrl = `${baseUrl}/user/projects/${remoteProjectId}`
const remoteProjectDownloadUrl = `${remoteProjectUrl}/download?format=zip`

const fetchMock = vi.fn<typeof fetch>()

describe('renameRemoteCloudProject', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
    fetchMock.mockReset()
    cloudSyncRemoteProjects.value = [{ id: remoteProjectId, title: 'Bracket' }]
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: ['/documents/Projects'],
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  })

  it('re-uploads the remote project archive with the new title', async () => {
    let uploadedTitle: string | undefined
    let uploadedEntrypointPath: string | undefined
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)

      if (url === remoteProjectUrl && method === 'GET') {
        return jsonResponse({
          id: remoteProjectId,
          title: 'Bracket',
          description: 'Existing description',
          category_ids: ['existing-category'],
          revision: 'rev-1',
          entrypoint_path: 'nested/part.kcl',
        })
      }
      if (url === remoteProjectDownloadUrl && method === 'GET') {
        return jsonResponse({
          files: [
            { relativePath: 'main.kcl', contents: 'foo = 1' },
            { relativePath: 'nested/part.kcl', contents: 'bar = 2' },
            { relativePath: 'project.toml', contents: 'title = "Bracket"\n' },
          ],
        })
      }
      if (url.startsWith(remoteProjectUrl) && method === 'PUT') {
        const body = init?.body as FormData
        const uploadedBody = JSON.parse(await (body.get('body') as Blob).text())
        uploadedTitle = uploadedBody.title
        uploadedEntrypointPath = uploadedBody.entrypoint_path
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
    expect(uploadedEntrypointPath).toBe('nested/part.kcl')
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
    await deleteCloudSyncTestDatabase()
    fetchMock.mockReset()
    cloudSyncRemoteProjects.value = [
      { id: remoteProjectId },
      { id: 'other-project' },
    ]
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: ['/documents/Projects'],
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
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

  it('fails when cloud sync is not enabled', async () => {
    configureCloudSyncEngine({ enabled: false })

    await expect(deleteRemoteCloudProject(remoteProjectId)).rejects.toThrow(
      'Cloud sync is not enabled.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
