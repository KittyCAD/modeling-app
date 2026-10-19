import 'fake-indexeddb/auto'
import {
  configureCloudSyncEngine,
  disableCloudSyncEngineForTest,
  installCloudSyncFileSystemObserver,
  setCloudSyncOpenedProject,
} from '@src/lib/cloudSync'
import * as engine from '@src/lib/cloudSync/engine'
import * as syncDb from '@src/lib/cloudSync/syncDb'
import {
  createCloudSyncTestFs,
  deleteCloudSyncTestDatabase,
} from '@src/lib/cloudSync/testUtils'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
} from '@src/lib/projectLibraries'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const localProject = '/local/bracket'
const cloudDirectory = '/cloud/personal'
const cloudProject = `${cloudDirectory}/bracket`
const files = new Map<string, string>()
const fs = createCloudSyncTestFs(files, { projectDirectory: cloudDirectory })
const encoder = new TextEncoder()
const config = {
  enabled: true,
  environmentName: 'dev.zoo.dev',
  cloudProjectDirectoryPaths: [cloudDirectory],
  autoEnrollCloudLibraryProjects: true,
}

beforeAll(() => installCloudSyncFileSystemObserver(fs))
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await deleteCloudSyncTestDatabase()
  files.clear()
  await fs.mkdir(localProject, { recursive: true })
  await fs.mkdir(cloudProject, { recursive: true })
  setCloudSyncOpenedProject({
    projectPath: localProject,
    libraryPath: '/local',
    libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
  })
  configureCloudSyncEngine(config)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await disableCloudSyncEngineForTest()
  setCloudSyncOpenedProject(undefined)
  vi.useRealTimers()
  await deleteCloudSyncTestDatabase()
})

