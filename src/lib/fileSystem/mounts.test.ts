import type { FileOperationsMount } from '@src/lib/fileSystem/mounts'
import { posix, win32 } from '@chainner/node-path'
import {
  createMountedFileOperations,
  resolveProjectLocation,
} from '@src/lib/fileSystem/mounts'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

describe('project storage routing', () => {
  describe.each([
    { name: 'POSIX', paths: posix, baseRoot: '/cloud' },
    { name: 'Windows', paths: win32, baseRoot: 'C:\\cloud' },
  ])('flat mounts with $name paths', ({ paths, baseRoot }) => {
    it.each([false, true])(
      'rejects nested roots without changing routing (parent first: %s)',
      async (parentFirst) => {
        await fc.assert(
          fc.asyncProperty(
            fc.array(fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/), {
              minLength: 1,
              maxLength: 4,
            }),
            async (parts) => {
              const localRead = vi.fn(async () => new Uint8Array([1]))
              const mountedRead = vi.fn(async () => new Uint8Array([2]))
              const router = createMountedFileOperations(
                { ...testFileOperations, readFile: localRead },
                paths
              )
              const parent = paths.resolve(baseRoot, ...parts)
              const child = paths.join(parent, 'nested')
              const first = parentFirst ? parent : child
              const second = parentFirst ? child : parent
              const unmount = router.mount({
                root: first,
                operations: { ...testFileOperations, readFile: mountedRead },
              })
              expect(() =>
                router.mount({ root: second, operations: testFileOperations })
              ).toThrow('Nested filesystem mounts are not supported')
              expect(
                await router.operations.readFile(paths.join(first, 'main.kcl'))
              ).toEqual(new Uint8Array([2]))
              expect(
                await router.operations.readFile(
                  paths.join(parent + '-copy', 'main.kcl')
                )
              ).toEqual(new Uint8Array([1]))
              unmount()
              expect(
                await router.operations.readFile(paths.join(child, 'main.kcl'))
              ).toEqual(new Uint8Array([1]))
            }
          )
        )
      }
    )

    it('routes separate mounts independently even when their names share a prefix', async () => {
      const router = createMountedFileOperations(testFileOperations, paths)
      for (const [root, byte] of [
        [baseRoot, 1],
        [baseRoot + '-copy', 2],
      ] as const)
        router.mount({
          root,
          operations: {
            ...testFileOperations,
            readFile: async () => new Uint8Array([byte]),
          },
        })
      expect(
        await router.operations.readFile(paths.join(baseRoot, 'main.kcl'))
      ).toEqual(new Uint8Array([1]))
      expect(
        await router.operations.readFile(
          paths.join(baseRoot + '-copy', 'main.kcl')
        )
      ).toEqual(new Uint8Array([2]))
    })
  })

  it.each([
    ['C:\\Cloud', 'c:\\cloud\\nested'],
    ['C:\\', 'c:\\nested'],
    ['\\\\server\\share\\', '\\\\SERVER\\SHARE\\nested'],
  ])(
    'rejects nested Windows mounts at %s and %s in either order',
    (parent, child) => {
      for (const [first, second] of [
        [parent, child],
        [child, parent],
      ]) {
        const router = createMountedFileOperations(testFileOperations, win32)
        router.mount({ root: first, operations: testFileOperations })
        expect(() =>
          router.mount({ root: second, operations: testFileOperations })
        ).toThrow('Nested filesystem mounts are not supported')
      }
    }
  )

  it('replaces the same Windows root even when its casing and spelling differ', async () => {
    const replacementRead = vi.fn(async () => new Uint8Array([2]))
    const router = createMountedFileOperations(testFileOperations, win32)
    const unmountOld = router.mount({
      root: 'C:\\Cloud',
      operations: testFileOperations,
    })
    router.mount({
      root: 'c:\\cloud\\.',
      operations: { ...testFileOperations, readFile: replacementRead },
    })
    unmountOld()
    expect(await router.operations.readFile('C:\\CLOUD\\main.kcl')).toEqual(
      new Uint8Array([2])
    )
  })

  it('keeps a replacement mount when an older registration is disposed', async () => {
    const localRead = vi.fn(async () => new Uint8Array([1]))
    const replacementRead = vi.fn(async () => new Uint8Array([2]))
    const router = createMountedFileOperations(
      { ...testFileOperations, readFile: localRead },
      posix
    )
    const unmountOld = router.mount({
      root: '/cloud',
      operations: testFileOperations,
    })
    const unmountReplacement = router.mount({
      root: '/cloud',
      operations: { ...testFileOperations, readFile: replacementRead },
    })

    unmountOld()
    unmountOld()
    expect(await router.operations.readFile('/cloud/main.kcl')).toEqual(
      new Uint8Array([2])
    )
    expect(localRead).not.toHaveBeenCalled()

    unmountReplacement()
    expect(await router.operations.readFile('/cloud/main.kcl')).toEqual(
      new Uint8Array([1])
    )
  })

  it('routes by path and preserves local access while a cloud project is mounted', async () => {
    const localRead = vi.fn(async () => new Uint8Array([1]))
    const cloudRead = vi.fn(async () => new Uint8Array([2]))
    const router = createMountedFileOperations(
      { ...testFileOperations, readFile: localRead },
      posix
    )
    router.mount({
      root: '/cloud/project',
      operations: { ...testFileOperations, readFile: cloudRead },
    })
    expect(await router.operations.readFile('/cloud/project/main.kcl')).toEqual(
      new Uint8Array([2])
    )
    expect(
      await router.operations.readFile('/cloud/project-copy/main.kcl')
    ).toEqual(new Uint8Array([1]))
    expect(await router.operations.readFile('/local/main.kcl')).toEqual(
      new Uint8Array([1])
    )
    expect(cloudRead).toHaveBeenCalledOnce()
    expect(localRead).toHaveBeenCalledTimes(2)
  })

  it('never removes a clone source when destination persistence fails', async () => {
    const remove = vi.fn()
    const router = createMountedFileOperations(
      {
        ...testFileOperations,
        stat: vi.fn(async () => ({
          kind: 'file' as const,
          size: 2,
          device: 0,
          inode: 0,
          accessedAt: 0,
          changedAt: 0,
          modifiedAt: 0,
          createdAt: 0,
        })),
        readFile: async () => new Uint8Array([1, 2]),
        remove,
      },
      posix
    )
    router.mount({
      root: '/cloud/project',
      operations: {
        ...testFileOperations,
        createDirectory: async () => {},
        createFile: async () => Promise.reject(new Error('Save failed')),
      },
    })
    await expect(
      router.operations.copy('/local/main.kcl', '/cloud/project/main.kcl', {
        overwrite: false,
      })
    ).rejects.toThrow('Save failed')
    expect(remove).not.toHaveBeenCalled()
  })

  it('copies between backends without removing the source', async () => {
    const local = createMemoryFileSystem({ ...noopfs.impl, ...posix })
    const cloud = createMemoryFileSystem({ ...noopfs.impl, ...posix })
    await cloud.mkdir('/cloud/project/parts', { recursive: true })
    const bytes = new Uint8Array([0, 255, 42])
    await cloud.writeFile('/cloud/project/parts/main.kcl', bytes)
    const localRuntime = createFileOperationsRuntime(local)
    const cloudRuntime = createFileOperationsRuntime(cloud)
    try {
      const router = createMountedFileOperations(localRuntime.operations, posix)
      router.mount({ root: '/cloud', operations: cloudRuntime.operations })
      const destination = '/archive/cloud/project/parts/main.kcl'
      await router.operations.copy(
        '/cloud/project/parts/main.kcl',
        destination,
        { overwrite: false }
      )
      expect(await local.readFile(destination)).toEqual(bytes)
      expect(await cloud.readFile('/cloud/project/parts/main.kcl')).toEqual(
        bytes
      )
    } finally {
      await Promise.all([localRuntime.dispose(), cloudRuntime.dispose()])
    }
  })

  it('rejects cross-backing moves and renames without changing either project', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array(),
        fc.uint8Array(),
        fc.boolean(),
        async (sourceBytes, destinationBytes, destinationExists) => {
          const local = createMemoryFileSystem({ ...noopfs.impl, ...posix })
          const cloud = createMemoryFileSystem({ ...noopfs.impl, ...posix })
          await local.mkdir('/local', { recursive: true })
          await cloud.mkdir('/cloud', { recursive: true })
          await local.writeFile('/local/main.kcl', sourceBytes)
          if (destinationExists)
            await cloud.writeFile('/cloud/main.kcl', destinationBytes)
          const a = createFileOperationsRuntime(local)
          const b = createFileOperationsRuntime(cloud)
          const router = createMountedFileOperations(a.operations, posix)
          router.mount({ root: '/cloud', operations: b.operations })
          try {
            for (const operation of [
              router.operations.move,
              router.operations.rename,
            ]) {
              await expect(
                operation('/local/main.kcl', '/cloud/main.kcl')
              ).rejects.toThrow('cannot cross project storage backends')
              await expect(
                operation('/cloud/main.kcl', '/local/main.kcl')
              ).rejects.toThrow('cannot cross project storage backends')
            }
            if (destinationExists)
              await expect(
                router.operations.copy('/local/main.kcl', '/cloud/main.kcl', {
                  overwrite: false,
                })
              ).rejects.toThrow()
            expect(await local.readFile('/local/main.kcl')).toEqual(sourceBytes)
            if (destinationExists)
              expect(await cloud.readFile('/cloud/main.kcl')).toEqual(
                destinationBytes
              )
            else
              await expect(cloud.stat('/cloud/main.kcl')).rejects.toMatchObject(
                { code: 'ENOENT' }
              )
            await router.operations.move(
              '/local/main.kcl',
              '/local/renamed.kcl'
            )
            expect(await local.readFile('/local/renamed.kcl')).toEqual(
              sourceBytes
            )
            await expect(local.stat('/local/main.kcl')).rejects.toMatchObject({
              code: 'ENOENT',
            })
          } finally {
            await Promise.all([a.dispose(), b.dispose()])
          }
        }
      )
    )
  })

  it.each([false, true])(
    'keeps source saves usable during a seven-second clone (upload failure: %s)',
    async (fail) => {
      const local = createMemoryFileSystem({ ...noopfs.impl, ...posix })
      const cloud = createMemoryFileSystem({ ...noopfs.impl, ...posix })
      await local.mkdir('/local', { recursive: true })
      await cloud.mkdir('/cloud', { recursive: true })
      await local.writeFile(
        '/local/main.kcl',
        new TextEncoder().encode('captured')
      )
      const a = createFileOperationsRuntime(local)
      const b = createFileOperationsRuntime(cloud)
      const started = Promise.withResolvers<undefined>()
      const upload = Promise.withResolvers<undefined>()
      const router = createMountedFileOperations(a.operations, posix)
      router.mount({
        root: '/cloud',
        operations: {
          ...b.operations,
          createFile: async (path, bytes) => {
            started.resolve(undefined)
            await upload.promise
            if (fail) return Promise.reject(new Error('Upload failed'))
            await b.operations.createFile(path, bytes)
          },
        },
      })
      const copy = router.operations.copy(
        '/local/main.kcl',
        '/cloud/main.kcl',
        { overwrite: false }
      )
      try {
        await started.promise
        vi.useFakeTimers()
        await vi.advanceTimersByTimeAsync(7_000)
        await router.operations.writeFile('/local/main.kcl', 'new edit')
        expect(await local.readFile('/local/main.kcl', 'utf8')).toBe('new edit')
        await expect(cloud.stat('/cloud/main.kcl')).rejects.toMatchObject({
          code: 'ENOENT',
        })
        upload.resolve(undefined)
        if (fail) await expect(copy).rejects.toThrow('Upload failed')
        else {
          await copy
          expect(await cloud.readFile('/cloud/main.kcl', 'utf8')).toBe(
            'captured'
          )
        }
        expect(await local.readFile('/local/main.kcl', 'utf8')).toBe('new edit')
      } finally {
        upload.resolve(undefined)
        await Promise.allSettled([copy])
        vi.useRealTimers()
        await Promise.all([a.dispose(), b.dispose()])
      }
    }
  )

  it('uses prefixes without network requests and propagates ambiguous lookup failures', async () => {
    const exists = vi.fn(async () => true)
    expect(await resolveProjectLocation('local:one', exists)).toEqual({
      type: 'local',
      id: 'one',
    })
    expect(await resolveProjectLocation('cloud:two', exists)).toEqual({
      type: 'cloud',
      id: 'two',
    })
    expect(exists).not.toHaveBeenCalled()
    expect(await resolveProjectLocation('three', exists)).toEqual({
      type: 'cloud',
      id: 'three',
    })
    const failure = new Error('Network unavailable')
    await expect(
      resolveProjectLocation('four', async () => Promise.reject(failure))
    ).rejects.toBe(failure)
    expect(await resolveProjectLocation('five', async () => false)).toEqual({
      type: 'local',
      id: 'five',
    })
  })
})

