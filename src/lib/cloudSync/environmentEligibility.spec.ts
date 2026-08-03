import 'fake-indexeddb/auto'
import {
  cloudSyncStatus,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
} from '@src/lib/cloudSync'
import {
  deleteCloudSyncTestDatabase,
  createCloudSyncTestFs,
  getFetchMethod,
  getFetchUrl,
  jsonResponse,
} from '@src/lib/cloudSync/testUtils'
import {
  getAllOutboxEntries,
  getProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const baseUrl = 'https://api.prod.test'
const projectDirectory = '/documents/Projects'
const currentEnvironmentName = 'prod.zoo.dev'
const otherEnvironmentName = 'dev.zoo.dev'

describe('cloud sync environment eligibility', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    await deleteCloudSyncTestDatabase()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    cloudSyncStatus.value = {
      enabled: false,
      state: 'disabled',
      pendingCount: 0,
    }
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
    cloudSyncStatus.value = {
      enabled: false,
      state: 'disabled',
      pendingCount: 0,
    }
  })

  it('skips directory scan candidates bound to another environment', async () => {
    const projectPath = `${projectDirectory}/mismatched`
    const files = new Map<string, string>([
      [`${projectPath}/main.kcl`, 'part = 1\n'],
      [
        `${projectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        `title = "Mismatched"\n\n[cloud."${otherEnvironmentName}"]\nproject_id = "dev-project-123"\n`,
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
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

    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: currentEnvironmentName,
      projectDirectoryPath: projectDirectory,
      syncExistingLocalProjects: true,
    })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    await vi.waitFor(() => {
      expect(cloudSyncStatus.value.state).toBe('idle')
      expect(cloudSyncStatus.value.pendingCount).toBe(0)
    })

    expect(
      fetchMock.mock.calls.map(([input, init]) => {
        return `${getFetchMethod(input, init)} ${getFetchUrl(input)}`
      })
    ).toEqual([`GET ${baseUrl}/user/projects`])
    expect(await getProjectMetadata(projectPath)).toBeUndefined()
    expect(await getAllOutboxEntries()).toEqual([])
  })
})
