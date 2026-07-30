import 'fake-indexeddb/auto'
import {
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  getCloudSyncProjectMetadata,
  isCloudSyncConflictRevisionChangedError,
  loadCloudSyncProjectConflictInspection,
  type ProjectArchiveFile,
  resolveCloudSyncProjectConflict,
} from '@src/lib/cloudSync'
import { projectManifestFromFiles } from '@src/lib/cloudSync/projectArchive'
import {
  appendOutboxEntry,
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const baseUrl = 'https://example.test'
const projectDirectory = '/documents/Projects'
const projectPath = `${projectDirectory}/demo`
const remoteProjectId = 'remote-123'
const remoteProjectUrl = `${baseUrl}/user/projects/${remoteProjectId}`
const remoteDownloadUrl = `${remoteProjectUrl}/download?format=zip`
const remoteUpdatedAt = '2026-07-17T12:00:00.000Z'
const encoder = new TextEncoder()

const fetchMock = vi.fn<typeof fetch>()

function projectFile(relativePath: string, contents = ''): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

function remoteProjectPayload(revision = 'rev-2') {
  return {
    id: remoteProjectId,
    title: 'Demo',
    revision,
    updated_at: remoteUpdatedAt,
  }
}

function remoteArchivePayload(contents = 'remote = 2\n') {
  return {
    files: [
      { relativePath: 'main.kcl', contents },
      {
        relativePath: PROJECT_SETTINGS_FILE_NAME,
        contents: 'title = "Demo"\n',
      },
    ],
  }
}

function installFetchMock({
  remoteRevision = 'rev-2',
  remoteContents = 'remote = 2\n',
}: {
  remoteRevision?: string
  remoteContents?: string
} = {}) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = getFetchUrl(input)
    const method = getFetchMethod(input, init)

    if (url === `${baseUrl}/user/projects` && method === 'GET') {
      return jsonResponse([remoteProjectPayload(remoteRevision)])
    }

    if (url === remoteProjectUrl && method === 'GET') {
      return jsonResponse(remoteProjectPayload(remoteRevision))
    }

    if (url === remoteDownloadUrl && method === 'GET') {
      return jsonResponse(remoteArchivePayload(remoteContents))
    }

    return jsonResponse({ message: `Unexpected fetch: ${method} ${url}` }, 500)
  })
}

async function putConflictedProjectMetadata() {
  await putProjectMetadata({
    schemaVersion: 1,
    localProjectPath: projectPath,
    projectName: 'demo',
    remoteProjectId,
    remoteRevision: 'rev-1',
    baseManifest: await projectManifestFromFiles([
      projectFile('main.kcl', 'base = 1\n'),
    ]),
    conflict: {
      remoteRevision: 'rev-2',
      remoteUpdatedAt,
      createdAt: '2026-07-17T12:01:00.000Z',
    },
  })
}

describe('cloud sync live conflicts', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  })

  it('marks conflicts without creating persisted conflict-copy projects', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'local = 2\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, 'title = "Demo"\n'],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'demo',
      remoteProjectId,
      remoteRevision: 'rev-1',
      baseManifest: await projectManifestFromFiles([
        projectFile('main.kcl', 'base = 1\n'),
      ]),
    })
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: `${projectPath}/main.kcl`,
      createdAt: '2026-07-17T12:02:00.000Z',
    })
    installFetchMock()

    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: projectDirectory,
      syncExistingLocalProjects: false,
    })

    await vi.waitFor(async () => {
      await expect(
        getCloudSyncProjectMetadata(projectPath)
      ).resolves.toMatchObject({
        conflict: {
          remoteRevision: 'rev-2',
          remoteUpdatedAt,
        },
      })
    })
    const metadata = await getCloudSyncProjectMetadata(projectPath)
    expect(metadata?.conflict?.conflictProjectPath).toBeUndefined()
    expect(
      [...files.keys()].some((path) => path.includes('(cloud conflict'))
    ).toBe(false)
  })

  it('loads conflict inspection from the live remote archive', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'local = 2\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, 'title = "Demo"\n'],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putConflictedProjectMetadata()
    installFetchMock({ remoteContents: 'remote = 3\n' })
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: projectDirectory,
      syncExistingLocalProjects: false,
    })

    const inspection = await loadCloudSyncProjectConflictInspection(projectPath)

    expect(inspection).not.toBeInstanceOf(Error)
    if (inspection instanceof Error) {
      return
    }
    expect(inspection.remoteRevision).toBe('rev-2')
    expect(inspection.cloudSavedAtMs).toBe(Date.parse(remoteUpdatedAt))
    expect(inspection.changedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: 'main.kcl',
          localText: 'local = 2\n',
          cloudText: 'remote = 3\n',
        }),
      ])
    )
  })

  it('rejects conflict resolution when the reviewed cloud revision is stale', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'local = 2\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, 'title = "Demo"\n'],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putConflictedProjectMetadata()
    installFetchMock({ remoteRevision: 'rev-3' })
    configureCloudSyncEngine({
      enabled: false,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: projectDirectory,
      syncExistingLocalProjects: false,
    })

    let caughtError: unknown
    try {
      await resolveCloudSyncProjectConflict(projectPath, 'local', 'rev-2')
    } catch (error) {
      caughtError = error
    }

    expect(isCloudSyncConflictRevisionChangedError(caughtError)).toBe(true)
    const metadata = await getCloudSyncProjectMetadata(projectPath)
    expect(metadata?.lastFailure).toBeUndefined()
    expect(files.get(`${projectPath}/main.kcl`)).toBe('local = 2\n')
  })
})
