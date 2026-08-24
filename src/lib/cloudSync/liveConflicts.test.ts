import 'fake-indexeddb/auto'
import type * as ClientErrorsModule from '@src/lib/clientErrors'
import {
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  getCloudSyncProjectMetadata,
  isCloudSyncConflictRevisionChangedError,
  loadCloudSyncProjectConflictInspection,
  type ProjectArchiveFile,
  resolveCloudSyncProjectConflict,
} from '@src/lib/cloudSync'
import {
  normalizeProjectArchiveFilesForCloudSync,
  projectManifestFromFiles,
} from '@src/lib/cloudSync/projectArchive'
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
import {
  PROJECT_IMAGE_NAME,
  PROJECT_SETTINGS_FILE_NAME,
} from '@src/lib/constants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clientErrorsMock = vi.hoisted(() => ({
  reportClientError: vi.fn(),
}))

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrorsModule>()
  return {
    ...actual,
    reportClientError: clientErrorsMock.reportClientError,
  }
})

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
    description: 'Existing description',
    category_ids: ['existing-category'],
    revision,
    updated_at: remoteUpdatedAt,
  }
}

type RemoteArchivePayloadFile = {
  relativePath: string
  contents: string
}

function remoteArchivePayload(
  contents = 'remote = 2\n',
  files?: RemoteArchivePayloadFile[]
) {
  return {
    files: files ?? [
      { relativePath: 'main.kcl', contents },
      {
        relativePath: PROJECT_SETTINGS_FILE_NAME,
        contents: 'title = "Demo"\n',
      },
      { relativePath: PROJECT_IMAGE_NAME, contents: 'remote thumbnail' },
    ],
  }
}

function installFetchMock({
  remoteRevision = 'rev-2',
  remoteContents = 'remote = 2\n',
  remoteFiles,
  updatedRevision = 'rev-3',
  onUpdate,
}: {
  remoteRevision?: string
  remoteContents?: string
  remoteFiles?: RemoteArchivePayloadFile[]
  updatedRevision?: string
  onUpdate?: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => void | Promise<void>
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
      return jsonResponse(remoteArchivePayload(remoteContents, remoteFiles))
    }

    if (url.startsWith(remoteProjectUrl) && method === 'PUT') {
      await onUpdate?.(input, init)
      return jsonResponse(remoteProjectPayload(updatedRevision))
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
    clientErrorsMock.reportClientError.mockClear()
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
      [`${projectPath}/${PROJECT_IMAGE_NAME}`, 'local thumbnail'],
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
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
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
    await vi.waitFor(() =>
      expect(clientErrorsMock.reportClientError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'cloud_sync_conflict',
          errorName: 'CloudSyncConflict',
          message: 'Cloud sync conflict: local and remote both changed.',
          route: '/cloud-sync',
          dedupeKey: expect.stringContaining(
            `CloudSync:conflict:remote-project-id:${remoteProjectId}:rev-1:rev-2:`
          ),
          extra: expect.objectContaining({
            source: 'CloudSyncEngine',
            operation: 'reconcile-project',
            clientInstanceId: expect.any(String),
            projectIdentityKind: 'remote-project-id',
            projectIdentity: remoteProjectId,
            remoteProjectId,
            localProjectPathHash: expect.any(String),
            syncBaseRemoteRevision: 'rev-1',
            conflictRemoteRevision: 'rev-2',
            conflictRemoteUpdatedAt: remoteUpdatedAt,
            conflictAlreadyRecorded: false,
            baseManifestFingerprint: expect.any(String),
            localManifestFingerprint: expect.any(String),
            remoteManifestFingerprint: expect.any(String),
            divergentChangedFileCount: expect.any(Number),
          }),
        })
      )
    )
    expect(clientErrorsMock.reportClientError).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'cloud_sync_conflict_copy_detected',
      })
    )
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
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
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
    expect(inspection.changedFiles).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: PROJECT_IMAGE_NAME }),
      ])
    )
  })

  it('auto-reconciles independent local and remote archive changes', async () => {
    const projectToml =
      'title = "Demo"\ndefault_file = "main.kcl"\n\n[cloud."dev.zoo.dev"]\nproject_id = "remote-123"\n'
    const files = new Map([
      [`${projectPath}/main.kcl`, 'local = 2\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    const updatePayloads: Array<{
      categoryIds?: string[]
      description?: string
      expectedRevision?: string
      main?: string
      remote?: string
    }> = []
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'demo',
      remoteProjectId,
      remoteRevision: 'rev-1',
      baseManifest: await projectManifestFromFiles(
        normalizeProjectArchiveFilesForCloudSync([
          projectFile('main.kcl', 'base = 1\n'),
          projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
        ])
      ),
    })
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: `${projectPath}/main.kcl`,
      createdAt: '2026-07-17T12:02:00.000Z',
    })
    installFetchMock({
      remoteFiles: [
        { relativePath: 'main.kcl', contents: 'base = 1\n' },
        { relativePath: 'remote.kcl', contents: 'cloud = 2\n' },
        {
          relativePath: PROJECT_SETTINGS_FILE_NAME,
          contents: 'title = "Demo"\n',
        },
      ],
      onUpdate: async (_input, init) => {
        const formData = init?.body as FormData
        const body = JSON.parse(
          await (formData.get('body') as Blob).text()
        ) as {
          category_ids?: string[]
          description?: string
          expected_revision?: string
        }
        updatePayloads.push({
          categoryIds: body.category_ids,
          description: body.description,
          expectedRevision: body.expected_revision,
          main: await (formData.get('main.kcl') as Blob).text(),
          remote: await (formData.get('remote.kcl') as Blob).text(),
        })
      },
    })
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
    })

    await vi.waitFor(async () => {
      await expect(
        getCloudSyncProjectMetadata(projectPath)
      ).resolves.toMatchObject({
        remoteRevision: 'rev-3',
        conflict: undefined,
        lastFailure: undefined,
      })
    })

    expect(updatePayloads).toEqual([
      {
        categoryIds: ['existing-category'],
        description: 'Existing description',
        expectedRevision: 'rev-2',
        main: 'local = 2\n',
        remote: 'cloud = 2\n',
      },
    ])
    expect(files.get(`${projectPath}/main.kcl`)).toBe('local = 2\n')
    expect(files.get(`${projectPath}/remote.kcl`)).toBe('cloud = 2\n')
    expect(clientErrorsMock.reportClientError).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'cloud_sync_conflict_copy_detected',
      })
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
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
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