it.each(['C:\\', '\\\\server\\share\\'])(
  'routes children of Windows volume-root mount %s without falling back to disk',
  async (root) => {
    const localRead = vi.fn(async () => new Uint8Array([1]))
    const mountedRead = vi.fn(async () => new Uint8Array([2]))
    const router = createMountedFileOperations(
      { ...testFileOperations, readFile: localRead },
      win32
    )
    router.mount({
      root,
      operations: { ...testFileOperations, readFile: mountedRead },
    })
    expect(
      await router.operations.readFile(win32.join(root, 'folder', 'main.kcl'))
    ).toEqual(new Uint8Array([2]))
    expect(localRead).not.toHaveBeenCalled()
  }
)

it('routes Windows mount roots independently of drive and directory casing', async () => {
  const localRead = vi.fn(async () => new Uint8Array([1]))
  const mountedRead = vi.fn(async () => new Uint8Array([2]))
  const router = createMountedFileOperations(
    { ...testFileOperations, readFile: localRead },
    win32
  )
  router.mount({
    root: 'C:\\Cloud',
    operations: { ...testFileOperations, readFile: mountedRead },
  })
  expect(
    await router.operations.readFile('c:\\cloud\\project\\main.kcl')
  ).toEqual(new Uint8Array([2]))
  expect(localRead).not.toHaveBeenCalled()
})

