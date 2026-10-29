import { posix, win32 } from '@chainner/node-path'
import * as api from '@src/lib/fileSystem/cloud/cloudApi'
import { parseProjectArchive } from '@src/lib/fileSystem/cloud/projectArchive'
import { createCloudFileSystem } from '@src/lib/fs-zds/cloud'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import noopfs from '@src/lib/fs-zds/noopfs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fileSystem/cloud/cloudApi', () => ({
  getRemoteProject: vi.fn(),
  downloadRemoteProjectArchive: vi.fn(),
  updateRemoteProject: vi.fn(),
  deleteRemoteProject: vi.fn(),
}))
vi.mock('@src/lib/fileSystem/cloud/projectArchive', () => ({
  parseProjectArchive: vi.fn(),
}))
const remote = { id: 'one', revision: '1', description: '', category_ids: [] }
const encoder = new TextEncoder()
const instances: ReturnType<typeof createCloudFileSystem>[] = []
beforeEach(() => {
  vi.mocked(api.getRemoteProject).mockResolvedValue(remote)
  vi.mocked(api.downloadRemoteProjectArchive).mockResolvedValue(
    new ArrayBuffer(0)
  )
  vi.mocked(parseProjectArchive).mockResolvedValue([
    {
      relativePath: 'main.kcl',
      data: encoder.encode('@settings(kclVersion = 3.0)\n'),
    },
  ])
  vi.mocked(api.updateRemoteProject).mockResolvedValue({
    ...remote,
    revision: '2',
  })
})
afterEach(async () => {
  await Promise.all(instances.splice(0).map((fs) => fs.detach()))
  vi.resetAllMocks()
})

describe.each([
  { name: 'POSIX', paths: posix },
  { name: 'Windows', paths: win32 },
])('cloud fs-zds with $name paths', ({ paths }) => {
  const setup = (accountId = () => 'account') => {
    const diskWrite = vi.fn()
    const diskRemove = vi.fn()
    const fs = createCloudFileSystem(
      { ...noopfs.impl, ...paths, writeFile: diskWrite, rm: diskRemove },
      () => ({ enabled: true, accountId: accountId() })
    )
    instances.push(fs)
    return { fs, diskWrite, diskRemove }
  }

  it('works through the filesystem interface and waits for acknowledged saves without blocking memory reads', async () => {
    const { fs, diskWrite, diskRemove } = setup()
    const backing: IZooDesignStudioFS = fs
    await backing.attach()
    const root = await fs.openProject('one')
    const file = paths.join(root, 'main.kcl')
    const gate = Promise.withResolvers<typeof remote>()
    vi.mocked(api.updateRemoteProject).mockReturnValueOnce(gate.promise)
    const bytes = encoder.encode('changed')
    const resolved = vi.fn()
    const write = backing.writeFile(file, bytes).then(resolved)
    bytes.fill(0)
    await vi.waitFor(() =>
      expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    )
    expect(resolved).not.toHaveBeenCalled()
    expect(fs.pending()).toBe(1)
    expect(await backing.readFile(file, 'utf8')).toBe('changed')
    expect(await backing.readFile(file, { encoding: 'utf-8' })).toBe('changed')
    const copy = await backing.readFile(file)
    copy.fill(0)
    expect(await backing.readFile(file)).toEqual(encoder.encode('changed'))
    gate.resolve({ ...remote, revision: '2' })
    await write
    expect(fs.saves.value.get('one')?.state).toBe('saved')
    expect(api.updateRemoteProject).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: '1' })
    )
    expect(diskWrite).not.toHaveBeenCalled()
    expect(diskRemove).not.toHaveBeenCalled()
  })

  it('persists nested directory operations and exact deletion intent through raw fs-zds calls', async () => {
    const { fs, diskRemove } = setup()
    const root = await fs.openProject('one')
    const nested = paths.join(root, 'parts', 'nested')
    await fs.mkdir(nested, { recursive: true })
    await fs.writeFile(paths.join(nested, 'data.bin'), new Uint8Array([0, 255]))
    await fs.cp(paths.join(root, 'parts'), paths.join(root, 'copy'), {
      recursive: true,
      force: false,
    })
    await fs.rename(paths.join(root, 'copy'), paths.join(root, 'renamed'))
    expect(await fs.readdir(paths.join(root, 'renamed', 'nested'))).toEqual([
      'data.bin',
    ])
    expect(
      await fs.readFile(paths.join(root, 'renamed', 'nested', 'data.bin'))
    ).toEqual(new Uint8Array([0, 255]))
    await fs.rm(paths.join(root, 'parts'), { recursive: true })
    expect(api.updateRemoteProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ deletedPaths: ['parts/nested/data.bin'] })
    )
    await fs.rm(root, { recursive: true })
    expect(api.deleteRemoteProject).toHaveBeenCalledWith(
      expect.anything(),
      'one'
    )
    expect(await fs.readdir(fs.root)).toEqual([])
    expect(diskRemove).not.toHaveBeenCalled()
  })

  it('retains rejected saves for retry and refuses a refresh over the unsaved bytes', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    const file = paths.join(root, 'main.kcl')
    vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
      new Error('Revision conflict')
    )
    await expect(fs.writeFile(file, encoder.encode('unsaved'))).rejects.toThrow(
      'Revision conflict'
    )
    await expect(fs.refreshProject('one')).rejects.toThrow(
      'preserve unsaved changes'
    )
    expect(await fs.readFile(file, 'utf8')).toBe('unsaved')
    await fs.retry('one')
    expect(api.updateRemoteProject).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: '1' })
    )
  })

  it('rejects stale-account reads, mutations, and deletion', async () => {
    let account = 'first'
    const { fs } = setup(() => account)
    const root = await fs.openProject('one')
    const file = paths.join(root, 'main.kcl')
    account = 'second'
    expect(await fs.readdir(fs.root)).toEqual([])
    await expect(fs.readFile(file)).rejects.toThrow('different account')
    await expect(fs.access(file, 0)).rejects.toThrow('different account')
    await expect(fs.writeFile(file, encoder.encode('new'))).rejects.toThrow(
      'changing accounts'
    )
    await expect(fs.rm(root, { recursive: true })).rejects.toThrow(
      'different account'
    )
    expect(api.updateRemoteProject).not.toHaveBeenCalled()
    expect(api.deleteRemoteProject).not.toHaveBeenCalled()
  })

  it('batches memory mutations into one save and drains queued saves on detach', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    await fs.batch(root, async (memory) => {
      await memory.mkdir(paths.join(root, 'nested'))
      await memory.writeFile(
        paths.join(root, 'nested', 'new.bin'),
        new Uint8Array([1, 2])
      )
      await memory.rm(paths.join(root, 'main.kcl'))
    })
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    const gate = Promise.withResolvers<typeof remote>()
    vi.mocked(api.updateRemoteProject).mockReturnValueOnce(gate.promise)
    const write = fs.writeFile(
      paths.join(root, 'nested', 'new.bin'),
      new Uint8Array([3])
    )
    const drained = vi.fn()
    const detach = fs.detach().then(drained)
    await vi.waitFor(() =>
      expect(api.updateRemoteProject).toHaveBeenCalledTimes(2)
    )
    expect(drained).not.toHaveBeenCalled()
    gate.resolve({ ...remote, revision: '3' })
    await Promise.all([write, detach])
    expect(drained).toHaveBeenCalledOnce()
  })
})
