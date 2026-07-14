import path from 'node:path'
import { PUBLISH_DIRECTORY_DESTINATION_EXISTS } from '@src/lib/fs-zds/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsPromisesMock = vi.hoisted(() => ({
  rename: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  cp: vi.fn(),
  rm: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  constants: { R_OK: 4, W_OK: 2 },
}))

const ipcRendererMock = vi.hoisted(() => ({
  on: vi.fn(),
  invoke: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  default: fsPromisesMock,
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: ipcRendererMock,
}))

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
    })),
  },
}))

import { move, openExternal, publishDirectory } from '@src/preload'

describe('publishDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsPromisesMock.mkdir.mockResolvedValue(undefined)
    fsPromisesMock.writeFile.mockResolvedValue(undefined)
    fsPromisesMock.readdir.mockResolvedValue(['first.kcl', 'second.kcl'])
    fsPromisesMock.cp.mockResolvedValue(undefined)
    fsPromisesMock.rm.mockResolvedValue(undefined)
  })

  it('does not modify an existing empty destination', async () => {
    const collision = Object.assign(new Error('already exists'), {
      code: 'EEXIST',
    })
    fsPromisesMock.mkdir.mockRejectedValueOnce(collision)

    await expect(
      publishDirectory('staging', 'destination', '.in-progress')
    ).rejects.toBe(PUBLISH_DIRECTORY_DESTINATION_EXISTS)

    expect(fsPromisesMock.writeFile).not.toHaveBeenCalled()
    expect(fsPromisesMock.cp).not.toHaveBeenCalled()
    expect(fsPromisesMock.rm).not.toHaveBeenCalled()
  })

  it('leaves its marker and destination intact when copying fails', async () => {
    const copyFailure = new Error('simulated copy failure')
    fsPromisesMock.cp
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(copyFailure)

    await expect(
      publishDirectory('staging', 'destination', '.in-progress')
    ).rejects.toBe(copyFailure)

    expect(fsPromisesMock.writeFile).toHaveBeenCalledWith(
      path.join('destination', '.in-progress'),
      expect.any(Uint8Array),
      { flag: 'wx' }
    )
    expect(fsPromisesMock.cp).toHaveBeenNthCalledWith(
      1,
      path.join('staging', 'first.kcl'),
      path.join('destination', 'first.kcl'),
      {
        recursive: true,
        force: false,
        errorOnExist: true,
        verbatimSymlinks: true,
      }
    )
    expect(fsPromisesMock.rm).not.toHaveBeenCalled()
  })

  it('preserves its reservation when marker creation fails', async () => {
    const markerFailure = new Error('simulated marker failure')
    fsPromisesMock.writeFile.mockRejectedValueOnce(markerFailure)

    await expect(
      publishDirectory('staging', 'destination', '.in-progress')
    ).rejects.toBe(markerFailure)

    expect(fsPromisesMock.readdir).not.toHaveBeenCalled()
    expect(fsPromisesMock.cp).not.toHaveBeenCalled()
    expect(fsPromisesMock.rm).not.toHaveBeenCalled()
  })

  it('keeps the marker after a complete copy for transaction finalization', async () => {
    await publishDirectory('staging', 'destination', '.in-progress')

    expect(fsPromisesMock.cp).toHaveBeenCalledTimes(2)
    expect(fsPromisesMock.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      fsPromisesMock.cp.mock.invocationCallOrder[0]
    )
    expect(fsPromisesMock.rm).not.toHaveBeenCalled()
  })
})

describe('move', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsPromisesMock.stat.mockResolvedValue({
      isDirectory: () => false,
    })
    fsPromisesMock.rename.mockResolvedValue(undefined)
    fsPromisesMock.mkdir.mockResolvedValue(undefined)
    fsPromisesMock.cp.mockResolvedValue(undefined)
    fsPromisesMock.rm.mockResolvedValue(undefined)
  })

  it('renames directly when possible', async () => {
    const result = await move('source.txt', 'dest.txt')

    expect(result).toBeUndefined()
    expect(fsPromisesMock.rename).toHaveBeenCalledTimes(1)
    expect(fsPromisesMock.rename).toHaveBeenCalledWith('source.txt', 'dest.txt')
    expect(fsPromisesMock.mkdir).not.toHaveBeenCalled()
    expect(fsPromisesMock.cp).not.toHaveBeenCalled()
    expect(fsPromisesMock.rm).not.toHaveBeenCalled()
  })

  it('creates destination directories when rename fails with ENOENT', async () => {
    const destination = path.join('tmp', 'dir', 'file.txt')
    fsPromisesMock.rename
      .mockRejectedValueOnce({ code: 'ENOENT' })
      .mockResolvedValueOnce(undefined)

    await move('source.txt', destination)

    expect(fsPromisesMock.mkdir).toHaveBeenCalledWith(path.join('tmp', 'dir'), {
      recursive: true,
    })
    expect(fsPromisesMock.rename).toHaveBeenCalledTimes(2)
    expect(fsPromisesMock.cp).not.toHaveBeenCalled()
    expect(fsPromisesMock.rm).not.toHaveBeenCalled()
  })

  it('falls back to copy and delete when rename fails with EXDEV', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fsPromisesMock.rename.mockRejectedValueOnce({ code: 'EXDEV' })
    fsPromisesMock.cp.mockResolvedValueOnce('copied')
    fsPromisesMock.rm.mockResolvedValueOnce('removed')

    const result = await move('source.txt', 'dest.txt')

    expect(result).toEqual(['copied', 'removed'])
    expect(fsPromisesMock.cp).toHaveBeenCalledWith('source.txt', 'dest.txt', {
      recursive: true,
    })
    expect(fsPromisesMock.rm).toHaveBeenCalledWith('source.txt', {
      recursive: true,
    })
    consoleSpy.mockRestore()
  })

  it('returns the error for non-EXDEV failures', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = { code: 'EACCES' }
    fsPromisesMock.rename.mockRejectedValueOnce(error)
    fsPromisesMock.readdir.mockResolvedValueOnce([])
    fsPromisesMock.stat.mockResolvedValue({
      isDirectory: () => false,
    })

    const result = await move('source.txt', 'dest.txt')

    expect(result).toBe(error)
    expect(fsPromisesMock.readdir).not.toHaveBeenCalled()
    expect(fsPromisesMock.cp).not.toHaveBeenCalled()
    expect(fsPromisesMock.rm).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('openExternal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invokes the main process with normalized http URLs', async () => {
    ipcRendererMock.invoke.mockResolvedValue(undefined)

    await expect(openExternal('https://zoo.dev/docs')).resolves.toBeUndefined()

    expect(ipcRendererMock.invoke).toHaveBeenCalledWith(
      'shell.openExternal',
      'https://zoo.dev/docs'
    )
  })

  it('rejects unsupported URL schemes before invoking the main process', async () => {
    await expect(openExternal('file:///tmp/payload.exe')).rejects.toThrow(
      'External URL protocol is not allowed: file:'
    )
    await expect(openExternal('javascript:alert(1)')).rejects.toThrow(
      'External URL protocol is not allowed: javascript:'
    )

    expect(ipcRendererMock.invoke).not.toHaveBeenCalled()
  })
})
