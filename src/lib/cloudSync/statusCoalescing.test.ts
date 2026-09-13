import 'fake-indexeddb/auto'
import { effect } from '@preact/signals-core'
import {
  cloudSyncStatus,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
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
import type { ProjectArchiveFile } from '@src/lib/cloudSync/types'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const baseUrl = 'https://example.test'
const projectDirectory = '/documents/Projects'
const environmentName = 'dev.zoo.dev'
const encoder = new TextEncoder()

type TestProject = {
  path: string
  name: string
  title: string
  description: string
  categoryIds: string[]
  remoteProjectId: string
  remoteRevision: string
  mainKcl: string
}

const projects: TestProject[] = [
  {
    path: `${projectDirectory}/one`,
    name: 'one',
    title: 'One',
    description: 'First synced project',
    categoryIds: ['fixture-category-one'],
    remoteProjectId: 'remote-one',
    remoteRevision: 'rev-1',
    mainKcl: 'one = 1\n',
  },
  {
    path: `${projectDirectory}/two`,
    name: 'two',
    title: 'Two',
    description: 'Second synced project',
    categoryIds: ['fixture-category-two'],
    remoteProjectId: 'remote-two',
    remoteRevision: 'rev-2',
    mainKcl: 'two = 2\n',
  },
]

const fetchMock = vi.fn<typeof fetch>()

function projectToml(project: TestProject) {
  return `title = "${project.title}"\n\n[cloud."${environmentName}"]\nproject_id = "${project.remoteProjectId}"\n`
}

function projectFiles(project: TestProject): ProjectArchiveFile[] {
  return [
    {
      relativePath: 'main.kcl',
      data: encoder.encode(project.mainKcl),
    },
    {
      relativePath: PROJECT_SETTINGS_FILE_NAME,
      data: encoder.encode(projectToml(project)),
    },
  ]
}

function remoteProjectResponse(project: TestProject) {
  return {
    id: project.remoteProjectId,
    title: project.title,
    description: project.description,
    category_ids: project.categoryIds,
    revision: project.remoteRevision,
  }
}

async function seedSyncedProjectMetadata(project: TestProject) {
  await putProjectMetadata({
    schemaVersion: 1,
    localProjectPath: project.path,
    projectName: project.name,
    remoteProjectId: project.remoteProjectId,
    remoteRevision: project.remoteRevision,
    baseManifest: await projectManifestFromFiles(projectFiles(project)),
  })
  await appendOutboxEntry({
    projectPath: project.path,
    kind: 'upsert',
    targetPath: `${project.path}/main.kcl`,
    createdAt: '2026-07-30T12:00:00.000Z',
  })
}

describe('cloud sync status coalescing', () => {
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
    configureCloudSyncEngine({ enabled: false })
    vi.unstubAllGlobals()
    await deleteCloudSyncTestDatabase()
    cloudSyncStatus.value = {
      enabled: false,
      state: 'disabled',
      pendingCount: 0,
    }
  })

  it('does not publish per-project lastSyncedAt updates while a sync run is active', async () => {
    const files = new Map<string, string>()
    for (const project of projects) {
      files.set(`${project.path}/main.kcl`, project.mainKcl)
      files.set(
        `${project.path}/${PROJECT_SETTINGS_FILE_NAME}`,
        projectToml(project)
      )
      await seedSyncedProjectMetadata(project)
    }

    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory })
    )
    fetchMock.mockImplementation(async (input, init) => {
      const url = getFetchUrl(input)
      const method = getFetchMethod(input, init)
      if (url === `${baseUrl}/user/projects` && method === 'GET') {
        return jsonResponse(projects.map(remoteProjectResponse))
      }

      const project = projects.find(
        (candidate) =>
          url === `${baseUrl}/user/projects/${candidate.remoteProjectId}` &&
          method === 'GET'
      )
      if (project) {
        return jsonResponse(remoteProjectResponse(project))
      }

      return jsonResponse(
        { message: `Unexpected fetch: ${method} ${url}` },
        500
      )
    })

    const syncingSyncedAtUpdates: string[] = []
    const dispose = effect(() => {
      const status = cloudSyncStatus.value
      if (status.state === 'syncing' && status.lastSyncedAt) {
        syncingSyncedAtUpdates.push(status.lastSyncedAt)
      }
    })

    try {
      configureCloudSyncEngine({
        enabled: true,
        baseUrl,
        environmentName,
        cloudProjectDirectoryPaths: [projectDirectory],
        autoEnrollCloudLibraryProjects: false,
      })

      await vi.waitFor(
        () => {
          expect(cloudSyncStatus.value.state).toBe('idle')
          expect(cloudSyncStatus.value.pendingCount).toBe(0)
          expect(cloudSyncStatus.value.lastSyncedAt).toBeDefined()
        },
        { timeout: 5_000 }
      )

      expect(syncingSyncedAtUpdates).toEqual([])
    } finally {
      dispose()
    }
  })
})
