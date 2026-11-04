import 'fake-indexeddb/auto'
import { posix } from 'node:path'
import fsZds from '@src/lib/fs-zds'
import {
  clearSessionExpiredNotice,
  fetchWithSessionExpiration,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import { getCloudSyncCacheScope } from '@src/lib/cloudSync/account'
import {
  startCloudSyncProject,
  syncCloudSyncProjectNow,
} from '@src/lib/cloudSync'
import {
  cloudSyncRemoteProjects,
  cloudSyncStatus,
  configureCloudSyncEngine,
  configureCloudSyncLocalFileSystem,
  disableCloudSyncEngineForTest,
  withCloudSyncAccount,
} from '@src/lib/cloudSync/engine'
import { getCloudProjectLibraryMaterializationDirectoryPath } from '@src/lib/cloudSync/paths'
import {
  appendOutboxEntry,
  getAllOutboxEntries,
  getAllProjectMetadata,
  putProjectMetadata,
} from '@src/lib/cloudSync/syncDb'
import {
  createCloudSyncTestFs,
  getFetchMethod,
  jsonResponse,
} from '@src/lib/cloudSync/testUtils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const baseUrl = 'https://api.test'
const accountA = getCloudSyncCacheScope('account-a', baseUrl)!
const accountB = getCloudSyncCacheScope('account-b', baseUrl)!

afterEach(async () => {
  await disableCloudSyncEngineForTest()
  configureCloudSyncEngine({ enabled: false, cacheScope: undefined })
  for (const database of await indexedDB.databases()) {
    if (!database.name?.startsWith('zds-opfs-cloud-sync')) continue
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(database.name!)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearSessionExpiredNotice()
})

describe('cloud cache account ownership', () => {
  it('rejects projects cached by another account before enrollment or an explicit upload', async () => {
    const oldPath = `/cloud/.accounts/${accountA}/private-project`
    const currentRoot = `/cloud/.accounts/${accountB}`
    const files = new Map([
      [`${oldPath}/main.kcl`, 'original account contents'],
      [
        `${oldPath}/project.toml`,
        'title = "Private project"\ndefault_file = "main.kcl"\n',
      ],
    ])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory: currentRoot })
    )
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    configureCloudSyncEngine({
      enabled: true,
      cacheScope: accountB,
      token: 'token-b',
      baseUrl,
      cloudProjectDirectoryPaths: [currentRoot],
    })

    await expect(startCloudSyncProject(oldPath)).rejects.toThrow(
      'different cloud account'
    )
    await expect(syncCloudSyncProjectNow(oldPath)).rejects.toThrow(
      'different cloud account'
    )
    expect(await getAllProjectMetadata()).toEqual([])
    expect(await getAllOutboxEntries()).toEqual([])
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) => getFetchMethod(input, init) !== 'GET'
      )
    ).toEqual([])
    expect(files.get(`${oldPath}/main.kcl`)).toBe('original account contents')
  })

  it('does not expire the next account when an aborted old request returns 401', async () => {
    clearSessionExpiredNotice()
    const controller = new AbortController()
    let finish!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          })
      )
    )
    const request = fetchWithSessionExpiration(
      'https://api.test/user/projects',
      { signal: controller.signal }
    )
    controller.abort()
    finish(new Response('{}', { status: 401 }))
    await request
    expect(sessionExpiredNotice.value).toBeUndefined()
  })

  it('uses separate account/environment folders for personal, named, and custom libraries', async () => {
    vi.spyOn(fsZds, 'join').mockImplementation((...parts) =>
      posix.join(...parts)
    )
    expect(getCloudSyncCacheScope('account-a', `${baseUrl}/`)).toBe(accountA)
    expect(getCloudSyncCacheScope('account-a', 'https://other.test')).not.toBe(
      accountA
    )
    expect(getCloudSyncCacheScope(undefined, baseUrl)).toBeUndefined()
    for (const library of [
      { type: 'cloud', path: '/cloud/personal' },
      {
        type: 'cloud',
        path: '/cloud/named',
        source: '/project-libraries/dataset',
      },
      { type: 'cloud', path: '/custom/cloud' },
    ]) {
      const first = await getCloudProjectLibraryMaterializationDirectoryPath({
        ...library,
        cacheScope: accountA,
      })
      const second = await getCloudProjectLibraryMaterializationDirectoryPath({
        ...library,
        cacheScope: accountB,
      })
      expect(first).toBe(`${library.path}/.accounts/${accountA}`)
      expect(second).toBe(`${library.path}/.accounts/${accountB}`)
      expect(first).not.toBe(second)
    }
  })

  it('keeps metadata and pending writes with their owner, including across token refresh', async () => {
    configureCloudSyncEngine({ enabled: false, cacheScope: undefined })
    const legacy = {
      schemaVersion: 1 as const,
      localProjectPath: '/cloud/legacy',
      projectName: 'Legacy',
    }
    await putProjectMetadata(legacy)
    configureCloudSyncEngine({
      enabled: false,
      cacheScope: accountA,
      token: 'token-a',
    })
    expect(await getAllProjectMetadata()).toEqual([])
    const owned = {
      ...legacy,
      localProjectPath: `/cloud/.accounts/${accountA}/owned`,
    }
    await putProjectMetadata(owned)
    await appendOutboxEntry({
      projectPath: owned.localProjectPath,
      kind: 'upsert',
      targetPath: `${owned.localProjectPath}/main.kcl`,
      createdAt: new Date().toISOString(),
    })

    configureCloudSyncEngine({
      enabled: false,
      cacheScope: accountB,
      token: 'token-b',
    })
    expect(await getAllProjectMetadata()).toEqual([])
    expect(await getAllOutboxEntries()).toEqual([])
    configureCloudSyncEngine({
      enabled: false,
      cacheScope: accountA,
      token: 'refreshed-a',
    })
    expect(await getAllProjectMetadata()).toEqual([owned])
    expect(await getAllOutboxEntries()).toHaveLength(1)
    configureCloudSyncEngine({ enabled: false, cacheScope: undefined })
    expect(await getAllProjectMetadata()).toEqual([legacy])
  })

  it('aborts an old index request and never publishes it or uploads its queue as the next account', async () => {
    const pathA = `/cloud/.accounts/${accountA}`
    const pathB = `/cloud/.accounts/${accountB}`
    const files = new Map([[`${pathA}/old/main.kcl`, 'old account data']])
    configureCloudSyncLocalFileSystem(
      createCloudSyncTestFs(files, { projectDirectory: pathA })
    )
    configureCloudSyncEngine({ enabled: false, cacheScope: accountA })
    await putProjectMetadata({
      schemaVersion: 1,
      localProjectPath: `${pathA}/old`,
      projectName: 'old',
      remoteProjectId: 'old-project',
    })
    await appendOutboxEntry({
      projectPath: `${pathA}/old`,
      targetPath: `${pathA}/old/main.kcl`,
      kind: 'upsert',
      createdAt: new Date().toISOString(),
    })
    let finishOld!: (response: Response) => void
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          })
      )
      .mockResolvedValue(
        jsonResponse([{ id: 'new-project', title: 'New account project' }])
      )
    vi.stubGlobal('fetch', fetchMock)
    configureCloudSyncEngine({
      enabled: true,
      cacheScope: accountA,
      token: 'token-a',
      baseUrl,
      cloudProjectDirectoryPaths: [pathA],
      autoEnrollCloudLibraryProjects: false,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const oldSignal = fetchMock.mock.calls[0][1]?.signal
    configureCloudSyncEngine({
      enabled: true,
      cacheScope: accountB,
      token: 'token-b',
      baseUrl,
      cloudProjectDirectoryPaths: [pathB],
    })
    expect(oldSignal?.aborted).toBe(true)
    expect(cloudSyncRemoteProjects.value).toEqual([])
    finishOld(
      jsonResponse([{ id: 'old-project', title: 'Old account project' }])
    )
    await vi.waitFor(() =>
      expect(cloudSyncRemoteProjects.value).toEqual([
        { id: 'new-project', title: 'New account project' },
      ])
    )
    expect(await getAllProjectMetadata()).toEqual([])
    expect(await getAllOutboxEntries()).toEqual([])
    expect(files.get(`${pathA}/old/main.kcl`)).toBe('old account data')
    expect(
      fetchMock.mock.calls.map(([input, init]) => getFetchMethod(input, init))
    ).toEqual(['GET', 'GET'])
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization')
    ).toBe('Bearer token-b')
    await disableCloudSyncEngineForTest()
    configureCloudSyncEngine({ enabled: false, cacheScope: accountA })
    expect(await getAllOutboxEntries()).toHaveLength(1)
  })

  it('does not return an old account operation to a caller after the account changes', async () => {
    configureCloudSyncEngine({ enabled: false, cacheScope: accountA })
    let finish!: () => void
    const operation = withCloudSyncAccount(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      await putProjectMetadata({
        schemaVersion: 1,
        localProjectPath: '/old',
        projectName: 'old',
      })
      return 'old result'
    })()
    const rejected = expect(operation).rejects.toMatchObject({
      name: 'AbortError',
    })
    configureCloudSyncEngine({ enabled: false, cacheScope: accountB })
    finish()
    await rejected
    expect(await getAllProjectMetadata()).toEqual([])
    expect(cloudSyncStatus.value.enabled).toBe(false)
    configureCloudSyncEngine({ enabled: false, cacheScope: accountA })
    expect(await getAllProjectMetadata()).toHaveLength(1)
  })
})
