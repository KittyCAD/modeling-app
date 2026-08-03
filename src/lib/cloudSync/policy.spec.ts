import 'fake-indexeddb/auto'
import {
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  filterCloudSyncProjectFilesForSync,
  notifyCloudSyncWriteLikeMutation,
  retryCloudSync,
  setCloudSyncProjectScope,
  type ProjectArchiveFile,
} from '@src/lib/cloudSync'
import {
  appendOutboxEntry,
  getAllOutboxEntries,
  getProjectMetadata,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import { projectManifestFromFiles } from '@src/lib/cloudSync/projectArchive'
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

const encoder = new TextEncoder()
const baseUrl = 'https://example.test'
const projectDirectory = '/documents/Projects'
const projectPath = `${projectDirectory}/bracket`
const remoteProjectId = 'remote-project-123'
const remoteRevision = 'revision-123'
const remoteProjectUrl = `${baseUrl}/user/projects/${remoteProjectId}`
const projectToml = `title = "Bracket"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`

const fetchMock = vi.fn<typeof fetch>()

function projectFile(relativePath: string, contents = ''): ProjectArchiveFile {
  return {
    relativePath,
    data: encoder.encode(contents),
  }
}

function installFetchMock() {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = getFetchUrl(input)
    const method = getFetchMethod(input, init)

    if (url === `${baseUrl}/user/projects` && method === 'GET') {
      return jsonResponse([])
    }

    if (url === remoteProjectUrl && method === 'GET') {
      return jsonResponse({
        id: remoteProjectId,
        title: 'Bracket',
        revision: remoteRevision,
      })
    }

    return jsonResponse({ message: `Unexpected fetch: ${method} ${url}` }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function cleanBaseManifest() {
  return projectManifestFromFiles(
    filterCloudSyncProjectFilesForSync([
      projectFile('main.kcl', 'cube = 1\n'),
      projectFile(PROJECT_SETTINGS_FILE_NAME, projectToml),
      projectFile('.gitignore', 'scratch.txt\nnested/local.txt\n'),
    ])
  )
}

describe('cloud sync file policy', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
    installFetchMock()
  })

  afterEach(async () => {
    setCloudSyncProjectScope(undefined)
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  })

  it('does not infer a top-level cloud-library file as a project root', async () => {
    const topLevelFilePath = `${projectDirectory}/main.kcl`
    const files = new Map([[topLevelFilePath, 'cube = 1\n']])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: projectDirectory,
      autoEnrollCloudLibraryProjects: false,
    })

    await notifyCloudSyncWriteLikeMutation(topLevelFilePath)

    expect(await getProjectMetadata(topLevelFilePath)).toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('does not enqueue mutations for ignored files or generated thumbnails', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'cube = 1\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, `title = "Bracket"\n`],
      [`${projectPath}/.gitignore`, 'scratch.txt\n'],
      [`${projectPath}/scratch.txt`, 'ignored local note\n'],
      [`${projectPath}/nested/.gitignore`, 'local.txt\n'],
      [`${projectPath}/nested/local.txt`, 'ignored nested note\n'],
      [`${projectPath}/${PROJECT_IMAGE_NAME}`, 'generated thumbnail\n'],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: projectDirectory,
      autoEnrollCloudLibraryProjects: false,
    })

    await notifyCloudSyncWriteLikeMutation(`${projectPath}/scratch.txt`)
    await notifyCloudSyncWriteLikeMutation(`${projectPath}/nested/local.txt`)
    await notifyCloudSyncWriteLikeMutation(
      `${projectPath}/${PROJECT_IMAGE_NAME}`
    )

    expect(await getAllOutboxEntries()).toEqual([])
  })

  it('clears ignored-file-only pending work without uploading a new revision', async () => {
    const files = new Map([
      [`${projectPath}/main.kcl`, 'cube = 1\n'],
      [`${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`, projectToml],
      [`${projectPath}/.gitignore`, 'scratch.txt\nnested/local.txt\n'],
      [`${projectPath}/scratch.txt`, 'ignored local note changed\n'],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: projectPath,
      projectName: 'bracket',
      remoteProjectId,
      remoteRevision,
      remoteUpdatedAt: '2026-07-08T12:00:00.000Z',
      baseManifest: await cleanBaseManifest(),
    })
    await appendOutboxEntry({
      projectPath,
      kind: 'upsert',
      targetPath: `${projectPath}/scratch.txt`,
      createdAt: '2026-07-08T12:01:00.000Z',
    })

    setCloudSyncProjectScope(projectPath)
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      projectDirectoryPath: projectDirectory,
      autoEnrollCloudLibraryProjects: false,
    })
    retryCloudSync()

    await vi.waitFor(async () => {
      expect(await getAllOutboxEntries()).toEqual([])
    })
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => getFetchMethod(input, init) === 'PUT'
      )
    ).toBe(false)
  })
})
