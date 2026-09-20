import 'fake-indexeddb/auto'
import {
  cloudSyncStatus,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  disableCloudSyncEngineForTest,
  filterCloudSyncProjectFilesForSync,
  getCloudSyncProjectMetadata,
  notifyCloudSyncWriteLikeMutation,
  type ProjectArchiveFile,
  setCloudSyncOpenedProject,
  syncCloudSyncProjectNow,
} from '@src/lib/cloudSync'
import { projectManifestFromFiles } from '@src/lib/cloudSync/projectArchive'
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
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const baseUrl = 'https://example.test'
const environmentName = 'dev.zoo.dev'
const projectDirectory = '/documents/Projects'
const projectPath = `${projectDirectory}/bracket`
const remoteProjectId = 'remote-project-123'
const remoteRevision = 'revision-123'
const updatedRemoteRevision = 'revision-124'
const remoteProjectUrl = `${baseUrl}/user/projects/${remoteProjectId}`
const remoteDownloadUrl = `${remoteProjectUrl}/download?format=zip`
const encoder = new TextEncoder()
const projectToml = `title = "Bracket"\n\n[cloud."${environmentName}"]\nproject_id = "${remoteProjectId}"\n`

const fetchMock = vi.fn<typeof fetch>()

function projectFile(
  relativePath: string,
  contents: string
): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

function remoteProject(revision = remoteRevision) {
  return {
    category_ids: [],
    description: '',
    id: remoteProjectId,
    title: 'Bracket',
    revision,
  }
}

