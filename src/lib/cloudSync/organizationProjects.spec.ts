import 'fake-indexeddb/auto'
import {
  cloudSyncRemoteProjects,
  cloudSyncStatus,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
} from '@src/lib/cloudSync'
import {
  getProjectMetadata,
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
const organizationProjectId = 'organization-project-123'
const organizationProjectPath = `${projectDirectory}/organization-project`

describe('cloud sync organization projects', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const files = new Map<string, string>()

  beforeEach(async () => {
    configureCloudSyncEngine({ enabled: false })
    await deleteCloudSyncTestDatabase()
    files.clear()
    files.set(`${organizationProjectPath}/main.kcl`, 'part = 1\n')
    files.set(
      `${organizationProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
      `title = "Organization Project"\n\n[cloud."dev.zoo.dev"]\nproject_id = "${organizationProjectId}"\n`
    )
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: organizationProjectPath,
      projectName: 'organization-project',
      remoteProjectId: organizationProjectId,
      remoteRevision: 'org-rev-1',
    })

    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)
      if (url === `${baseUrl}/user/projects` && method === 'GET') {
        return jsonResponse([
          {
            id: 'personal-project-123',
            title: 'Personal Project',
            revision: 'personal-rev-1',
            access: {
              scope: 'personal',
              can_edit: true,
              can_delete: true,
            },
          },
          {
            id: organizationProjectId,
            title: 'Organization Project',
            revision: 'org-rev-1',
            access: {
              scope: 'organization',
              organization_id: 'organization-123',
              can_edit: false,
              can_delete: false,
            },
          },
        ])
      }

      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    cloudSyncRemoteProjects.value = []
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
    cloudSyncRemoteProjects.value = []
  })

  it('filters organization projects without treating them as remotely deleted', async () => {
    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    await vi.waitFor(() => {
      expect(cloudSyncStatus.value.state).toBe('idle')
    })

    expect(cloudSyncRemoteProjects.value).toEqual([
      expect.objectContaining({
        id: 'personal-project-123',
        access: expect.objectContaining({ scope: 'personal' }),
      }),
    ])
    await expect(
      getProjectMetadata(organizationProjectPath)
    ).resolves.toMatchObject({
      remoteProjectId: organizationProjectId,
      remoteRevision: 'org-rev-1',
    })
    expect(
      files.get(`${organizationProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`)
    ).toContain(`project_id = "${organizationProjectId}"`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
