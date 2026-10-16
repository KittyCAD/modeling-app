import { File } from '@src/lib/projectSession/file'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

describe('reading a file with its timestamp', () => {
  it('retries a read when its disk timestamp changes while reading', async () => {
    const timestamp = vi
      .spyOn(File.ioImplementations, 'modifiedAt')
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(2000)
      .mockResolvedValue(2000)
    const read = vi
      .spyOn(File.ioImplementations, 'read')
      .mockResolvedValueOnce('old bytes')
      .mockResolvedValueOnce('new bytes')

    await expect(
      new File('/tmp/model.kcl').readWithTimestamp()
    ).resolves.toEqual({
      code: 'new bytes',
      modifiedAt: 2000,
    })
    expect(read).toHaveBeenCalledTimes(2)
    expect(timestamp).toHaveBeenCalledTimes(4)
  })

  it('fails instead of returning bytes with the wrong timestamp after repeated changes', async () => {
    let modifiedAt = 0
    vi.spyOn(File.ioImplementations, 'modifiedAt').mockImplementation(
      async () => ++modifiedAt
    )
    const read = vi
      .spyOn(File.ioImplementations, 'read')
      .mockResolvedValue('bytes')

    await expect(
      new File('/tmp/model.kcl').readWithTimestamp()
    ).rejects.toThrow('File kept changing while reading')
    expect(read).toHaveBeenCalledTimes(3)
  })
})