function installFetchMock(onUpdate?: (formData: FormData) => Promise<void>) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = getFetchUrl(input)
    const method = getFetchMethod(input, init)

    if (url === remoteProjectUrl && method === 'GET') {
      return jsonResponse(remoteProject())
    }

    if (url.startsWith(remoteProjectUrl) && method === 'PUT') {
      await onUpdate?.(init?.body as FormData)
      return jsonResponse(remoteProject(updatedRemoteRevision))
    }

    if (url.endsWith('/user/client-errors') && method === 'POST') {
      return jsonResponse({})
    }

    return jsonResponse({ message: `Unexpected fetch: ${method} ${url}` }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function seedSyncedProject(baseFiles: ProjectArchiveFile[]) {
  await putProjectMetadata({
    schemaVersion: 1,
    localProjectPath: projectPath,
    projectName: 'bracket',
    remoteProjectId,
    remoteRevision,
    baseManifest: await projectManifestFromFiles(
      filterCloudSyncProjectFilesForSync(baseFiles)
    ),
  })
}

describe('cloud sync reliability', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
    fetchMock.mockReset()
  })

  afterEach(async () => {
    setCloudSyncOpenedProject(undefined)
    await disableCloudSyncEngineForTest()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  })

  it('preserves newer sync metadata when a write notification finishes late', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'local = 2\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    const cloudSyncFs = createCloudSyncTestFs(files, { projectDirectory })
    configureCloudSyncLocalFileSystem(cloudSyncFs)
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)
      if (url === `${baseUrl}/user/projects` && method === 'GET') {
        return jsonResponse([])
      }
      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName,
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })
    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            getFetchUrl(input) === `${baseUrl}/user/projects` &&
            getFetchMethod(input, init) === 'GET'
        )
      ).toBe(true)
      expect(cloudSyncStatus.value.state).toBe('idle')
    })

    const staleMetadata = {
      schemaVersion: 1 as const,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId,
      baseManifest: await projectManifestFromFiles([
        projectFile('main.kcl', 'base = 1\n'),
        projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
      ]),
    }
    await putProjectMetadata(staleMetadata)

    let releaseDirectoryStat!: () => void
    let markDirectoryStatStarted!: () => void
    const directoryStatGate = new Promise<void>((resolve) => {
      releaseDirectoryStat = resolve
    })
    const directoryStatStarted = new Promise<void>((resolve) => {
      markDirectoryStatStarted = resolve
    })
    const originalStat = cloudSyncFs.stat.bind(cloudSyncFs)
    let heldDirectoryStat = false
    cloudSyncFs.stat = async (targetPath) => {
      if (!heldDirectoryStat && targetPath === projectPath) {
        heldDirectoryStat = true
        markDirectoryStatStarted()
        await directoryStatGate
      }
      return originalStat(targetPath)
    }

    const notification = notifyCloudSyncWriteLikeMutation(
      `${projectPath}/main.kcl`
    )
    await directoryStatStarted
    await putProjectMetadata({
      ...staleMetadata,
      remoteRevision,
      lastSyncedAt: '2026-09-06T00:00:00.000Z',
    })
    releaseDirectoryStat()
    await notification

    await expect(
      getCloudSyncProjectMetadata(projectPath)
    ).resolves.toMatchObject({
      remoteProjectId,
      remoteRevision,
      lastSyncedAt: '2026-09-06T00:00:00.000Z',
    })
    await expect(getAllOutboxEntries()).resolves.toHaveLength(1)
  })

  it('drains project writes when a direct file-route reload omitted library ownership', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'local = 2\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await seedSyncedProject([
      projectFile('main.kcl', 'base = 1\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
    ])
    installFetchMock()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    // A direct browser reload can restore the project path before project
    // library ownership has been resolved.
    setCloudSyncOpenedProject({ projectPath })
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName,
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: true,
    })

    await notifyCloudSyncWriteLikeMutation(`${projectPath}/main.kcl`)

    const putCalls = () =>
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          getFetchUrl(input).startsWith(remoteProjectUrl) &&
          getFetchMethod(input, init) === 'PUT'
      )

    // The write notification replaced configureCloudSyncEngine's immediate
    // timer with the normal 2.5 second write debounce.
    expect(putCalls()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(putCalls()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1_500)
    vi.useRealTimers()
    await vi.waitFor(() => expect(putCalls()).toHaveLength(1))
    await expect(getAllOutboxEntries()).resolves.toEqual([])
  })

  it('derives replacement deletions from the acknowledged base manifest', async () => {
    const deletedFilePath = `${projectPath}/obsolete.kcl`
    const files = new Map([
      [`${projectPath}/main.kcl`, 'base = 1\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await seedSyncedProject([
      projectFile('main.kcl', 'base = 1\n'),
      projectFile('obsolete.kcl', 'obsolete = 1\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
    ])
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: deletedFilePath,
      createdAt: '2026-08-24T12:00:00.000Z',
    })
    let uploadedDeletedPaths: string[] | undefined
    installFetchMock(async (formData) => {
      const body = JSON.parse(await (formData.get('body') as Blob).text()) as {
        deleted_paths?: string[]
      }
      uploadedDeletedPaths = body.deleted_paths
    })
    setCloudSyncOpenedProject({
      projectPath,
      libraryPath: projectDirectory,
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    })

    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName,
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: true,
    })

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            getFetchUrl(input).startsWith(remoteProjectUrl) &&
            getFetchMethod(input, init) === 'PUT'
        )
      ).toHaveLength(1)
    })
    expect(uploadedDeletedPaths).toEqual(['obsolete.kcl'])
  })

  it('blocks a rejected replacement without discarding local state or outbox work', async () => {
    const deletedFilePath = `${projectPath}/obsolete.kcl`
    const files = new Map([
      [`${projectPath}/main.kcl`, 'local = 2\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    const baseFiles = [
      projectFile('main.kcl', 'base = 1\n'),
      projectFile('obsolete.kcl', 'obsolete = 1\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
    ]
    await seedSyncedProject(baseFiles)
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: deletedFilePath,
      createdAt: '2026-08-24T12:00:00.000Z',
    })

    let projectReads = 0
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)
      if (url === remoteProjectUrl && method === 'GET') {
        projectReads += 1
        return jsonResponse(
          remoteProject(
            projectReads === 1 ? remoteRevision : updatedRemoteRevision
          )
        )
      }
      if (url.startsWith(remoteProjectUrl) && method === 'PUT') {
        return jsonResponse(
          {
            message:
              'Project replacement does not match the declared file deletions. Reload and retry the mutation.',
          },
          409
        )
      }
      if (url.endsWith('/user/client-errors') && method === 'POST') {
        return jsonResponse({})
      }
      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    setCloudSyncOpenedProject({
      projectPath,
      libraryPath: projectDirectory,
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    })

    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName,
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: true,
    })

    await vi.waitFor(() => {
      expect(cloudSyncStatus.value.state).toBe('conflict')
    })
    expect(projectReads).toBe(2)
    expect(files.get(`${projectPath}/main.kcl`)).toBe('local = 2\n')
    await expect(getAllOutboxEntries()).resolves.toHaveLength(1)
    await expect(
      getCloudSyncProjectMetadata(projectPath)
    ).resolves.toMatchObject({
      remoteRevision,
      baseManifest: await projectManifestFromFiles(baseFiles),
      conflict: {
        remoteRevision: updatedRemoteRevision,
        reason: 'remote-replacement-rejected',
      },
      lastFailure: {
        kind: 'remote-replacement-rejected',
      },
    })
  })

  it('preserves a rejected replacement when the project is reopened', async () => {
    const deletedFilePath = `${projectPath}/obsolete.kcl`
    const files = new Map([
      [`${projectPath}/main.kcl`, 'local = 2\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    const baseFiles = [
      projectFile('main.kcl', 'base = 1\n'),
      projectFile('obsolete.kcl', 'obsolete = 1\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
    ]
    await seedSyncedProject(baseFiles)
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: deletedFilePath,
      createdAt: '2026-08-24T12:00:00.000Z',
    })

    let projectReads = 0
    let remoteArchiveReads = 0
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)
      if (url === remoteProjectUrl && method === 'GET') {
        projectReads += 1
        return jsonResponse(
          remoteProject(
            projectReads === 1 ? remoteRevision : updatedRemoteRevision
          )
        )
      }
      if (url.startsWith(remoteProjectUrl) && method === 'PUT') {
        return jsonResponse(
          {
            message:
              'Project replacement does not match the declared file deletions. Reload and retry the mutation.',
          },
          409
        )
      }
      if (url === remoteDownloadUrl && method === 'GET') {
        remoteArchiveReads += 1
        return jsonResponse({
          files: [
            { relativePath: 'main.kcl', contents: 'remote = 3\n' },
            {
              relativePath: PROJECT_SETTINGS_FILE_NAME,
              contents: projectToml,
            },
          ],
        })
      }
      if (url.endsWith('/user/client-errors') && method === 'POST') {
        return jsonResponse({})
      }
      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    setCloudSyncOpenedProject({
      projectPath,
      libraryPath: projectDirectory,
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    })
    const config = {
      enabled: true,
      baseUrl,
      environmentName,
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: true,
    }
    configureCloudSyncEngine(config)

    await vi.waitFor(() => {
      expect(cloudSyncStatus.value.state).toBe('conflict')
      expect(cloudSyncStatus.value.lastFailureKind).toBe(
        'remote-replacement-rejected'
      )
    })

    // Recreate the runtime boundaries while retaining the durable filesystem
    // and IndexedDB state that a new application session would observe.
    await disableCloudSyncEngineForTest()
    setCloudSyncOpenedProject(undefined)
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    setCloudSyncOpenedProject({
      projectPath,
      libraryPath: projectDirectory,
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    })
    configureCloudSyncEngine(config)

    await vi.waitFor(() => {
      expect(remoteArchiveReads).toBe(1)
      expect(cloudSyncStatus.value.state).toBe('conflict')
    })
    expect(files.get(`${projectPath}/main.kcl`)).toBe('local = 2\n')
    await expect(getAllOutboxEntries()).resolves.toMatchObject([
      {
        projectPath,
        kind: 'upsert',
        targetPath: deletedFilePath,
      },
    ])
    await expect(
      getCloudSyncProjectMetadata(projectPath)
    ).resolves.toMatchObject({
      remoteRevision,
      baseManifest: await projectManifestFromFiles(baseFiles),
      conflict: {
        remoteRevision: updatedRemoteRevision,
      },
    })
  })

  it('does not hydrate over a local mutation made during the remote fetch', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'base = 1\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await seedSyncedProject([
      projectFile('main.kcl', 'base = 1\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
    ])

    let markDownloadStarted!: () => void
    let releaseDownload!: () => void
    const downloadStarted = new Promise<void>((resolve) => {
      markDownloadStarted = resolve
    })
    const downloadGate = new Promise<void>((resolve) => {
      releaseDownload = resolve
    })
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)
      if (url === remoteProjectUrl && method === 'GET') {
        return jsonResponse(remoteProject(updatedRemoteRevision))
      }
      if (url === remoteDownloadUrl && method === 'GET') {
        markDownloadStarted()
        await downloadGate
        return jsonResponse({
          files: [
            { relativePath: 'main.kcl', contents: 'remote = 2\n' },
            {
              relativePath: PROJECT_SETTINGS_FILE_NAME,
              contents: projectToml,
            },
          ],
        })
      }
      if (url.endsWith('/user/client-errors') && method === 'POST') {
        return jsonResponse({})
      }
      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName,
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: true,
    })

    const sync = syncCloudSyncProjectNow(projectPath)
    await downloadStarted
    files.set(`${projectPath}/main.kcl`, 'local = 3\n')
    await notifyCloudSyncWriteLikeMutation(`${projectPath}/main.kcl`)
    releaseDownload()

    await expect(sync).rejects.toThrow(
      'Cloud sync found conflicting local and remote changes.'
    )
    expect(files.get(`${projectPath}/main.kcl`)).toBe('local = 3\n')
    await expect(getAllOutboxEntries()).resolves.toHaveLength(1)
  })
})
