import { posix, win32 } from '@chainner/node-path'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: { FileOperationsError: 'FileOperationsError' },
  reportClientError: vi.fn(),
}))

const profiles = [
  {
    name: 'Windows casing',
    paths: win32,
    file: 'C:\\project\\file.kcl',
    alias: 'c:\\PROJECT\\file.kcl',
    key: (path: string) => path.toLowerCase(),
  },
  {
    name: 'Windows separators',
    paths: win32,
    file: 'C:\\project\\file.kcl',
    alias: 'C:/project/FILE.kcl',
    key: (path: string) => path.toLowerCase(),
  },
  {
    name: 'macOS case-insensitive volume',
    paths: posix,
    file: '/project/File.kcl',
    alias: '/project/file.kcl',
    key: (path: string) => path.normalize('NFD').toLowerCase(),
  },
  {
    name: 'macOS Unicode aliases on a case-sensitive volume',
    paths: posix,
    file: '/project/caf\u00e9.kcl',
    alias: '/project/cafe\u0301.kcl',
    key: (path: string) => path.normalize('NFD'),
  },
]

describe.each(profiles)(
  '$name (modeled backing)',
  ({ paths, file, alias, key }) => {
    const backing = () =>
      createMemoryFileSystem({
        ...noopfs.impl,
        ...paths,
        resolve: (...parts) => key(paths.resolve(...parts)),
      })
    it('coordinates alias reads and writes while a write takes seven seconds', async () => {
      const memory = backing()
      await memory.mkdir(paths.dirname(file), { recursive: true })
      await memory.writeFile(file, new Uint8Array([0]))
      let release = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const write = vi.fn(async (path: string, bytes: Uint8Array) => {
        if (bytes[0] === 1) await gate
        await memory.writeFile(path, new Uint8Array(bytes))
      })
      const runtime = createFileOperationsRuntime({
        ...memory,
        resolve: (...parts) => paths.resolve(...parts),
        writeFile: write,
      })
      try {
        const first = runtime.operations.writeFile(file, new Uint8Array([1]))
        await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
        const second = runtime.operations.writeFile(alias, new Uint8Array([2]))
        const observed = vi.fn()
        const read = runtime.operations.readFile(alias).then(observed)
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
        await vi.advanceTimersByTimeAsync(7_000)
        expect(write).toHaveBeenCalledOnce()
        expect(observed).not.toHaveBeenCalled()
        vi.useRealTimers()
        release()
        await Promise.all([first, second, read])
        expect(await runtime.operations.readFile(file)).toEqual(
          new Uint8Array([2])
        )
      } finally {
        release()
        vi.useRealTimers()
        await runtime.dispose()
      }
    })
  }
)
