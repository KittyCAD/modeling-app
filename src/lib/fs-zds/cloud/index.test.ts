import { CLOUD_DIRECTORIES_FILE } from '@src/lib/fs-zds/cloud/directories'
import { posix, win32 } from '@chainner/node-path'
import * as api from '@src/lib/fs-zds/cloud/api'
import { parseProjectArchive } from '@src/lib/fs-zds/cloud/archive'
import { createCloudFileSystem } from '@src/lib/fs-zds/cloud'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import noopfs from '@src/lib/fs-zds/noopfs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds/cloud/api', async (original) => ({
  ...(await original<typeof api>()),
  getRemoteProject: vi.fn(),
  downloadRemoteProjectArchive: vi.fn(),
  updateRemoteProject: vi.fn(),
  deleteRemoteProject: vi.fn(),
}))
vi.mock('@src/lib/fs-zds/cloud/archive', () => ({
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
  vi.useRealTimers()
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

  it('persists empty directories through a fresh cloud filesystem, then renames and removes them', async () => {
    vi.useFakeTimers()
    const first = setup().fs
    const root = await first.openProject('one')
    const response = Promise.withResolvers<typeof remote>()
    vi.mocked(api.updateRemoteProject).mockReturnValueOnce(response.promise)
    const creating = first.mkdir(paths.join(root, 'parts', 'empty'), {
      recursive: true,
    })
    await vi.advanceTimersByTimeAsync(7_000)
    expect(first.saves.value.get('one')?.state).toBe('saving')
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    response.resolve({ ...remote, revision: '2' })
    await creating
    let archive = vi.mocked(api.updateRemoteProject).mock.calls.at(-1)![0].files
    expect(archive).toContainEqual({
      relativePath: CLOUD_DIRECTORIES_FILE,
      data: encoder.encode('["parts/empty"]'),
    })
    vi.mocked(parseProjectArchive).mockResolvedValueOnce(
      archive.map((file) => ({ ...file, data: new Uint8Array(file.data) }))
    )
    const reopened = setup().fs
    const nextRoot = await reopened.openProject('one')
    expect(await reopened.readdir(paths.join(nextRoot, 'parts'))).toEqual([
      'empty',
    ])
    await reopened.rename(
      paths.join(nextRoot, 'parts', 'empty'),
      paths.join(nextRoot, 'parts', 'renamed')
    )
    archive = vi.mocked(api.updateRemoteProject).mock.calls.at(-1)![0].files
    expect(archive).toContainEqual({
      relativePath: CLOUD_DIRECTORIES_FILE,
      data: encoder.encode('["parts/renamed"]'),
    })
    await reopened.rm(paths.join(nextRoot, 'parts'), { recursive: true })
    expect(
      vi.mocked(api.updateRemoteProject).mock.calls.at(-1)![0].deletedPaths
    ).toContain(CLOUD_DIRECTORIES_FILE)
    vi.useRealTimers()
  })

  it('downloads once on the first refresh and fetches new bytes when reopening', async () => {
    const { fs } = setup()
    await fs.refreshProject('one')
    expect(api.downloadRemoteProjectArchive).toHaveBeenCalledTimes(1)
    vi.mocked(parseProjectArchive).mockResolvedValueOnce([
      { relativePath: 'main.kcl', data: encoder.encode('updated remotely') },
    ])
    await fs.refreshProject('one')
    expect(api.downloadRemoteProjectArchive).toHaveBeenCalledTimes(2)
    expect(
      new TextDecoder().decode(
        await fs.readFile(paths.join(fs.root, 'one', 'main.kcl'))
      )
    ).toBe('updated remotely')
    expect(api.updateRemoteProject).not.toHaveBeenCalled()
  })

  it('polls metadata without downloading unchanged project files', async () => {
    const { fs } = setup()
    await fs.openProject('one')
    vi.mocked(api.downloadRemoteProjectArchive).mockClear()
    expect(await fs.checkForUpdates('one', () => true)).toEqual({
      changed: false,
      refreshed: false,
    })
    expect(api.downloadRemoteProjectArchive).not.toHaveBeenCalled()
    expect(api.updateRemoteProject).not.toHaveBeenCalled()
  })

  it('coalesces probes and refreshes changed files once, including a matching Zookeeper notification', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    const gate = Promise.withResolvers<typeof remote>()
    vi.mocked(api.getRemoteProject)
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue({ ...remote, revision: '2' })
    vi.mocked(parseProjectArchive).mockResolvedValueOnce([
      { relativePath: 'main.kcl', data: encoder.encode('remote edit') },
    ])
    vi.mocked(api.downloadRemoteProjectArchive).mockClear()
    const first = fs.checkForUpdates('one', () => true)
    const second = fs.checkForUpdates('one', () => true)
    expect(second).toBe(first)
    gate.resolve({ ...remote, revision: '2' })
    expect(await first).toEqual({ changed: true, refreshed: true })
    await fs.refreshProject('one', () => true, '2')
    expect(api.downloadRemoteProjectArchive).toHaveBeenCalledOnce()
    expect(await fs.readFile(paths.join(root, 'main.kcl'), 'utf8')).toBe(
      'remote edit'
    )
    expect(await fs.checkForUpdates('one', () => true)).toEqual({
      changed: false,
      refreshed: false,
    })
  })

  it('observes remote changes while dirty or Zookeeper is working, then refreshes when safe', async () => {
    const { fs } = setup()
    await fs.openProject('one')
    vi.mocked(api.getRemoteProject).mockResolvedValue({
      ...remote,
      revision: '2',
    })
    vi.mocked(api.downloadRemoteProjectArchive).mockClear()
    expect(await fs.checkForUpdates('one', () => false)).toEqual({
      changed: true,
      refreshed: false,
    })
    expect(await fs.checkForUpdates('one', () => false)).toEqual({
      changed: false,
      refreshed: false,
    })
    expect(api.downloadRemoteProjectArchive).not.toHaveBeenCalled()
    expect(await fs.checkForUpdates('one', () => true)).toEqual({
      changed: false,
      refreshed: true,
    })
  })

  it('discards a downloaded snapshot when editing or switching projects during the request', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    const file = paths.join(root, 'main.kcl')
    const original = await fs.readFile(file, 'utf8')
    vi.mocked(api.getRemoteProject).mockResolvedValue({
      ...remote,
      revision: '2',
    })
    const gate = Promise.withResolvers<ArrayBuffer>()
    vi.mocked(api.downloadRemoteProjectArchive).mockReturnValueOnce(
      gate.promise
    )
    vi.mocked(parseProjectArchive).mockResolvedValueOnce([
      { relativePath: 'main.kcl', data: encoder.encode('remote edit') },
    ])
    const request = fs.checkForUpdates('one', () => true)
    await vi.waitFor(() =>
      expect(api.downloadRemoteProjectArchive).toHaveBeenCalledTimes(2)
    )
    fs.editorChanged(file)
    gate.resolve(new ArrayBuffer(0))
    expect(await request).toEqual({ changed: true, refreshed: false })
    expect(await fs.readFile(file, 'utf8')).toBe(original)

    let current = true
    const metadata = Promise.withResolvers<typeof remote>()
    vi.mocked(api.getRemoteProject).mockReturnValueOnce(metadata.promise)
    const stale = fs.checkForUpdates('one', () => current)
    current = false
    metadata.resolve({ ...remote, revision: '3' })
    expect(await stale).toEqual({ changed: true, refreshed: false })
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it('does not pair a moving download with an older revision or overwrite a failed save', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    const file = paths.join(root, 'main.kcl')
    const original = await fs.readFile(file, 'utf8')
    vi.mocked(api.getRemoteProject)
      .mockResolvedValueOnce({ ...remote, revision: '2' })
      .mockResolvedValue({ ...remote, revision: '3' })
    expect(await fs.checkForUpdates('one', () => true)).toEqual({
      changed: true,
      refreshed: false,
    })
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
      new Error('Conflict')
    )
    await expect(
      fs.writeFile(file, encoder.encode('unsaved edit'))
    ).rejects.toThrow('Conflict')
    vi.mocked(api.downloadRemoteProjectArchive).mockClear()
    expect(await fs.checkForUpdates('one', () => true)).toEqual({
      changed: false,
      refreshed: false,
    })
    expect(await fs.readFile(file, 'utf8')).toBe('unsaved edit')
    expect(api.downloadRemoteProjectArchive).not.toHaveBeenCalled()
    expect(fs.saves.peek().get('one')?.state).toBe('failed')
    await expect(fs.refreshProject('one', () => true, '1')).rejects.toThrow(
      'preserve unsaved changes'
    )
  })

  it('ignores metadata returned after a local save or account switch', async () => {
    let account = 'first'
    const { fs } = setup(() => account)
    const root = await fs.openProject('one')
    const gate = Promise.withResolvers<typeof remote>()
    vi.mocked(api.getRemoteProject).mockReturnValueOnce(gate.promise)
    const request = fs.checkForUpdates('one', () => true)
    await fs.writeFile(
      paths.join(root, 'main.kcl'),
      encoder.encode('local edit')
    )
    gate.resolve(remote)
    expect(await request).toEqual({ changed: false, refreshed: false })
    const other = Promise.withResolvers<typeof remote>()
    vi.mocked(api.getRemoteProject).mockReturnValueOnce(other.promise)
    const stale = fs.checkForUpdates('one', () => true)
    account = 'second'
    other.resolve({ ...remote, revision: '3' })
    expect(await stale).toEqual({ changed: false, refreshed: false })
    await expect(fs.checkForUpdates('one', () => true)).rejects.toThrow(
      'not open for this account'
    )
  })

  it('allows local saving during a slow download and discards the superseded snapshot', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    const file = paths.join(root, 'main.kcl')
    vi.mocked(api.getRemoteProject).mockResolvedValue({
      ...remote,
      revision: 'remote',
    })
    const gate = Promise.withResolvers<ArrayBuffer>()
    vi.mocked(api.downloadRemoteProjectArchive).mockReturnValueOnce(
      gate.promise
    )
    const poll = fs.checkForUpdates('one', () => true)
    await vi.waitFor(() =>
      expect(api.downloadRemoteProjectArchive).toHaveBeenCalledTimes(2)
    )
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(7_000)
    expect(await fs.readFile(file, 'utf8')).toBe('@settings(kclVersion = 3.0)\n')
    await fs.writeFile(file, encoder.encode('saved while downloading'))
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    gate.resolve(new ArrayBuffer(0))
    expect(await poll).toEqual({ changed: true, refreshed: false })
    expect(await fs.readFile(file, 'utf8')).toBe('saved while downloading')
  })

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
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(7_000)
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
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

  it('does not upload identical bytes, including after a remote refresh', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    await fs.refreshProject('one', () => true, 'remote-revision')
    const file = paths.join(root, 'main.kcl')
    await fs.writeFile(file, new Uint8Array(await fs.readFile(file)))
    expect(api.updateRemoteProject).not.toHaveBeenCalled()
    expect(fs.saves.value.get('one')?.state).toBe('saved')
    await fs.writeFile(file, encoder.encode('user edit'))
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
  })

  it('includes a staged thumbnail in the next file save without another PUT', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    vi.useFakeTimers()
    const thumbnail = new Uint8Array([1, 2])
    await fs.stageThumbnail(root, thumbnail)
    thumbnail.fill(9)
    expect(api.updateRemoteProject).not.toHaveBeenCalled()
    await fs.writeFile(paths.join(root, 'main.kcl'), encoder.encode('edited'))
    expect(api.updateRemoteProject).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        files: expect.arrayContaining([
          { relativePath: 'thumbnail.png', data: new Uint8Array([1, 2]) },
          { relativePath: 'main.kcl', data: encoder.encode('edited') },
        ]),
      })
    )
    await vi.advanceTimersByTimeAsync(3_000)
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    expect(await fs.readFile(paths.join(root, 'thumbnail.png'))).toEqual(
      new Uint8Array([1, 2])
    )
  })

  it('defers the newest thumbnail until three seconds after typing stops', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    vi.useFakeTimers()
    await fs.stageThumbnail(root, new Uint8Array([1]))
    await fs.stageThumbnail(root, new Uint8Array([2]))
    await vi.advanceTimersByTimeAsync(2_000)
    fs.editorChanged(paths.join(root, 'main.kcl'))
    await vi.advanceTimersByTimeAsync(2_999)
    expect(api.updateRemoteProject).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(api.updateRemoteProject).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        files: expect.arrayContaining([
          { relativePath: 'thumbnail.png', data: new Uint8Array([2]) },
        ]),
      })
    )
  })

  it('keeps a thumbnail generated during an in-flight save for the next save', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    vi.useFakeTimers()
    const gate = Promise.withResolvers<typeof remote>()
    vi.mocked(api.updateRemoteProject).mockReturnValueOnce(gate.promise)
    await fs.stageThumbnail(root, new Uint8Array([1]))
    const saving = fs.writeFile(
      paths.join(root, 'main.kcl'),
      encoder.encode('edited')
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    await fs.stageThumbnail(root, new Uint8Array([2]))
    await vi.advanceTimersByTimeAsync(7_000)
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    expect(fs.pending()).toBeGreaterThan(0)
    gate.resolve({ ...remote, revision: '2' })
    await saving
    await vi.advanceTimersByTimeAsync(3_000)
    expect(api.updateRemoteProject).toHaveBeenCalledTimes(2)
    expect(api.updateRemoteProject).toHaveBeenLastCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining([
          { relativePath: 'thumbnail.png', data: new Uint8Array([2]) },
        ]),
      })
    )
  })

  it('does not upload again when the idle timer fires during a save that includes its thumbnail', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    vi.useFakeTimers()
    const gate = Promise.withResolvers<typeof remote>()
    vi.mocked(api.updateRemoteProject).mockReturnValueOnce(gate.promise)
    await fs.stageThumbnail(root, new Uint8Array([1]))
    const saving = fs.writeFile(
      paths.join(root, 'main.kcl'),
      encoder.encode('edited')
    )
    await vi.advanceTimersByTimeAsync(7_000)
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    gate.resolve({ ...remote, revision: '2' })
    await saving
    await vi.advanceTimersByTimeAsync(0)
    expect(fs.pending()).toBe(0)
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
  })

  it('cancels delayed thumbnail uploads before deleting a cloud project', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    vi.useFakeTimers()
    const gate = Promise.withResolvers<undefined>()
    vi.mocked(api.deleteRemoteProject).mockReturnValueOnce(gate.promise)
    await fs.stageThumbnail(root, new Uint8Array([1]))
    const deleted = vi.fn()
    const deleting = fs.deleteProject('one').then(deleted)
    await vi.advanceTimersByTimeAsync(7_000)
    expect(api.deleteRemoteProject).toHaveBeenCalledOnce()
    expect(api.updateRemoteProject).not.toHaveBeenCalled()
    expect(deleted).not.toHaveBeenCalled()
    gate.resolve(undefined)
    await deleting
    expect(deleted).toHaveBeenCalledOnce()
  })

  it('flushes a pending thumbnail and cancels its timer when storage is disposed', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    vi.useFakeTimers()
    await fs.stageThumbnail(root, new Uint8Array([1]))
    await fs.detach()
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
  })

  it('retains a failed thumbnail upload for explicit retry', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    vi.useFakeTimers()
    await fs.stageThumbnail(root, new Uint8Array([3]))
    vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
      new Error('Offline')
    )
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fs.saves.value.get('one')?.state).toBe('failed')
    await fs.retry('one')
    expect(api.updateRemoteProject).toHaveBeenLastCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining([
          { relativePath: 'thumbnail.png', data: new Uint8Array([3]) },
        ]),
      })
    )
    await vi.advanceTimersByTimeAsync(3_000)
    expect(api.updateRemoteProject).toHaveBeenCalledTimes(2)
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

  it('retains edits after a save fails seven seconds later and retries the acknowledged revision', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    const file = paths.join(root, 'main.kcl')
    const gate = Promise.withResolvers<typeof remote>()
    vi.mocked(api.updateRemoteProject).mockReturnValueOnce(gate.promise)
    const saving = fs.writeFile(file, encoder.encode('unsaved'))
    // Attach the rejection assertion before releasing the failed request.
    const rejected = expect(saving).rejects.toThrow('Connection lost')
    await vi.waitFor(() =>
      expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    )
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(7_000)
    expect(fs.saves.value.get('one')?.state).toBe('saving')
    expect(await fs.readFile(file, 'utf8')).toBe('unsaved')
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    gate.reject(new Error('Connection lost'))
    await rejected
    expect(fs.saves.value.get('one')?.state).toBe('failed')
    expect(await fs.readFile(file, 'utf8')).toBe('unsaved')
    await fs.retry('one')
    expect(api.updateRemoteProject).toHaveBeenCalledTimes(2)
    expect(api.updateRemoteProject).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: '1',
        files: expect.arrayContaining([
          { relativePath: 'main.kcl', data: encoder.encode('unsaved') },
        ]),
      })
    )
    expect(fs.saves.value.get('one')?.state).toBe('saved')
    expect(fs.pending()).toBe(0)
  })

  it.each(['same', 'different'] as const)(
    'adopts the cloud snapshot after a lost acknowledgement and conflict (%s contents)',
    async (contents) => {
      const { fs, diskWrite } = setup()
      const root = await fs.openProject('one')
      const file = paths.join(root, 'main.kcl')
      const submitted = 'uploaded before connection loss'
      vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
        new Error('Connection lost')
      )
      await expect(
        fs.writeFile(file, encoder.encode(submitted))
      ).rejects.toThrow('Connection lost')
      const cloudCode = contents === 'same' ? submitted : 'another client won'
      vi.mocked(api.getRemoteProject).mockResolvedValue({
        ...remote,
        revision: '3',
      })
      vi.mocked(parseProjectArchive).mockResolvedValue([
        { relativePath: 'main.kcl', data: encoder.encode(cloudCode) },
        {
          relativePath: 'nested/new.kcl',
          data: encoder.encode('remote addition'),
        },
      ])
      const gate = Promise.withResolvers<typeof remote>()
      vi.mocked(api.updateRemoteProject).mockReturnValueOnce(gate.promise)
      const reconciled = vi.fn()
      fs.subscribeReconciled(reconciled)
      const retry = fs.retry('one')
      const staleWrite = fs.writeFile(file, encoder.encode('queued stale edit'))
      const canceled = expect(staleWrite).rejects.toThrow(
        'queued operation canceled'
      )
      await vi.waitFor(() =>
        expect(api.updateRemoteProject).toHaveBeenCalledTimes(2)
      )
      vi.useFakeTimers()
      await fs.stageThumbnail(root, new Uint8Array([99]))
      await vi.advanceTimersByTimeAsync(7_000)
      gate.reject(new api.CloudApiError(409, 'Revision changed'))
      await retry
      await canceled
      await vi.advanceTimersByTimeAsync(7_000)
      expect(await fs.readFile(file, 'utf8')).toBe(cloudCode)
      expect(
        await fs.readFile(paths.join(root, 'nested/new.kcl'), 'utf8')
      ).toBe('remote addition')
      expect(fs.saves.value.get('one')?.state).toBe('saved')
      expect(reconciled).toHaveBeenCalledOnce()
      expect(api.updateRemoteProject).toHaveBeenCalledTimes(2)
      expect(api.updateRemoteProject).toHaveBeenLastCalledWith(
        expect.objectContaining({ expectedRevision: '1' })
      )
      expect(diskWrite).not.toHaveBeenCalled()
      vi.useRealTimers()
      await fs.writeFile(file, encoder.encode('fresh edit after recovery'))
      expect(api.updateRemoteProject).toHaveBeenLastCalledWith(
        expect.objectContaining({ expectedRevision: '3' })
      )
    }
  )

  it('does not stage stale thumbnails while a conflict snapshot is downloading', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    const gate = Promise.withResolvers<ArrayBuffer>()
    vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
      new api.CloudApiError(409, 'Revision changed')
    )
    vi.mocked(api.downloadRemoteProjectArchive).mockReturnValueOnce(
      gate.promise
    )
    const saving = fs.writeFile(
      paths.join(root, 'main.kcl'),
      encoder.encode('old edit')
    )
    await vi.waitFor(() =>
      expect(api.downloadRemoteProjectArchive).toHaveBeenCalledTimes(2)
    )
    await expect(fs.stageThumbnail(root, new Uint8Array([99]))).rejects.toThrow(
      'being reconciled'
    )
    await expect(
      fs.writeFile(
        paths.join(root, 'main.kcl'),
        encoder.encode('typed during recovery')
      )
    ).rejects.toThrow('Retry before editing')
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(7_000)
    gate.resolve(new ArrayBuffer(0))
    await saving
    await vi.advanceTimersByTimeAsync(7_000)
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
  })

  it('retries a failed conflict download without uploading the stale snapshot again', async () => {
    const { fs } = setup()
    const root = await fs.openProject('one')
    const file = paths.join(root, 'main.kcl')
    vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
      new api.CloudApiError(409, 'Revision changed')
    )
    vi.mocked(api.downloadRemoteProjectArchive).mockRejectedValueOnce(
      new Error('Download unavailable')
    )
    await expect(fs.writeFile(file, encoder.encode('stale'))).rejects.toThrow(
      'Download unavailable'
    )
    expect(fs.saves.value.get('one')?.state).toBe('failed')
    vi.mocked(api.getRemoteProject).mockResolvedValue({
      ...remote,
      revision: '4',
    })
    vi.mocked(parseProjectArchive).mockResolvedValue([
      { relativePath: 'main.kcl', data: encoder.encode('cloud truth') },
    ])
    await fs.retry('one')
    expect(await fs.readFile(file, 'utf8')).toBe('cloud truth')
    expect(api.updateRemoteProject).toHaveBeenCalledOnce()
    expect(fs.saves.value.get('one')?.state).toBe('saved')
  })

  it('discards a conflict download completed after the account changes', async () => {
    let account = 'first'
    const { fs } = setup(() => account)
    const root = await fs.openProject('one')
    const gate = Promise.withResolvers<ArrayBuffer>()
    vi.mocked(api.updateRemoteProject).mockRejectedValueOnce(
      new api.CloudApiError(409, 'Revision changed')
    )
    vi.mocked(api.downloadRemoteProjectArchive).mockReturnValueOnce(
      gate.promise
    )
    const reconciled = vi.fn()
    fs.subscribeReconciled(reconciled)
    const saving = fs.writeFile(
      paths.join(root, 'main.kcl'),
      encoder.encode('stale')
    )
    const rejected = expect(saving).rejects.toThrow(
      'changed during reconciliation'
    )
    await vi.waitFor(() =>
      expect(api.downloadRemoteProjectArchive).toHaveBeenCalledTimes(2)
    )
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(7_000)
    account = 'second'
    gate.resolve(new ArrayBuffer(0))
    await rejected
    expect(reconciled).not.toHaveBeenCalled()
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
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(7_000)
    expect(api.updateRemoteProject).toHaveBeenCalledTimes(2)
    expect(drained).not.toHaveBeenCalled()
    gate.resolve({ ...remote, revision: '3' })
    await Promise.all([write, detach])
    expect(drained).toHaveBeenCalledOnce()
  })
})
