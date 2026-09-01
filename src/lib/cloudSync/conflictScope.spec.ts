import 'fake-indexeddb/auto'
import {
  cloudSyncStatus,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  disableCloudSyncEngineForTest,
  getCloudSyncProjectMetadata,
  setCloudSyncOpenedProject,
} from '@src/lib/cloudSync'
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
import { CLOUD_PROJECT_LIBRARY_TYPE } from '@src/lib/projectLibraries'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const baseUrl = 'https://example.test'
const projectDirectory = '/documents/Projects'
const currentProjectPath = `${projectDirectory}/current`
const otherProjectPath = `${projectDirectory}/other`
const otherConflictProjectPath = `${projectDirectory}/other (cloud conflict)`
const otherRemoteProjectId = 'other-remote-project'
const otherRemoteProjectUrl = `${baseUrl}/user/projects/${otherRemoteProjectId}`
const otherRemoteDownloadUrl = `${otherRemoteProjectUrl}/download?format=zip`

const fetchMock = vi.fn<typeof fetch>()

describe('cloud sync conflict scoping', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    setCloudSyncOpenedProject(undefined)
    await disableCloudSyncEngineForTest()
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
  })

  it('does not surface existing unrelated conflicts after entering a scoped project', async () => {
    const files = new Map([
      [
        `${currentProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        'title = "Current"\n',
      ],
      [`${otherProjectPath}/main.kcl`, 'local = 2\n'],
      [
        `${otherProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        'title = "Other"\n',
      ],
      [`${otherConflictProjectPath}/main.kcl`, 'cloud = 2\n'],
      [
        `${otherConflictProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        'title = "Other"\n',
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: otherProjectPath,
      projectName: 'other',
      remoteProjectId: otherRemoteProjectId,
      remoteRevision: 'rev-1',
      baseManifest: { files: {} },
      conflict: {
        conflictProjectPath: otherConflictProjectPath,
        createdAt: '2026-07-08T12:00:00.000Z',
        remoteRevision: 'rev-2',
      },
    })
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: otherConflictProjectPath,
      projectName: 'other (cloud conflict)',
      remoteProjectId: otherRemoteProjectId,
      remoteRevision: 'rev-2',
      syncExcluded: {
        reason: 'conflict-copy',
        sourceProjectPath: otherProjectPath,
        remoteProjectId: otherRemoteProjectId,
        createdAt: '2026-07-08T12:00:00.000Z',
      },
    })
    await appendOutboxEntry({
      projectPath: otherProjectPath,
      kind: 'upsert',
      targetPath: `${otherProjectPath}/main.kcl`,
      createdAt: '2026-07-08T12:01:00.000Z',
    })

    let resolveRemoteIndexStarted!: () => void
    const remoteIndexStarted = new Promise<void>((resolve) => {
      resolveRemoteIndexStarted = resolve
    })
    let finishRemoteIndex!: () => void
    const remoteIndexResponse = new Promise<Response>((resolve) => {
      finishRemoteIndex = () => {
        resolve(
          jsonResponse([
            {
              id: otherRemoteProjectId,
              title: 'Other',
              revision: 'rev-3',
              updated_at: '2026-07-08T12:05:00.000Z',
            },
          ])
        )
      }
    })
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)

      if (url === `${baseUrl}/user/projects` && method === 'GET') {
        resolveRemoteIndexStarted()
        return remoteIndexResponse
      }

      if (url === otherRemoteProjectUrl && method === 'GET') {
        return jsonResponse({
          id: otherRemoteProjectId,
          title: 'Other',
          revision: 'rev-3',
          updated_at: '2026-07-08T12:05:00.000Z',
        })
      }

      if (url === otherRemoteDownloadUrl && method === 'GET') {
        return jsonResponse({
          files: [
            { relativePath: 'main.kcl', contents: 'remote = 3\n' },
            {
              relativePath: PROJECT_SETTINGS_FILE_NAME,
              contents: 'title = "Other"\n',
            },
          ],
        })
      }

      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })

    configureCloudSyncEngine({
      enabled: true,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })
    await remoteIndexStarted
    setCloudSyncOpenedProject({
      projectPath: currentProjectPath,
      libraryPath: projectDirectory,
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    })
    finishRemoteIndex()

    await vi.waitFor(async () => {
      await expect(
        getCloudSyncProjectMetadata(otherProjectPath)
      ).resolves.toMatchObject({
        conflict: {
          remoteRevision: 'rev-3',
        },
      })
    })
    expect(cloudSyncStatus.value).not.toMatchObject({
      state: 'conflict',
      activeProjectPath: otherProjectPath,
    })
    expect(cloudSyncStatus.value.activeProjectPath).not.toBe(otherProjectPath)
  })
})
