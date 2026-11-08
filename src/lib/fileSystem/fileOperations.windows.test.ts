import { win32 } from '@chainner/node-path'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: { FileOperationsError: 'FileOperationsError' },
  reportClientError: vi.fn(),
}))

describe('Windows filesystem coordination (modeled case-insensitive backing)', () => {
  it.each(['c:\\PROJECT\\file.kcl', 'C:/project/FILE.kcl'])(
    'coordinates an alias %s with a pending write to the same file',
    async (alias) => {
      // Model Windows disk casing while keeping the native path API case-preserving.
      const memory = createMemoryFileSystem({
        ...noopfs.impl,
        ...win32,
        resolve: (...parts) => win32.resolve(...parts).toLowerCase(),
      })
      const file = 'C:\\project\\file.kcl'
      await memory.mkdir(win32.dirname(file), { recursive: true })
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
        resolve: (...parts) => win32.resolve(...parts),
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
    }
  )
})
