import type * as ArchiveModule from '@src/lib/fs-zds/cloud/archive'
import { parseProjectArchive } from '@src/lib/fs-zds/cloud/archive'
import { posix } from '@chainner/node-path'
import { createFileOperationsServices } from '@src/registry/extensions/fileOperations'
import * as api from '@src/lib/fs-zds/cloud/api'
import nodefs from '@src/lib/fs-zds/nodefs'
import { publishCurrentProject } from '@src/registry/extensions/fileOperations/publication'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds/cloud/api', () => ({
  getRemoteProject: vi.fn(),
  downloadRemoteProjectArchive: vi.fn(),
  updateRemoteProject: vi.fn(),
  createRemoteProject: vi.fn(),
  deleteRemoteProject: vi.fn(),
  listRemoteProjects: vi.fn(),
  getRemoteProjectThumbnailUrl: vi.fn(),
  CloudApiError: class extends Error {
    status = 404
  },
}))
vi.mock('@src/registry/extensions/fileOperations/publication', () => ({
  publishCurrentProject: vi.fn(),
}))
vi.mock('@src/lib/fs-zds/cloud/archive', async (original) => ({
  ...(await original<typeof ArchiveModule>()),
  parseProjectArchive: vi.fn(async () => [
    { relativePath: 'main.kcl', data: new TextEncoder().encode('original') },
    {
      relativePath: 'project.toml',
      data: new TextEncoder().encode('[project]\ntitle = "Test"'),
    },
  ]),
}))

const remote = { id: 'one', revision: '1', description: '', category_ids: [] }
const runtimes: ReturnType<typeof createFileOperationsServices>[] = []
beforeEach(() => {
  vi.mocked(api.listRemoteProjects).mockResolvedValue([remote])
  vi.mocked(api.getRemoteProjectThumbnailUrl).mockResolvedValue(
    'data:image/png;base64,dGh1bWI='
  )
  vi.mocked(api.getRemoteProject).mockResolvedValue(remote)
  vi.mocked(api.updateRemoteProject).mockResolvedValue({
    ...remote,
    revision: '2',
  })
  vi.mocked(api.downloadRemoteProjectArchive).mockResolvedValue(
    new ArrayBuffer(0)
  )
})
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()))
  vi.clearAllMocks()
})
const setup = (accountId?: () => string) => {
  const diskWrite = vi.fn()
  const services = createFileOperationsServices(
    { ...nodefs.impl, ...posix, writeFile: diskWrite },
    () => ({ enabled: true, accountId: accountId?.() })
  )
  runtimes.push(services)
  return {
    storage: { ...services.cloud, operations: services.operations },
    diskWrite,
  }
}

