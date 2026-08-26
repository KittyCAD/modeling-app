import 'fake-indexeddb/auto'
import {
  cloudSyncRemoteProjects,
  cloudSyncStatus,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  disconnectCloudSyncProject,
  getCloudSyncProjectMetadata,
  notifyCloudSyncWriteLikeMutation,
  retryCloudSync,
  setCloudSyncOpenedProject,
} from '@src/lib/cloudSync'
import {
  appendOutboxEntry,
  getAllOutboxEntries,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import {
  createCloudSyncTestFs,
  deleteCloudSyncTestDatabase,
  getFetchMethod,
  getFetchUrl,
  jsonResponse,
} from '@src/lib/cloudSync/testUtils'
import {
  DUPLICATE_PROJECT_TEMPORARY_PREFIX,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const projectDirectory = '/documents/Projects'
const projectPath = '/documents/Projects/bracket'
const projectTomlPath = `${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`
const remoteProjectId = 'remote-project-123'
const remoteRevision = 'revision-123'
const remoteProjectUrl = `https://example.test/user/projects/${remoteProjectId}`

let deleteProjectFetch: typeof fetch = async () =>
  new Response(null, { status: 204 })

const fetchMock = vi.fn<typeof fetch>()

function installFetchMock() {
  deleteProjectFetch = async () => new Response(null, { status: 204 })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = getFetchUrl(input)
    const method = getFetchMethod(input, init)

    if (url === remoteProjectUrl && method === 'DELETE') {
      return deleteProjectFetch(input, init)
    }

    if (url === 'https://example.test/user/projects' && method === 'GET') {
      return jsonResponse([])
    }

    return jsonResponse({ message: `Unexpected fetch: ${method} ${url}` }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function seedLinkedProject() {
  await putProjectMetadata({
    schemaVersion: 1,
    localProjectPath: projectPath,
    projectName: 'bracket',
    remoteProjectId,
    remoteRevision,
    remoteUpdatedAt: '2026-07-08T12:00:00.000Z',
    baseManifest: {
      files: {},
    },
  })
}

describe('disconnectCloudSyncProject', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
    installFetchMock()
    cloudSyncRemoteProjects.value = [{ id: remoteProjectId }]
    configureCloudSyncEngine({
      enabled: true,
      baseUrl: 'https://example.test',
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: ['/documents/Projects'],
    })
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  })

  it('ignores mutations inside temporary duplicate roots', async () => {
    const temporaryProjectPath = `${projectDirectory}/${DUPLICATE_PROJECT_TEMPORARY_PREFIX}temporary`
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(new Map(), { projectDirectory })
    )

    await notifyCloudSyncWriteLikeMutation(
      `${temporaryProjectPath}/project.toml`
    )

    expect(
      await getCloudSyncProjectMetadata(temporaryProjectPath)
    ).toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('detaches local sync metadata before deleting the remote project', async () => {
    const files = new Map([
      [
        projectTomlPath,
        `title = "Bracket"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await seedLinkedProject()
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: `${projectPath}/main.kcl`,
      createdAt: '2026-07-08T12:00:00.000Z',
    })

    let finishDelete: (() => void) | undefined
    const deleteStarted = new Promise<void>((resolve) => {
      deleteProjectFetch = async () =>
        new Promise<Response>((resolveFetch) => {
          finishDelete = () => {
            resolveFetch(new Response(null, { status: 204 }))
          }
          resolve()
        })
    })

    const disconnect = disconnectCloudSyncProject(projectPath)
    await deleteStarted

    expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
      remoteProjectId: undefined,
      remoteRevision: undefined,
      baseManifest: undefined,
      syncExcluded: {
        reason: 'user-disconnected',
        remoteProjectId,
      },
    })
    expect(files.get(projectTomlPath)).not.toContain('project_id')
    expect(await getAllOutboxEntries()).toHaveLength(1)

    finishDelete?.()
    await disconnect

    expect(fetchMock).toHaveBeenCalledWith(
      remoteProjectUrl,
      expect.objectContaining({
        credentials: 'include',
        method: 'DELETE',
      })
    )
    expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
      remoteProjectId: undefined,
      remoteRevision: undefined,
      baseManifest: undefined,
      syncExcluded: {
        reason: 'user-disconnected',
        remoteProjectId,
      },
    })
    expect(await getAllOutboxEntries()).toHaveLength(0)
    expect(cloudSyncRemoteProjects.value).toEqual([])
  })

  it('restores the local cloud link when remote deletion fails', async () => {
    const files = new Map([
      [
        projectTomlPath,
        `title = "Bracket"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await seedLinkedProject()
    deleteProjectFetch = async () =>
      new Response(JSON.stringify({ message: 'Remote delete failed.' }), {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          'Content-Type': 'application/json',
        },
      })

    await expect(disconnectCloudSyncProject(projectPath)).rejects.toThrow(
      'Remote delete failed.'
    )

    expect(fetchMock).toHaveBeenCalledWith(
      remoteProjectUrl,
      expect.objectContaining({
        credentials: 'include',
        method: 'DELETE',
      })
    )
    expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
      remoteProjectId,
      remoteRevision,
      syncExcluded: undefined,
    })
    expect(files.get(projectTomlPath)).toContain(
      `project_id = "${remoteProjectId}"`
    )
  })
})

describe('cloud sync upload failures', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
    installFetchMock()
  })

  afterEach(async () => {
    setCloudSyncOpenedProject(undefined)
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  })

  it('records a blocked upload failure when the remote project is readable but not writable', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'cube = 1'],
      [
        projectTomlPath,
        `title = "Bracket"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await seedLinkedProject()
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: `${projectPath}/main.kcl`,
      createdAt: '2026-07-08T12:00:00.000Z',
    })
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)

      if (url === remoteProjectUrl && method === 'GET') {
        return jsonResponse({
          id: remoteProjectId,
          title: 'Bracket',
          description: 'Existing description',
          category_ids: ['existing-category'],
          revision: remoteRevision,
        })
      }

      if (
        url === `${remoteProjectUrl}?expected_revision=${remoteRevision}` &&
        method === 'PUT'
      ) {
        return new Response(JSON.stringify({ message: 'Forbidden' }), {
          status: 403,
          statusText: 'Forbidden',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })

    configureCloudSyncEngine({
      enabled: false,
      baseUrl: 'https://example.test',
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: ['/documents/Projects'],
    })
    setCloudSyncOpenedProject({
      projectPath,
      libraryPath: projectDirectory,
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    })
    configureCloudSyncEngine({ enabled: true })
    retryCloudSync()
    await vi.waitFor(() => {
      expect(cloudSyncStatus.value.lastFailureKind).toBe(
        'remote-upload-forbidden'
      )
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `${remoteProjectUrl}?expected_revision=${remoteRevision}`,
      expect.objectContaining({
        credentials: 'include',
        method: 'PUT',
      })
    )
    await expect(getAllOutboxEntries()).resolves.toHaveLength(1)
    const metadata = await getCloudSyncProjectMetadata(projectPath)
    expect(metadata?.conflict).toBeUndefined()
    expect(metadata?.lastFailure).toMatchObject({
      kind: 'remote-upload-forbidden',
      message: expect.stringContaining('does not have edit access'),
    })
    expect(cloudSyncStatus.value).toMatchObject({
      state: 'failed',
      activeProjectPath: projectPath,
      lastFailureKind: 'remote-upload-forbidden',
      lastFailure: expect.stringContaining('does not have edit access'),
    })

    configureCloudSyncEngine({
      enabled: true,
      baseUrl: 'https://example.test',
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: ['/documents/Projects'],
    })

    expect(cloudSyncStatus.value).toMatchObject({
      state: 'failed',
      activeProjectPath: projectPath,
      lastFailureKind: 'remote-upload-forbidden',
      lastFailure: expect.stringContaining('does not have edit access'),
    })
  })
})
