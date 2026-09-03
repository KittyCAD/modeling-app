import 'fake-indexeddb/auto'
import type * as ClientErrorsModule from '@src/lib/clientErrors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clientErrorsMock = vi.hoisted(() => ({
  reportClientError: vi.fn<typeof ClientErrorsModule.reportClientError>(
    async () => undefined
  ),
}))

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientErrorsModule>()
  return {
    ...actual,
    reportClientError: clientErrorsMock.reportClientError,
  }
})

import {
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  filterCloudSyncProjectFilesForSync,
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

const baseUrl = 'https://example.test'
const environmentName = 'dev.zoo.dev'
const projectDirectory = '/documents/Projects'
const projectPath = `${projectDirectory}/bracket`
const remoteProjectId = '123e4567-e89b-42d3-a456-426614174000'
const remoteRevision = 'revision-123'
const updatedRemoteRevision = 'revision-124'
const remoteProjectUrl = `${baseUrl}/user/projects/${remoteProjectId}`
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

function installFetchMock(
  onUpdate?: (formData: FormData) => Promise<void>,
  updateStatus = 200
) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = getFetchUrl(input)
    const method = getFetchMethod(input, init)

    if (url === remoteProjectUrl && method === 'GET') {
      return jsonResponse(remoteProject())
    }

    if (url.startsWith(remoteProjectUrl) && method === 'PUT') {
      await onUpdate?.(init?.body as FormData)
      if (updateStatus !== 200) {
        return jsonResponse(
          { message: 'Project update rejected' },
          updateStatus
        )
      }
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
    clientErrorsMock.reportClientError.mockClear()
  })

  afterEach(async () => {
    setCloudSyncOpenedProject(undefined)
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
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

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            getFetchUrl(input).startsWith(remoteProjectUrl) &&
            getFetchMethod(input, init) === 'PUT'
        )
      ).toHaveLength(1)
    })
    await expect(getAllOutboxEntries()).resolves.toEqual([])
  })

  it('declares observed local file deletions in a replacement upload', async () => {
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
      deletedPaths: ['obsolete.kcl'],
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

  it('omits deletion intent when a queued deletion is recreated before upload', async () => {
    const recreatedFilePath = `${projectPath}/obsolete.kcl`
    const files = new Map([
      [`${projectPath}/main.kcl`, 'base = 1\n'],
      [recreatedFilePath, 'recreated = 2\n'],
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
      targetPath: recreatedFilePath,
      deletedPaths: ['obsolete.kcl'],
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
    expect(uploadedDeletedPaths).toBeUndefined()
    await expect(getAllOutboxEntries()).resolves.toEqual([])
  })

  it('reports an untracked deletion rejection without leaking outbox paths', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'base = 1\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await seedSyncedProject([
      projectFile('main.kcl', 'base = 1\n'),
      projectFile('private/obsolete.kcl', 'obsolete = 1\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
    ])
    let uploadedDeletedPaths: string[] | undefined
    installFetchMock(async (formData) => {
      const body = JSON.parse(await (formData.get('body') as Blob).text()) as {
        deleted_paths?: string[]
      }
      uploadedDeletedPaths = body.deleted_paths
    }, 409)
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

    await expect(syncCloudSyncProjectNow(projectPath)).rejects.toThrow(
      'Project update rejected'
    )
    expect(uploadedDeletedPaths).toBeUndefined()
    const failureReport = clientErrorsMock.reportClientError.mock.calls
      .map(([report]) => report)
      .find((report) => report.code === 'cloud_sync_failure')
    expect(failureReport).toMatchObject({
      extra: {
        remoteProjectId,
        syncBaseRemoteRevisionPresent: true,
        observedRemoteRevisionPresent: true,
        remoteRevisionsMatch: true,
        baseManifestFileCount: 3,
        localManifestFileCount: 2,
        replacementUploadFileCount: 2,
        replacementUploadDeletedPathCount: 0,
        replacementUploadIncludedDeletedPaths: false,
        attemptOutbox: {
          readSucceeded: true,
          entryCount: 0,
          upsertEntryCount: 0,
          deleteEntryCount: 0,
          entriesWithSourcePathCount: 0,
          entriesWithDeletedPathsCount: 0,
          declaredDeletedPathCount: 0,
          distinctDeletedPathCount: 0,
        },
        currentOutbox: {
          readSucceeded: true,
          entryCount: 0,
        },
      },
    })
    expect(JSON.stringify(failureReport)).not.toContain(projectPath)
    expect(JSON.stringify(failureReport)).not.toContain('obsolete.kcl')
  })

  it('reports persisted deletion intent on a rejected replacement upload', async () => {
    const deletedFilePath = `${projectPath}/private/obsolete.kcl`
    const files = new Map([
      [`${projectPath}/main.kcl`, 'base = 1\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await seedSyncedProject([
      projectFile('main.kcl', 'base = 1\n'),
      projectFile('private/obsolete.kcl', 'obsolete = 1\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
    ])
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: deletedFilePath,
      deletedPaths: ['private/obsolete.kcl'],
      createdAt: '2026-08-24T12:00:00.000Z',
    })
    let uploadedDeletedPaths: string[] | undefined
    installFetchMock(async (formData) => {
      const body = JSON.parse(await (formData.get('body') as Blob).text()) as {
        deleted_paths?: string[]
      }
      uploadedDeletedPaths = body.deleted_paths
      await appendOutboxEntry({
        projectPath,
        kind: 'delete',
        targetPath: projectPath,
        createdAt: '2026-08-24T12:01:00.000Z',
      })
    }, 409)
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

    await expect(syncCloudSyncProjectNow(projectPath)).rejects.toThrow(
      'Project update rejected'
    )

    expect(uploadedDeletedPaths).toEqual(['private/obsolete.kcl'])
    const failureReport = clientErrorsMock.reportClientError.mock.calls
      .map(([report]) => report)
      .find((report) => report.code === 'cloud_sync_failure')
    expect(failureReport).toMatchObject({
      extra: {
        remoteProjectId,
        syncBaseRemoteRevisionPresent: true,
        observedRemoteRevisionPresent: true,
        remoteRevisionsMatch: true,
        baseManifestFileCount: 3,
        localManifestFileCount: 2,
        replacementUploadFileCount: 2,
        replacementUploadDeletedPathCount: 1,
        replacementUploadIncludedDeletedPaths: true,
        attemptOutbox: {
          readSucceeded: true,
          entryCount: 1,
          upsertEntryCount: 1,
          deleteEntryCount: 0,
          entriesWithSourcePathCount: 0,
          entriesWithDeletedPathsCount: 1,
          declaredDeletedPathCount: 1,
          distinctDeletedPathCount: 1,
        },
        currentOutbox: {
          readSucceeded: true,
          entryCount: 1,
          upsertEntryCount: 0,
          deleteEntryCount: 1,
          declaredDeletedPathCount: 0,
        },
      },
    })
    const serializedReport = JSON.stringify(failureReport)
    expect(serializedReport).not.toContain(projectPath)
    expect(serializedReport).not.toContain('obsolete.kcl')
    await expect(getAllOutboxEntries()).resolves.toHaveLength(1)
  })

  it('preserves upload diagnostics when persisting the failure also fails', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'base = 1\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await seedSyncedProject([
      projectFile('main.kcl', 'base = 1\n'),
      projectFile('private/obsolete.kcl', 'obsolete = 1\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
    ])
    const originalIndexedDb = globalThis.indexedDB
    installFetchMock(async () => {
      vi.stubGlobal('indexedDB', undefined)
    }, 409)
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

    await expect(syncCloudSyncProjectNow(projectPath)).rejects.toThrow(
      'Project update rejected'
    )
    vi.stubGlobal('indexedDB', originalIndexedDb)

    const failureReports = clientErrorsMock.reportClientError.mock.calls
      .map(([report]) => report)
      .filter((report) => report.code === 'cloud_sync_failure')
    expect(failureReports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extra: expect.objectContaining({ operation: 'mutation' }),
        }),
        expect.objectContaining({
          extra: expect.objectContaining({
            operation: 'sync',
            cloudApiStatus: 409,
            replacementUploadDeletedPathCount: 0,
            attemptOutbox: expect.objectContaining({
              readSucceeded: true,
              entryCount: 0,
            }),
            currentOutbox: { readSucceeded: false },
          }),
        }),
      ])
    )
  })
})