it('uses replacement mount contributions without losing the local backing', async () => {
  const memory = createMemoryFileSystem({ ...noopfs.impl, ...posix })
  const backing = createFileOperationsRuntime(memory)
  const localMemory = createMemoryFileSystem({ ...noopfs.impl, ...posix })
  await localMemory.mkdir('/projects', { recursive: true })
  const local = createFileOperationsRuntime(localMemory)
  await memory.mkdir('/projects', { recursive: true })
  await memory.writeFile(
    '/projects/main.kcl',
    new TextEncoder().encode('mounted')
  )
  let contributions = [{ root: '/projects', operations: backing.operations }]
  const router = createMountedFileOperations(
    local.operations,
    posix,
    () => contributions
  )
  try {
    expect(
      new TextDecoder().decode(
        await router.operations.readFile('/projects/main.kcl')
      )
    ).toBe('mounted')
    contributions = []
    await router.operations.writeFile('/projects/main.kcl', 'local')
    contributions = [
      {
        root: '/projects',
        operations: {
          ...backing.operations,
          readFile: async () => new TextEncoder().encode('replacement'),
        },
      },
    ]
    expect(
      new TextDecoder().decode(
        await router.operations.readFile('/projects/main.kcl')
      )
    ).toBe('replacement')
    contributions = []
    expect(
      new TextDecoder().decode(
        await router.operations.readFile('/projects/main.kcl')
      )
    ).toBe('local')
  } finally {
    await backing.dispose()
    await local.dispose()
  }
})

it('recovers from invalid contributed mounts without retaining a partial registration', async () => {
  const original = {
    root: '/original',
    operations: {
      ...testFileOperations,
      readFile: async () => new Uint8Array([1]),
    },
  }
  const invalidParent = { root: '/replacement', operations: testFileOperations }
  let contributions: readonly FileOperationsMount[] = [original]
  const router = createMountedFileOperations(
    testFileOperations,
    posix,
    () => contributions
  )
  expect(await router.operations.readFile('/original/main.kcl')).toEqual(
    new Uint8Array([1])
  )
  contributions = [
    invalidParent,
    { root: '/replacement/nested', operations: testFileOperations },
  ]
  expect(() => router.operations.readFile('/original/main.kcl')).toThrow(
    'Nested filesystem mounts are not supported'
  )
  contributions = [
    original,
    {
      root: '/replacement/nested',
      operations: {
        ...testFileOperations,
        readFile: async () => new Uint8Array([2]),
      },
    },
  ]
  expect(await router.operations.readFile('/original/main.kcl')).toEqual(
    new Uint8Array([1])
  )
  expect(
    await router.operations.readFile('/replacement/nested/main.kcl')
  ).toEqual(new Uint8Array([2]))
})
