import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsPromisesMock = vi.hoisted(() => ({
  rename: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  cp: vi.fn(),
  rm: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  constants: { R_OK: 4, W_OK: 2 },
}))

const exposeInMainWorldMock = vi.hoisted(() => vi.fn())

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
    exposeInMainWorld: exposeInMainWorldMock,
  },
  ipcRenderer: ipcRendererMock,
}))

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}))

import { move, openExternal } from '@src/preload'

describe('filesystem stat bridge', () => {
  // Capture the exposed API before other suites clear mock call history.
  const api = exposeInMainWorldMock.mock.calls.find(
    ([name]) => name === 'electron'
  )![1] as NonNullable<typeof window.electron>

  it('can inspect a link without following its target', async () => {
    const link = { mode: 0xa000 }
    fsPromisesMock.lstat.mockResolvedValueOnce(link)
    await expect(
      api.stat('/project/link', { followSymlinks: false })
    ).resolves.toBe(link)
    expect(fsPromisesMock.lstat).toHaveBeenCalledWith('/project/link')
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
