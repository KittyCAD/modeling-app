import { File } from '@src/lib/projectSession/file'
import { createTextFileIO } from '@src/lib/projectSession/textFileIO'
import { describe, expect, it, vi } from 'vitest'

function createIO() {
  const watch = vi.fn(
    (
      _path: string,
      _key: string,
      _onEvent: (eventType: string, path: string) => void
    ) => {}
  )
  const unwatch = vi.fn((_path: string, _key: string) => {})
  const io = createTextFileIO(
    {
      stat: vi.fn(async () => ({
        kind: 'file' as const,
        device: 0,
        inode: 0,
        size: 0,
        accessedAt: 0,
        modifiedAt: 0,
        changedAt: 0,
        createdAt: 0,
      })),
      readFile: vi.fn(async () => new Uint8Array()),
      writeFile: vi.fn(async () => {}),
    },
    { watch, unwatch }
  )
  return { io, watch, unwatch }
}

it('pairs watch and unwatch across path changes without duplicate registrations', () => {
  const { io, watch, unwatch } = createIO()
  const file = new File('/project/main.kcl', io)
  file.watch()
  file.watch()
  expect(watch).toHaveBeenCalledOnce()
  const key = watch.mock.calls[0][1]
  expect(file.watching).toBe(true)

  file.path = '/project/renamed.kcl'
  expect(unwatch).toHaveBeenCalledExactlyOnceWith('/project/main.kcl', key)
  expect(watch).toHaveBeenLastCalledWith(
    '/project/renamed.kcl',
    key,
    expect.any(Function)
  )
  expect(watch).toHaveBeenCalledTimes(2)
  expect(file.watching).toBe(true)

  file.unwatch()
  file.unwatch()
  expect(unwatch).toHaveBeenLastCalledWith('/project/renamed.kcl', key)
  expect(unwatch).toHaveBeenCalledTimes(2)
  expect(file.watching).toBe(false)
})

it('keeps files with the same path isolated through their injected watch hooks', () => {
  const first = createIO()
  const second = createIO()
  const path = '/project/main.kcl'
  const firstFile = new File(path, first.io)
  const secondFile = new File(path, second.io)
  const firstEvent = vi.fn()
  const secondEvent = vi.fn()
  firstFile.onWatchEvent.push(firstEvent)
  secondFile.onWatchEvent.push(secondEvent)
  try {
    firstFile.watch()
    secondFile.watch()
    expect(first.watch).toHaveBeenCalledOnce()
    expect(second.watch).toHaveBeenCalledOnce()
    expect(first.watch.mock.calls[0][1]).not.toBe(second.watch.mock.calls[0][1])
    first.watch.mock.calls[0][2]('change', path)
    expect(firstEvent).toHaveBeenCalledExactlyOnceWith('change', path)
    expect(secondEvent).not.toHaveBeenCalled()
    second.watch.mock.calls[0][2]('unlink', path)
    expect(secondEvent).toHaveBeenCalledExactlyOnceWith('unlink', path)
    expect(firstEvent).toHaveBeenCalledOnce()
    firstFile.unwatch()
    expect(first.unwatch).toHaveBeenCalledOnce()
    expect(second.unwatch).not.toHaveBeenCalled()
    expect(secondFile.watching).toBe(true)
  } finally {
    firstFile.unwatch()
    secondFile.unwatch()
  }
})

it('does not watch an empty path or restart watching when the path is cleared', () => {
  const { io, watch, unwatch } = createIO()
  const file = new File('', io)
  file.watch()
  expect(watch).not.toHaveBeenCalled()
  expect(file.watching).toBe(false)
  file.path = '/project/main.kcl'
  expect(watch).not.toHaveBeenCalled()
  file.watch()
  file.path = ''
  expect(unwatch).toHaveBeenCalledOnce()
  expect(watch).toHaveBeenCalledOnce()
  expect(file.watching).toBe(false)
})

describe('reading a file with its timestamp', () => {
  it('retries a read when its disk timestamp changes while reading', async () => {
    const { io } = createIO()
    const timestamp = vi
      .spyOn(io, 'modifiedAt')
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(2000)
      .mockResolvedValue(2000)
    const read = vi
      .spyOn(io, 'read')
      .mockResolvedValueOnce('old bytes')
      .mockResolvedValueOnce('new bytes')

    await expect(
      new File('/tmp/model.kcl', io).readWithTimestamp()
    ).resolves.toEqual({
      code: 'new bytes',
      modifiedAt: 2000,
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(timestamp).toHaveBeenCalledTimes(4)
  })

  it('fails instead of returning bytes with the wrong timestamp after repeated changes', async () => {
    const { io } = createIO()
    let modifiedAt = 0
    vi.spyOn(io, 'modifiedAt').mockImplementation(async () => ++modifiedAt)
    const read = vi.spyOn(io, 'read').mockResolvedValue('bytes')

    await expect(
      new File('/tmp/model.kcl', io).readWithTimestamp()
    ).rejects.toThrow('File kept changing while reading')
    expect(read).toHaveBeenCalledTimes(3)
  })
})
