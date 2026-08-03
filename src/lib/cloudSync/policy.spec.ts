import 'fake-indexeddb/auto'
import {
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  notifyCloudSyncWriteLikeMutation,
} from '@src/lib/cloudSync'
import {
  getAllOutboxEntries,
  getProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import {
  createCloudSyncTestFs,
  deleteCloudSyncTestDatabase,
} from '@src/lib/cloudSync/testUtils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const baseUrl = 'https://example.test'
const projectDirectory = '/documents/Projects'

describe('cloud sync file policy', () => {
  beforeEach(async () => {
    await deleteCloudSyncTestDatabase()
  })

  afterEach(async () => {
    configureCloudSyncEngine({ enabled: false })
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
})
