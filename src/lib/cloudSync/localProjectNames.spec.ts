import 'fake-indexeddb/auto'
import {
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  ensureCloudProjectLocallySynced,
  getCloudSyncProjectMetadata,
  scheduleCloudProjectDirectoryNameSyncFromTitles,
} from '@src/lib/cloudSync'
import {
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
import type * as TrapModule from '@src/lib/trap'
import { reportRejection } from '@src/lib/trap'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/trap', async (importOriginal) => {
  const actual = await importOriginal<typeof TrapModule>()
  return {
    ...actual,
    reportRejection: vi.fn(),
  }
})

const baseUrl = 'https://example.test'
const projectDirectory = '/documents/Projects'
const remoteProjectId = 'remote-project-123'
const remoteProjectTitle = 'Café Bracket / v2'
const expectedProjectName = 'cafe-bracket-v2'
const idProjectPath = `${projectDirectory}/${remoteProjectId}`
const titleProjectPath = `${projectDirectory}/${expectedProjectName}`
const remoteProjectUrl = `${baseUrl}/user/projects/${remoteProjectId}`
const remoteProjectDownloadUrl = `${remoteProjectUrl}/download?format=zip`

const fetchMock = vi.fn<typeof fetch>()

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
        title: remoteProjectTitle,
        revision: 'rev-1',
      })
    }
    if (url === remoteProjectDownloadUrl && method === 'GET') {
      return jsonResponse({
        files: [{ relativePath: 'main.kcl', contents: 'x = 1' }],
      })
    }

    return jsonResponse({ message: `Unexpected fetch: ${method} ${url}` }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
}

function configureCloudSyncTestFs(
  files: Map<string, string>,
  options: { failRenames?: boolean } = {}
) {
  configureCloudSyncLocalFileSystem(
    createCloudSyncTestFs(files, { projectDirectory, ...options })
  )
  configureCloudSyncEngine({
    enabled: true,
    baseUrl,
    environmentName: 'dev.zoo.dev',
    projectDirectoryPath: projectDirectory,
    syncExistingLocalProjects: false,
  })
}

function createIdBasedCloudProjectFiles() {
  return new Map([
    [`${idProjectPath}/main.kcl`, 'x = 1'],
    [
      `${idProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
      `title = "${remoteProjectTitle}"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${remoteProjectId}"\n`,
    ],
  ])
}

async function seedIdBasedCloudProjectMetadata() {
  await putProjectMetadata({
    schemaVersion: 1,
    localProjectPath: idProjectPath,
    projectName: remoteProjectId,
    remoteProjectId,
  })
}

function scheduleIdBasedProjectDirectorySync() {
  const onProjectDirectoriesRenamed = vi.fn()
  scheduleCloudProjectDirectoryNameSyncFromTitles({
    projects: [
      {
        path: idProjectPath,
        name: remoteProjectId,
        title: remoteProjectTitle,
        readWriteAccess: true,
      },
    ],
    onProjectDirectoriesRenamed,
  })
  return onProjectDirectoriesRenamed
}

describe('cloud sync local project names', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
    installFetchMock()
    vi.mocked(reportRejection).mockClear()
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(new Map(), { projectDirectory })
    )
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  })

  it('materializes remote projects with a Unix-friendly directory name from the title', async () => {
    const files = new Map<string, string>()
    configureCloudSyncTestFs(files)

    const project = await ensureCloudProjectLocallySynced(
      remoteProjectId,
      projectDirectory
    )

    expect(project).toMatchObject({
      projectPath: titleProjectPath,
      projectName: expectedProjectName,
      remoteProjectId,
    })
    expect(files.get(`${titleProjectPath}/main.kcl`)).toBe('x = 1')
    expect(
      files.get(`${titleProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`)
    ).toContain(`project_id = "${remoteProjectId}"`)
    expect(await getCloudSyncProjectMetadata(titleProjectPath)).toMatchObject({
      localProjectPath: titleProjectPath,
      projectName: expectedProjectName,
      remoteProjectId,
    })
  })

  it('renames existing ID-based cloud project folders and rekeys metadata', async () => {
    const files = createIdBasedCloudProjectFiles()
    configureCloudSyncTestFs(files)
    await seedIdBasedCloudProjectMetadata()

    const onProjectDirectoriesRenamed = scheduleIdBasedProjectDirectorySync()

    await vi.waitFor(() =>
      expect(onProjectDirectoriesRenamed).toHaveBeenCalled()
    )

    expect(files.get(`${titleProjectPath}/main.kcl`)).toBe('x = 1')
    expect(files.has(`${idProjectPath}/main.kcl`)).toBe(false)
    expect(await getCloudSyncProjectMetadata(idProjectPath)).toBeUndefined()
    expect(await getCloudSyncProjectMetadata(titleProjectPath)).toMatchObject({
      localProjectPath: titleProjectPath,
      projectName: expectedProjectName,
      remoteProjectId,
    })
    expect(await getAllOutboxEntries()).toEqual([])
    expect(onProjectDirectoriesRenamed).toHaveBeenCalledTimes(1)
  })

  it('leaves data and metadata in place when a cloud project directory rename fails', async () => {
    const files = createIdBasedCloudProjectFiles()
    configureCloudSyncTestFs(files, { failRenames: true })
    await seedIdBasedCloudProjectMetadata()

    const onProjectDirectoriesRenamed = scheduleIdBasedProjectDirectorySync()

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(files.get(`${idProjectPath}/main.kcl`)).toBe('x = 1')
    expect(files.has(`${titleProjectPath}/main.kcl`)).toBe(false)
    expect(await getCloudSyncProjectMetadata(idProjectPath)).toMatchObject({
      localProjectPath: idProjectPath,
      projectName: remoteProjectId,
      remoteProjectId,
    })
    expect(await getCloudSyncProjectMetadata(titleProjectPath)).toBeUndefined()
    expect(onProjectDirectoriesRenamed).not.toHaveBeenCalled()
    expect(reportRejection).toHaveBeenCalledWith(expect.any(Error))
  })
})
