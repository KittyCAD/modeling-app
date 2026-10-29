import type * as ArchiveModule from '@src/lib/fileSystem/cloud/projectArchive'
import { parseProjectArchive } from '@src/lib/fileSystem/cloud/projectArchive'
import { posix } from '@chainner/node-path'
import { createCloudStorage } from '@src/lib/fileSystem/cloud/storage'
import * as api from '@src/lib/fileSystem/cloud/cloudApi'
import nodefs from '@src/lib/fs-zds/nodefs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fileSystem/cloud/cloudApi', () => ({
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
vi.mock('@src/lib/fileSystem/cloud/projectArchive', async (original) => ({
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
const runtimes: ReturnType<typeof createCloudStorage>[] = []
beforeEach(() => {
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
const setup = () => {
  const diskWrite = vi.fn()
  const storage = createCloudStorage(
    { ...nodefs.impl, ...posix, writeFile: diskWrite },
    () => ({ enabled: true })
  )
  runtimes.push(storage)
  return { storage, diskWrite }
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
    ).rejects.toThrow('Conflict')
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
    const storage = createCloudStorage({ ...nodefs.impl, ...posix }, () => ({
      enabled: true,
      accountId,
    }))
    runtimes.push(storage)
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
})
