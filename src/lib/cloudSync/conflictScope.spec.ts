import 'fake-indexeddb/auto'
import { effect } from '@preact/signals-core'
import {
  cloudSyncStatus,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  getCloudSyncProjectMetadata,
  setCloudSyncProjectScope,
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const baseUrl = 'https://example.test'
const projectDirectory = '/documents/Projects'
const currentProjectPath = `${projectDirectory}/current`
const currentCloudBackedProjectPath = `${projectDirectory}/current-cloud`
const currentPersonalCloudProjectPath =
  '/Users/frank/Library/CloudStorage/Zoo/personal/current'
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
    cloudSyncStatus.value = {
      enabled: false,
      state: 'disabled',
      pendingCount: 0,
    }
  })

  afterEach(async () => {
    setCloudSyncProjectScope(undefined)
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
    cloudSyncStatus.value = {
      enabled: false,
      state: 'disabled',
      pendingCount: 0,
    }
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
    setCloudSyncProjectScope({
      projectPath: currentProjectPath,
      syncable: true,
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

  it('keeps a local-only scoped project outside the cloud library quiet', async () => {
    const files = new Map([
      [
        `${currentPersonalCloudProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        'title = "Current"\n',
      ],
      [`${otherProjectPath}/main.kcl`, 'local = 2\n'],
      [
        `${otherProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
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
    })
    await appendOutboxEntry({
      projectPath: otherProjectPath,
      kind: 'upsert',
      targetPath: `${otherProjectPath}/main.kcl`,
      createdAt: '2026-07-08T12:01:00.000Z',
    })

    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)

      if (url === `${baseUrl}/user/projects` && method === 'GET') {
        return jsonResponse([
          {
            id: otherRemoteProjectId,
            title: 'Other',
            revision: 'rev-3',
            updated_at: '2026-07-08T12:05:00.000Z',
          },
        ])
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
      enabled: false,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })
    cloudSyncStatus.value = {
      enabled: true,
      state: 'conflict',
      pendingCount: 1,
      activeProjectPath: otherProjectPath,
      lastFailure: 'Cloud sync conflict: local and remote both changed.',
      lastFailureAt: '2026-07-08T12:02:00.000Z',
    }
    setCloudSyncProjectScope({
      projectPath: currentPersonalCloudProjectPath,
      syncable: false,
    })
    const syncingProjectPaths: Array<string | undefined> = []
    const dispose = effect(() => {
      const status = cloudSyncStatus.value
      if (status.state === 'syncing') {
        syncingProjectPaths.push(status.activeProjectPath)
      }
    })

    try {
      expect(cloudSyncStatus.value).toMatchObject({
        state: 'idle',
        scopedProjectPath: currentPersonalCloudProjectPath,
        scopedProjectCloudProjectId: undefined,
        activeProjectPath: undefined,
        lastFailure: undefined,
        lastFailureAt: undefined,
      })

      configureCloudSyncEngine({ enabled: true })

      await vi.waitFor(() => {
        expect(cloudSyncStatus.value).toMatchObject({
          state: 'idle',
          pendingCount: 0,
        })
      })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(syncingProjectPaths).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
      await expect(
        getCloudSyncProjectMetadata(otherProjectPath)
      ).resolves.not.toHaveProperty('conflict')
      expect(cloudSyncStatus.value.activeProjectPath).not.toBe(otherProjectPath)
    } finally {
      dispose()
    }
  })

  it('detects the scoped project cloud id from its project settings', async () => {
    const files = new Map([
      [
        `${currentCloudBackedProjectPath}/${PROJECT_SETTINGS_FILE_NAME}`,
        'title = "Current Cloud"\n\n[cloud."dev.zoo.dev"]\nproject_id = "current-cloud-project"\n',
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    configureCloudSyncEngine({
      enabled: false,
      baseUrl,
      environmentName: 'dev.zoo.dev',
      cloudProjectDirectoryPaths: [projectDirectory],
      autoEnrollCloudLibraryProjects: false,
    })

    setCloudSyncProjectScope({
      projectPath: currentCloudBackedProjectPath,
      syncable: true,
    })

    await vi.waitFor(() => {
      expect(cloudSyncStatus.value).toMatchObject({
        scopedProjectPath: currentCloudBackedProjectPath,
        scopedProjectCloudProjectId: 'current-cloud-project',
      })
    })
  })
})
