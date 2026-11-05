import { posix } from '@chainner/node-path'
import {
  createMountedFileOperations,
  resolveProjectLocation,
} from '@src/lib/fileSystem/mounts'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { describe, expect, it, vi } from 'vitest'

describe('project storage routing', () => {
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

  it('never removes a transfer source when destination persistence fails', async () => {
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
      router.operations.move('/local/main.kcl', '/cloud/project/main.kcl')
    ).rejects.toThrow('Save failed')
    expect(remove).not.toHaveBeenCalled()
  })

  it('creates nested archive parents before moving a file between backends', async () => {
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
      await router.operations.move('/cloud/project/parts/main.kcl', destination)
      expect(await local.readFile(destination)).toEqual(bytes)
      await expect(
        cloud.readFile('/cloud/project/parts/main.kcl')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await Promise.all([localRuntime.dispose(), cloudRuntime.dispose()])
    }
  })

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
