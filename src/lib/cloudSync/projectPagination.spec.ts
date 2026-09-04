import 'fake-indexeddb/auto'
import type * as ClientErrorsModule from '@src/lib/clientErrors'
import {
  cloudSyncRemoteProjects,
  cloudSyncStatus,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  getCloudSyncProjectMetadata,
} from '@src/lib/cloudSync'
import {
  normalizeProjectArchiveFilesForCloudSync,
  projectManifestFromFiles,
} from '@src/lib/cloudSync/projectArchive'
import {
  getAllOutboxEntries,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import {
  createCloudSyncTestFs,
  deleteCloudSyncTestDatabase,
  getFetchUrl,
  jsonResponse,
} from '@src/lib/cloudSync/testUtils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/clientErrors', async (importOriginal) => ({
  ...(await importOriginal<typeof ClientErrorsModule>()),
  reportClientError: vi.fn(async () => undefined),
}))

const baseUrl = 'https://example.test'
const directory = '/documents/Projects'
const projectPath = `${directory}/bracket`
const project = { id: 'remote-bracket', title: 'bracket', revision: 'rev-1' }
const listUrl = `${baseUrl}/user/projects`
const detailUrl = `${listUrl}/${project.id}`
const toml = `title = "bracket"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${project.id}"\n`
const fetchMock = vi.fn<typeof fetch>()
let files: Map<string, string>

function startSync() {
  configureCloudSyncEngine({
    enabled: true,
    baseUrl,
    token: '',
    environmentName: 'dev.zoo.dev',
    cloudProjectDirectoryPaths: [directory],
    autoEnrollCloudLibraryProjects: false,
  })
  cloudSyncRemoteProjects.value = [project]
}

async function waitForSync(state: 'idle' | 'failed') {
  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalled()
    expect(cloudSyncStatus.value.state).toBe(state)
  })
}

async function expectLocalPreserved() {
  expect(files.get(`${projectPath}/main.kcl`)).toBe('x = 1')
  expect(files.get(`${projectPath}/project.toml`)).toContain(project.id)
  expect(await getCloudSyncProjectMetadata(projectPath)).toMatchObject({
    remoteProjectId: project.id,
  })
  expect(await getAllOutboxEntries()).toEqual([])
}

describe('remote inventory pagination and local data safety', () => {
  beforeEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    await deleteCloudSyncTestDatabase()
    files = new Map([
      [`${projectPath}/main.kcl`, 'x = 1'],
      [`${projectPath}/project.toml`, toml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory: directory })
    )
    const encoder = new TextEncoder()
    const baseManifest = await projectManifestFromFiles(
      normalizeProjectArchiveFilesForCloudSync([
        { relativePath: 'main.kcl', data: encoder.encode('x = 1') },
        { relativePath: 'project.toml', data: encoder.encode(toml) },
      ])
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId: project.id,
      remoteRevision: project.revision,
      baseManifest,
    })
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  })

  it('keeps the old inventory and local files until all pages arrive', async () => {
    let finishPage!: (response: Response) => void
    const pendingPage = new Promise<Response>((resolve) => {
      finishPage = resolve
    })
    fetchMock.mockImplementation(async (input) => {
      if (getFetchUrl(input) === listUrl)
        return jsonResponse({ items: [], next_page: 'two' })
      if (getFetchUrl(input) === `${listUrl}?page_token=two`) return pendingPage
      return jsonResponse({ message: 'Unexpected request' }, 500)
    })
    startSync()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(cloudSyncRemoteProjects.value).toEqual([project])
    await expectLocalPreserved()
    finishPage(jsonResponse({ items: [project], next_page: null }))
    await waitForSync('idle')
    await expectLocalPreserved()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('leaves the old inventory and local project intact when page two fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [], next_page: 'two' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Unavailable' }, 503))
    startSync()
    await waitForSync('failed')
    expect(cloudSyncRemoteProjects.value).toEqual([project])
    await expectLocalPreserved()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])(
    'confirms missing projects individually for paginated=%s inventories',
    async (paginated) => {
      fetchMock.mockImplementation(async (input) => {
        if (getFetchUrl(input) === listUrl)
          return jsonResponse(paginated ? { items: [], next_page: null } : [])
        if (getFetchUrl(input) === detailUrl) return jsonResponse(project)
        return jsonResponse({ message: 'Unexpected request' }, 500)
      })
      startSync()
      await waitForSync('idle')
      expect(fetchMock.mock.calls.map(([input]) => getFetchUrl(input))).toEqual(
        [listUrl, detailUrl]
      )
      expect(cloudSyncRemoteProjects.value).toEqual([project])
      await expectLocalPreserved()
    }
  )

  it.each([403, 429, 500])(
    'preserves local data when confirmation fails with %s',
    async (status) => {
      fetchMock.mockImplementation(async (input) =>
        getFetchUrl(input) === listUrl
          ? jsonResponse({ items: [], next_page: null })
          : jsonResponse({ message: 'Cannot confirm project' }, status)
      )
      startSync()
      await waitForSync('failed')
      await expectLocalPreserved()
    }
  )

  it('removes a clean local mirror only after a confirmed 404', async () => {
    fetchMock.mockImplementation(async (input) =>
      getFetchUrl(input) === listUrl
        ? jsonResponse({ items: [], next_page: null })
        : jsonResponse({ message: 'Not found' }, 404)
    )
    startSync()
    await waitForSync('idle')
    expect(fetchMock.mock.calls.map(([input]) => getFetchUrl(input))).toEqual([
      listUrl,
      detailUrl,
    ])
    expect(files.has(`${projectPath}/main.kcl`)).toBe(false)
    expect(await getCloudSyncProjectMetadata(projectPath)).toBeUndefined()
  })

  it('discards a completed inventory if sync was disabled while a page was pending', async () => {
    let finishPage!: (response: Response) => void
    const pendingPage = new Promise<Response>((resolve) => {
      finishPage = resolve
    })
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [], next_page: 'two' }))
      .mockImplementationOnce(async () => pendingPage)
    startSync()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    configureCloudSyncEngine({ enabled: false })
    finishPage(jsonResponse({ items: [project], next_page: null }))
    await vi.waitFor(() =>
      expect(cloudSyncStatus.value.state).not.toBe('syncing')
    )
    await expectLocalPreserved()
    expect(cloudSyncRemoteProjects.value).toEqual([])
    expect(cloudSyncStatus.value.state).toBe('disabled')
  })
})