describe('cloud sync filesystem observer eligibility', () => {
  it('bypasses notifications and sync IO for every local-only mutation', async () => {
    const writeNotification = vi.spyOn(
      engine,
      'notifyCloudSyncWriteLikeMutation'
    )
    const removeNotification = vi.spyOn(engine, 'notifyCloudSyncRemoveMutation')
    const renameNotification = vi.spyOn(engine, 'notifyCloudSyncRenameMutation')
    const openDatabase = vi.spyOn(indexedDB, 'open')
    const readFile = vi.spyOn(fs, 'readFile')
    const stat = vi.spyOn(fs, 'stat')
    const status = engine.cloudSyncStatus.value

    await fs.writeFile(`${localProject}/main.kcl`, encoder.encode('width = 1'))
    await fs.mkdir(`${localProject}/parts`, { recursive: true })
    await fs.cp(`${localProject}/main.kcl`, `${localProject}/copy.kcl`)
    await fs.rename(`${localProject}/main.kcl`, `${localProject}/renamed.kcl`)
    await fs.rm(`${localProject}/renamed.kcl`, { force: true })

    expect(files.has(`${localProject}/renamed.kcl`)).toBe(false)
    expect(writeNotification).not.toHaveBeenCalled()
    expect(removeNotification).not.toHaveBeenCalled()
    expect(renameNotification).not.toHaveBeenCalled()
    expect(openDatabase).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
    expect(stat).not.toHaveBeenCalled()
    expect(engine.cloudSyncStatus.value).toBe(status)
  })

  it('still records background cloud writes while a local-only project is open', async () => {
    await fs.writeFile(
      `${cloudProject}/project.toml`,
      encoder.encode('title = "Bracket"\n')
    )
    const previousGeneration = syncDb.getOutboxMutationGeneration(
      await syncDb.getAllOutboxEntries()
    )
    await fs.writeFile(`${cloudProject}/main.kcl`, encoder.encode('width = 2'))

    const entries = await syncDb.getAllOutboxEntries()
    expect(syncDb.getOutboxMutationGeneration(entries)).toBeGreaterThan(
      previousGeneration
    )
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectPath: cloudProject,
          kind: 'upsert',
        }),
      ])
    )
    expect(engine.cloudSyncStatus.value.pendingCount).toBe(0)
  })

  it('bypasses installed observers after cloud sync is disabled', async () => {
    configureCloudSyncEngine({ enabled: false })
    const writeNotification = vi.spyOn(
      engine,
      'notifyCloudSyncWriteLikeMutation'
    )
    const removeNotification = vi.spyOn(engine, 'notifyCloudSyncRemoveMutation')
    const renameNotification = vi.spyOn(engine, 'notifyCloudSyncRenameMutation')
    const openDatabase = vi.spyOn(indexedDB, 'open')
    await fs.writeFile(`${cloudProject}/main.kcl`, encoder.encode('width = 1'))
    await fs.rename(`${cloudProject}/main.kcl`, `${cloudProject}/other.kcl`)
    await fs.rm(`${cloudProject}/other.kcl`, { force: true })
    expect(writeNotification).not.toHaveBeenCalled()
    expect(removeNotification).not.toHaveBeenCalled()
    expect(renameNotification).not.toHaveBeenCalled()
    expect(openDatabase).not.toHaveBeenCalled()
  })

  it('skips sync IO for direct mutation notifications while disabled', async () => {
    configureCloudSyncEngine({ enabled: false })
    const openDatabase = vi.spyOn(indexedDB, 'open')
    await engine.notifyCloudSyncWriteLikeMutation(`${cloudProject}/main.kcl`)
    await engine.notifyCloudSyncRemoveMutation(`${cloudProject}/main.kcl`)
    await engine.notifyCloudSyncRenameMutation(
      `${cloudProject}/main.kcl`,
      `${cloudProject}/other.kcl`
    )
    expect(openDatabase).not.toHaveBeenCalled()
  })

  it('checks current library policy when files move into or out of cloud storage', async () => {
    await fs.writeFile(`${localProject}/main.kcl`, encoder.encode('width = 1'))
    await fs.rename(`${localProject}/main.kcl`, `${cloudProject}/main.kcl`)
    expect(await syncDb.getAllOutboxEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetPath: `${cloudProject}/main.kcl` }),
      ])
    )

    const renameNotification = vi.spyOn(engine, 'notifyCloudSyncRenameMutation')
    await fs.rename(`${cloudProject}/main.kcl`, `${localProject}/main.kcl`)
    expect(renameNotification).not.toHaveBeenCalled()

    configureCloudSyncEngine({
      cloudProjectDirectoryPaths: ['/cloud/team'],
      enabled: true,
    })
    const writeNotification = vi.spyOn(
      engine,
      'notifyCloudSyncWriteLikeMutation'
    )
    await fs.writeFile(`${cloudProject}/main.kcl`, encoder.encode('width = 2'))
    expect(writeNotification).not.toHaveBeenCalled()
  })

  it('observes an explicitly opened cloud library outside the configured paths', async () => {
    setCloudSyncOpenedProject({
      projectPath: '/team/bracket',
      libraryPath: '/team',
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    })
    const writeNotification = vi
      .spyOn(engine, 'notifyCloudSyncWriteLikeMutation')
      .mockResolvedValue()
    await fs.writeFile('/team/bracket/main.kcl', encoder.encode('width = 1'))
    expect(writeNotification).toHaveBeenCalledWith('/team/bracket/main.kcl')
  })

  it('does not scan the outbox on local-only project changes or policy refreshes', () => {
    const getOutbox = vi.spyOn(syncDb, 'getAllOutboxEntries')
    setCloudSyncOpenedProject({
      projectPath: '/local/another',
      libraryPath: '/local',
      libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
    })
    configureCloudSyncEngine(config)
    expect(getOutbox).not.toHaveBeenCalled()
    expect(engine.cloudSyncStatus.value.pendingCount).toBe(0)
  })

  it('does not scan the outbox for project changes with sync disabled', () => {
    configureCloudSyncEngine({ enabled: false })
    const getOutbox = vi.spyOn(syncDb, 'getAllOutboxEntries')
    setCloudSyncOpenedProject({
      projectPath: cloudProject,
      libraryPath: cloudDirectory,
      libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
    })
    expect(getOutbox).not.toHaveBeenCalled()
  })
})
