import { posix } from '@chainner/node-path'
import { createFileOperationsScheduler } from '@src/lib/fileSystem/scheduler'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { expect, it, vi } from 'vitest'
import fc from 'fast-check'

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: { FileOperationsError: 'FileOperationsError' },
  reportClientError: vi.fn(),
}))
const backing = () => createMemoryFileSystem({ ...noopfs.impl, ...posix })

it.each([
  ['source.kcl', 'Source.kcl'],
  ['cafe\u0301.kcl', 'cafe\u0301.kcl'.normalize('NFC')],
])(
  'renames %s to %s using native identity without inodes',
  async (from, to) => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array(), async (contents) => {
        const memory = backing()
        await memory.mkdir('/project', { recursive: true })
        const source = `/project/${from}`
        const destination = `/project/${to}`
        await memory.writeFile(source, contents)
        let current = source
        const canonical = (path: string) =>
          path === source || path === destination ? current : path
        const scheduler = createFileOperationsScheduler({
          ...memory,
          stat: async (path) => ({
            ...(await memory.stat(canonical(path))),
            ino: 0,
            dev: 0,
          }),
          isSameEntry: async (left, right) =>
            canonical(left) === canonical(right),
          rename: async (path, target) => {
            await memory.rename(canonical(path), target)
            current = target
          },
        })
        try {
          await scheduler.operations.rename(source, destination)
          expect(await memory.readdir('/project')).toEqual([to])
          expect(await memory.readFile(destination)).toEqual(contents)
        } finally {
          await scheduler.dispose()
        }
      }),
      { numRuns: 40 }
    )
  }
)

it.each([false, true])(
  'preserves distinct case-sensitive entries even if their inodes match: %s',
  async (hardLinks) => {
    const externalIdentity = vi.fn(async () => false)
    const memory = createMemoryFileSystem({
      ...noopfs.impl,
      ...posix,
      isSameEntry: externalIdentity,
    })
    await memory.mkdir('/project', { recursive: true })
    await memory.writeFile('/project/main.kcl', new Uint8Array([1]))
    await memory.writeFile('/project/Main.kcl', new Uint8Array([2]))
    const stat = async (path: string) => {
      const result = await memory.stat(path)
      return hardLinks && posix.dirname(path) === '/project'
        ? { ...result, ino: 42 }
        : result
    }
    const scheduler = createFileOperationsScheduler({ ...memory, stat })
    try {
      await expect(
        scheduler.operations.rename('/project/main.kcl', '/project/Main.kcl')
      ).rejects.toMatchObject({ _tag: 'FileAlreadyExists' })
      expect(externalIdentity).not.toHaveBeenCalled()
      expect(await scheduler.operations.readFile('/project/main.kcl')).toEqual(
        new Uint8Array([1])
      )
      expect(await scheduler.operations.readFile('/project/Main.kcl')).toEqual(
        new Uint8Array([2])
      )
    } finally {
      await scheduler.dispose()
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
  const scheduler = createFileOperationsScheduler(
    { ...memory, writeFile },
    { pathLockKey: (path) => path }
  )
  try {
    const pending = scheduler.operations.writeFile(
      '/project/main.kcl',
      new Uint8Array([1])
    )
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledOnce())
    await scheduler.operations.writeFile(
      '/project/Main.kcl',
      new Uint8Array([2])
    )
    expect(await scheduler.operations.readFile('/project/Main.kcl')).toEqual(
      new Uint8Array([2])
    )
    gate.resolve(undefined)
    await pending
  } finally {
    gate.resolve(undefined)
    await scheduler.dispose()
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
  const scheduler = createFileOperationsScheduler({ ...memory, rename })
  try {
    const moving = scheduler.operations.rename(
      '/project/source',
      '/project/target'
    )
    await vi.waitFor(() => expect(rename).toHaveBeenCalledOnce())
    const created = vi.fn()
    const creation = scheduler.operations
      .createFile('/project/target', new Uint8Array([2]))
      .then(created, (error) => error)
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    await vi.advanceTimersByTimeAsync(7_000)
    expect(created).not.toHaveBeenCalled()
    vi.useRealTimers()
    gate.resolve(undefined)
    await moving
    expect(await creation).toMatchObject({ _tag: 'FileAlreadyExists' })
    expect(await scheduler.operations.readFile('/project/target')).toEqual(
      new Uint8Array([1])
    )
  } finally {
    gate.resolve(undefined)
    vi.useRealTimers()
    await scheduler.dispose()
  }
})