describe('memory cloud storage', () => {
  it('keeps all content off disk and resolves writes after cloud acknowledgement', async () => {
    const { storage, diskWrite } = setup()
    const root = await storage.openProject('one')
    const gate = Promise.withResolvers<typeof remote>()
    vi.mocked(api.updateRemoteProject).mockReturnValueOnce(gate.promise)
    const write = storage.operations.writeFile(
      posix.join(root, 'main.kcl'),
      'changed'
    )
    await vi.waitFor(() =>
      expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    )
    expect(storage.saves.value.get('one')?.state).toBe('saving')
    expect(
      new TextDecoder().decode(
        await storage.operations.readFile(posix.join(root, 'main.kcl'))
      )
    ).toBe('changed')
    gate.resolve({ ...remote, revision: '2' })
    await write
    expect(storage.saves.value.get('one')?.state).toBe('saved')
    expect(diskWrite).not.toHaveBeenCalled()
    expect(api.updateRemoteProject).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: '1' })
    )
  })

  it('retains failed edits in memory and retries with the acknowledged revision', async () => {
    const { storage } = setup()
    const root = await storage.openProject('one')
    vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
      new Error('Conflict')
    )
    await expect(
      storage.operations.writeFile(posix.join(root, 'main.kcl'), 'unsaved')
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Conflict' }),
    })
    expect(storage.saves.value.get('one')?.state).toBe('failed')
    expect(
      new TextDecoder().decode(
        await storage.operations.readFile(posix.join(root, 'main.kcl'))
      )
    ).toBe('unsaved')
    await storage.retry('one')
    expect(api.updateRemoteProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: '1' })
    )
  })

  it('commits a bulk mutation once and sends exact deletion intent', async () => {
    const { storage } = setup()
    const root = await storage.openProject('one')
    await storage.batch(root, async (operations) => {
      await operations.writeFile(
        posix.join(root, 'new.bin'),
        new Uint8Array([0, 255])
      )
      await operations.remove(posix.join(root, 'main.kcl'))
    })
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    expect(api.updateRemoteProject).toHaveBeenCalledWith(
      expect.objectContaining({ deletedPaths: ['main.kcl'] })
    )
  })

  it('serializes saves against the latest acknowledged revision', async () => {
    const { storage } = setup()
    const root = await storage.openProject('one')
    await Promise.all([
      storage.operations.writeFile(posix.join(root, 'main.kcl'), 'first'),
      storage.operations.writeFile(posix.join(root, 'main.kcl'), 'second'),
    ])
    expect(
      vi
        .mocked(api.updateRemoteProject)
        .mock.calls.map(([input]) => input.expectedRevision)
    ).toEqual(['1', '2'])
  })
  it('does not expose a project response received after switching accounts', async () => {
    let accountId = 'first'
    const { storage } = setup(() => accountId)
    const gate = Promise.withResolvers<typeof remote>()
    vi.mocked(api.getRemoteProject).mockReturnValueOnce(gate.promise)
    const opening = storage.openProject('one')
    await vi.waitFor(() => expect(api.getRemoteProject).toHaveBeenCalledOnce())
    accountId = 'second'
    gate.resolve(remote)
    await expect(opening).rejects.toThrow('Cloud account changed')
    expect(await storage.operations.exists(storage.pathFor('one'))).toBe(false)
    expect(storage.projects.value).toEqual([])
  })

  it('rejects archive traversal before hydrating any files', async () => {
    const { storage } = setup()
    vi.mocked(parseProjectArchive).mockResolvedValueOnce([
      { relativePath: 'main.kcl', data: new Uint8Array([1]) },
      { relativePath: '../outside.kcl', data: new Uint8Array([2]) },
    ])
    await expect(storage.openProject('one')).rejects.toThrow(
      'outside its project'
    )
    expect(await storage.operations.exists(storage.pathFor('one'))).toBe(false)
  })
  it('moves a file with one save and does not retry filesystem work after a rejected acknowledgement', async () => {
    const { storage } = setup()
    const root = await storage.openProject('one')
    const source = posix.join(root, 'main.kcl')
    const destination = posix.join(root, 'nested', 'renamed.kcl')
    vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
      new Error('Revision conflict')
    )
    await expect(storage.operations.move(source, destination)).rejects.toThrow(
      'Revision conflict'
    )
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    expect(api.updateRemoteProject).toHaveBeenCalledWith(
      expect.objectContaining({ deletedPaths: ['main.kcl'] })
    )
    expect(await storage.operations.exists(source)).toBe(false)
    expect(
      new TextDecoder().decode(await storage.operations.readFile(destination))
    ).toBe('original')
    expect(storage.saves.value.get('one')?.state).toBe('failed')
  })

  it('publishes a serialized memory snapshot without deadlocking a queued edit', async () => {
    const { storage } = setup()
    const root = await storage.openProject('one')
    const started = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<undefined>()
    vi.mocked(publishCurrentProject).mockImplementationOnce(async (args) => {
      expect(args.expectedRevision).toBe('1')
      expect(args.deletedPaths).toEqual([])
      started.resolve(undefined)
      await gate.promise
      expect(await args.fileOperations.readDirectory(root)).toEqual([
        'main.kcl',
        'project.toml',
      ])
      expect(
        new TextDecoder().decode(
          await args.fileOperations.readFile(posix.join(root, 'main.kcl'))
        )
      ).toBe('original')
      return { remoteProjectId: 'one' }
    })
    const publication = storage.publishCurrentProject({
      fileOperations: storage.operations,
      token: 'token',
      remoteProjectId: 'one',
      project: undefined,
      currentFilePath: posix.join(root, 'main.kcl'),
      currentFileContents: 'original',
      wasmInstance: {} as ModuleType,
      submission: { title: 'Published', description: '', categoryIds: [] },
    })
    await started.promise
    const write = storage.operations.writeFile(
      posix.join(root, 'main.kcl'),
      'after publication'
    )
    await vi.waitFor(() => expect(storage.pending()).toBe(2))
    vi.mocked(api.getRemoteProject).mockResolvedValueOnce({
      ...remote,
      revision: '3',
    })
    gate.resolve(undefined)
    await Promise.all([publication, write])
    expect(api.updateRemoteProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: '3' })
    )
  })

  it('loads thumbnails only for visible cards and shares requests between watchers', async () => {
    const { storage, diskWrite } = setup()
    await storage.listProjects()
    expect(api.getRemoteProjectThumbnailUrl).not.toHaveBeenCalled()
    const gate = Promise.withResolvers<string>()
    vi.mocked(api.getRemoteProjectThumbnailUrl).mockReturnValueOnce(
      gate.promise
    )
    const stopFirst = storage.watchThumbnail('one')
    const stopSecond = storage.watchThumbnail('one')
    expect(api.getRemoteProjectThumbnailUrl).toHaveBeenCalledOnce()
    stopFirst()
    gate.resolve('data:image/png;base64,Zmlyc3Q=')
    await vi.waitFor(() =>
      expect(storage.thumbnails.value.get('one')).toBe(
        'data:image/png;base64,Zmlyc3Q='
      )
    )
    stopSecond()
    const stopThird = storage.watchThumbnail('one')
    expect(api.getRemoteProjectThumbnailUrl).toHaveBeenCalledOnce()
    stopThird()
    expect(diskWrite).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'does not retry a missing thumbnail on scroll (completed offscreen: %s)',
    async (offscreen) => {
      const { storage } = setup()
      await storage.listProjects()
      // The API turns a thumbnail 404 into undefined.
      const gate = Promise.withResolvers<string | undefined>()
      vi.mocked(api.getRemoteProjectThumbnailUrl).mockReturnValueOnce(
        gate.promise
      )
      const stop = storage.watchThumbnail('one')
      if (offscreen) stop()
      gate.resolve(undefined)
      await gate.promise
      await Promise.resolve()
      await Promise.resolve()
      stop()
      await storage.listProjects()
      const stopAgain = storage.watchThumbnail('one')
      expect(api.getRemoteProjectThumbnailUrl).toHaveBeenCalledOnce()
      expect(storage.thumbnails.value.has('one')).toBe(false)

      vi.mocked(api.listRemoteProjects).mockResolvedValueOnce([
        { ...remote, revision: '2' },
      ])
      await storage.listProjects()
      await vi.waitFor(() =>
        expect(storage.thumbnails.value.get('one')).toBe(
          'data:image/png;base64,dGh1bWI='
        )
      )
      expect(api.getRemoteProjectThumbnailUrl).toHaveBeenCalledTimes(2)
      stopAgain()
    }
  )

  it('refreshes a visible thumbnail when project metadata changes and ignores an older result', async () => {
    const { storage } = setup()
    await storage.listProjects()
    const old = Promise.withResolvers<string>()
    vi.mocked(api.getRemoteProjectThumbnailUrl).mockReturnValueOnce(old.promise)
    const stop = storage.watchThumbnail('one')
    vi.mocked(api.listRemoteProjects).mockResolvedValueOnce([
      { ...remote, revision: '2' },
    ])
    await storage.listProjects()
    await vi.waitFor(() =>
      expect(storage.thumbnails.value.get('one')).toBe(
        'data:image/png;base64,dGh1bWI='
      )
    )
    old.resolve('old-thumbnail')
    await old.promise
    await Promise.resolve()
    expect(storage.thumbnails.value.get('one')).toBe(
      'data:image/png;base64,dGh1bWI='
    )
    expect(api.getRemoteProjectThumbnailUrl).toHaveBeenCalledTimes(2)
    stop()
  })

  it('does not publish thumbnail results for an account that has signed out', async () => {
    let accountId = 'first'
    const { storage } = setup(() => accountId)
    await storage.listProjects()
    const gate = Promise.withResolvers<string>()
    vi.mocked(api.getRemoteProjectThumbnailUrl).mockReturnValueOnce(
      gate.promise
    )
    const stop = storage.watchThumbnail('one')
    accountId = 'second'
    gate.resolve('private-thumbnail')
    await gate.promise
    await Promise.resolve()
    expect(storage.thumbnails.value.size).toBe(0)
    stop()
  })
  it('refreshes additions, binary contents, and deletions without uploading or touching disk', async () => {
    const { storage, diskWrite } = setup()
    const root = await storage.openProject('one')
    const changes = vi.fn()
    storage.subscribe(changes)
    vi.mocked(api.getRemoteProject).mockResolvedValue({
      ...remote,
      revision: '3',
    })
    vi.mocked(parseProjectArchive).mockResolvedValueOnce([
      { relativePath: 'nested/new.bin', data: new Uint8Array([0, 255]) },
      {
        relativePath: 'project.toml',
        data: new TextEncoder().encode('updated'),
      },
    ])
    await storage.refreshProject('one')
    expect(await storage.operations.exists(posix.join(root, 'main.kcl'))).toBe(
      false
    )
    expect(
      await storage.operations.readFile(posix.join(root, 'nested/new.bin'))
    ).toEqual(new Uint8Array([0, 255]))
    expect(changes).toHaveBeenCalledWith(
      expect.arrayContaining([
        { path: posix.join(root, 'main.kcl'), eventType: 'unlink' },
        { path: posix.join(root, 'nested/new.bin'), eventType: 'add' },
      ])
    )
    expect(api.updateRemoteProject).not.toHaveBeenCalled()
    expect(diskWrite).not.toHaveBeenCalled()
    await storage.operations.writeFile(posix.join(root, 'project.toml'), 'next')
    expect(api.updateRemoteProject).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: '3' })
    )
  })

  it('preserves failed local edits rather than refreshing over them', async () => {
    const { storage } = setup()
    const root = await storage.openProject('one')
    vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
      new Error('Conflict')
    )
    await expect(
      storage.operations.writeFile(posix.join(root, 'main.kcl'), 'unsaved')
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Conflict' }),
    })
    vi.mocked(api.downloadRemoteProjectArchive).mockClear()
    await expect(storage.refreshProject('one')).rejects.toThrow(
      'preserve unsaved changes'
    )
    expect(
      new TextDecoder().decode(
        await storage.operations.readFile(posix.join(root, 'main.kcl'))
      )
    ).toBe('unsaved')
    expect(api.downloadRemoteProjectArchive).not.toHaveBeenCalled()
    expect(storage.saves.value.get('one')?.state).toBe('failed')
  })

  it('keeps the entire previous snapshot when download validation fails', async () => {
    const { storage } = setup()
    const root = await storage.openProject('one')
    vi.mocked(parseProjectArchive).mockResolvedValueOnce([
      { relativePath: 'main.kcl', data: new Uint8Array([1]) },
      { relativePath: '../escape.kcl', data: new Uint8Array([2]) },
    ])
    await expect(storage.refreshProject('one')).rejects.toThrow(
      'outside its project'
    )
    expect(
      new TextDecoder().decode(
        await storage.operations.readFile(posix.join(root, 'main.kcl'))
      )
    ).toBe('original')
    expect(storage.saves.value.get('one')?.state).toBe('saved')
  })

  it('discards a fetched snapshot after its session is replaced', async () => {
    const { storage } = setup()
    const root = await storage.openProject('one')
    const gate = Promise.withResolvers<ArrayBuffer>()
    vi.mocked(api.downloadRemoteProjectArchive).mockReturnValueOnce(
      gate.promise
    )
    let current = true
    const refresh = storage.refreshProject('one', () => current)
    await vi.waitFor(() =>
      expect(api.downloadRemoteProjectArchive).toHaveBeenCalledTimes(2)
    )
    current = false
    gate.resolve(new ArrayBuffer(0))
    await refresh
    expect(
      new TextDecoder().decode(
        await storage.operations.readFile(posix.join(root, 'main.kcl'))
      )
    ).toBe('original')
    expect(storage.projects.value[0].revision).toBe('1')
  })

  it('uses a mutation revision for the refreshed snapshot and its next save without fetching metadata', async () => {
    const { storage } = setup()
    const root = await storage.openProject('one')
    vi.mocked(api.getRemoteProject).mockClear()
    await storage.refreshProject('one', () => true, 'latest-mutation')
    expect(api.getRemoteProject).not.toHaveBeenCalled()
    expect(storage.projects.value[0].revision).toBe('latest-mutation')
    await storage.operations.writeFile(
      posix.join(root, 'main.kcl'),
      'next edit'
    )
    expect(api.updateRemoteProject).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 'latest-mutation' })
    )
  })

  it('accepts each incoming revision without rechecking or retrying the download', async () => {
    const { storage } = setup()
    await storage.openProject('one')
    vi.mocked(api.getRemoteProject).mockClear()
    vi.mocked(api.downloadRemoteProjectArchive).mockClear()
    vi.mocked(api.getRemoteProject)
      .mockResolvedValueOnce({ ...remote, revision: '2' })
      .mockResolvedValue({ ...remote, revision: '3' })
    await storage.refreshProject('one')
    expect(storage.projects.value[0].revision).toBe('2')
    expect(api.getRemoteProject).toHaveBeenCalledTimes(1)
    expect(api.downloadRemoteProjectArchive).toHaveBeenCalledTimes(1)
    await storage.refreshProject('one')
    expect(storage.projects.value[0].revision).toBe('3')
    expect(api.getRemoteProject).toHaveBeenCalledTimes(2)
    expect(api.downloadRemoteProjectArchive).toHaveBeenCalledTimes(2)
  })
})
