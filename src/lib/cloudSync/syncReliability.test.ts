import 'fake-indexeddb/auto'
import {
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  filterCloudSyncProjectFilesForSync,
  notifyCloudSyncWriteLikeMutation,
  type ProjectArchiveFile,
  setCloudSyncOpenedProject,
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
})
