import { posix } from '@chainner/node-path'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: { FileOperationsError: 'FileOperationsError' },
  reportClientError: vi.fn(),
}))
const backing = () => createMemoryFileSystem({ ...noopfs.impl, ...posix })

it.each([false, true])(
  'preserves distinct case-sensitive entries even if their inodes match: %s',
  async (hardLinks) => {
    const memory = backing()
    await memory.mkdir('/project', { recursive: true })
    await memory.writeFile('/project/main.kcl', new Uint8Array([1]))
    await memory.writeFile('/project/Main.kcl', new Uint8Array([2]))
    const stat = async (path: string) => {
      const result = await memory.stat(path)
      return hardLinks && posix.dirname(path) === '/project'
        ? { ...result, ino: 42 }
        : result
    }
    const runtime = createFileOperationsRuntime({ ...memory, stat })
    try {
      await expect(
        runtime.operations.rename('/project/main.kcl', '/project/Main.kcl')
      ).rejects.toMatchObject({ _tag: 'FileAlreadyExists' })
      expect(await runtime.operations.readFile('/project/main.kcl')).toEqual(
        new Uint8Array([1])
      )
      expect(await runtime.operations.readFile('/project/Main.kcl')).toEqual(
        new Uint8Array([2])
      )
    } finally {
      await runtime.dispose()
    }
  }
)

it('keeps exact-name virtual paths independently coordinated', async () => {
  const memory = backing()
  await memory.mkdir('/project', { recursive: true })
  await memory.writeFile('/project/main.kcl', new Uint8Array([0]))
  await memory.writeFile('/project/Main.kcl', new Uint8Array([0]))
  const gate = Promise.withResolvers<undefined>()
  const writeFile = vi.fn(async (path: string, bytes: Uint8Array) => {
    if (path === '/project/main.kcl') await gate.promise
    await memory.writeFile(path, new Uint8Array(bytes))
  })
  const runtime = createFileOperationsRuntime(
    { ...memory, writeFile },
    { pathLockKey: (path) => path }
  )
  try {
    const pending = runtime.operations.writeFile(
      '/project/main.kcl',
      new Uint8Array([1])
    )
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce())
    await runtime.operations.writeFile('/project/Main.kcl', new Uint8Array([2]))
    expect(await runtime.operations.readFile('/project/Main.kcl')).toEqual(
      new Uint8Array([2])
    )
    gate.resolve(undefined)
    await pending
  } finally {
    gate.resolve(undefined)
    await runtime.dispose()
  }
})

it('holds the destination reservation while a rename takes seven seconds', async () => {
  const memory = backing()
  await memory.mkdir('/project', { recursive: true })
  await memory.writeFile('/project/source', new Uint8Array([1]))
  const gate = Promise.withResolvers<undefined>()
  const rename = vi.fn(async (source: string, destination: string) => {
    await gate.promise
    await memory.rename(source, destination)
  })
  const runtime = createFileOperationsRuntime({ ...memory, rename })
  try {
    const moving = runtime.operations.rename(
      '/project/source',
      '/project/target'
    )
    await vi.waitFor(() => expect(rename).toHaveBeenCalledOnce())
    const created = vi.fn()
    const creation = runtime.operations
      .createFile('/project/target', new Uint8Array([2]))
      .then(created, (error) => error)
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    await vi.advanceTimersByTimeAsync(7_000)
    expect(created).not.toHaveBeenCalled()
    vi.useRealTimers()
    gate.resolve(undefined)
    await moving
    expect(await creation).toMatchObject({ _tag: 'FileAlreadyExists' })
    expect(await runtime.operations.readFile('/project/target')).toEqual(
      new Uint8Array([1])
    )
  } finally {
    gate.resolve(undefined)
    vi.useRealTimers()
    await runtime.dispose()
  }
})
