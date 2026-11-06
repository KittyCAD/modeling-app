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

  it.each([
    { kind: 'file', fail: false },
    { kind: 'directory', fail: false },
    { kind: 'file', fail: true },
    { kind: 'directory', fail: true },
  ])(
    'protects a moving $kind from saves until persistence completes (upload failure: $fail)',
    async ({ kind, fail }) => {
      const local = createMemoryFileSystem({ ...noopfs.impl, ...posix })
      const cloud = createMemoryFileSystem({ ...noopfs.impl, ...posix })
      await local.mkdir('/local/project', { recursive: true })
      await cloud.mkdir('/cloud', { recursive: true })
      const file = '/local/project/main.kcl'
      await local.writeFile(file, new TextEncoder().encode('old'))
      const source = kind === 'file' ? file : '/local/project'
      const destination = kind === 'file' ? '/cloud/main.kcl' : '/cloud/project'
      const localRuntime = createFileOperationsRuntime(local)
      const cloudRuntime = createFileOperationsRuntime(cloud)
      let releaseUpload = () => {}
      const uploading = new Promise<void>((resolve) => {
        releaseUpload = resolve
      })
      let markStarted = () => {}
      const started = new Promise<void>((resolve) => {
        markStarted = resolve
      })
      const router = createMountedFileOperations(localRuntime.operations, posix)
      router.mount({
        root: '/cloud',
        operations: {
          ...cloudRuntime.operations,
          createFile: async (path, contents) => {
            markStarted()
            await uploading
            if (fail) return Promise.reject(new Error('Upload failed'))
            await cloudRuntime.operations.createFile(path, contents)
          },
        },
      })
      const move = router.operations.move(source, destination)
      let save: Promise<void> | undefined
      let saveSettled = false
      try {
        await started
        const contents = new TextEncoder().encode('new')
        save = router.operations.writeFile(file, contents)
        contents.fill(0)
        void save.then(
          () => {
            saveSettled = true
          },
          () => {
            saveSettled = true
          }
        )
        // Unrelated paths stay usable while the upload and overlapping save wait.
        await router.operations.writeFile('/local/unrelated.kcl', 'unrelated')
        expect(saveSettled).toBe(false)
        expect(await router.operations.pending()).toBeGreaterThan(0)
      } finally {
        releaseUpload()
        const results = await Promise.allSettled([move, save])
        await Promise.all([localRuntime.dispose(), cloudRuntime.dispose()])
        expect(results[0].status).toBe(fail ? 'rejected' : 'fulfilled')
        // Removing the parent makes a queued directory save fail explicitly.
        expect(results[1].status).toBe(
          fail || kind === 'file' ? 'fulfilled' : 'rejected'
        )
      }
      if (!fail)
        expect(
          new TextDecoder().decode(
            await cloud.readFile(
              kind === 'file'
                ? destination
                : posix.join(destination, 'main.kcl')
            )
          )
        ).toBe('old')
      if (fail || kind === 'file')
        expect(new TextDecoder().decode(await local.readFile(file))).toBe('new')
    }
  )

  it('waits for an earlier save before transferring its source directory', async () => {
    const local = createMemoryFileSystem({ ...noopfs.impl, ...posix })
    const cloud = createMemoryFileSystem({ ...noopfs.impl, ...posix })
    await local.mkdir('/local/project', { recursive: true })
    await cloud.mkdir('/cloud', { recursive: true })
    const file = '/local/project/main.kcl'
    await local.writeFile(file, new TextEncoder().encode('old'))
    const localRuntime = createFileOperationsRuntime(local)
    const cloudRuntime = createFileOperationsRuntime(cloud)
    const saving = Promise.withResolvers<undefined>()
    const releaseSave = Promise.withResolvers<undefined>()
    const router = createMountedFileOperations(
      {
        ...localRuntime.operations,
        writeFile: async (path, contents) => {
          if (path === file) {
            saving.resolve(undefined)
            await releaseSave.promise
          }
          await localRuntime.operations.writeFile(path, contents)
        },
      },
      posix
    )
    const upload = vi.fn(cloudRuntime.operations.createFile)
    router.mount({
      root: '/cloud',
      operations: { ...cloudRuntime.operations, createFile: upload },
    })
    const save = router.operations.writeFile(file, 'new')
    await saving.promise
    const move = router.operations.move('/local/project', '/cloud/project')
    try {
      await router.operations.writeFile('/local/unrelated.kcl', 'unrelated')
      expect(upload).not.toHaveBeenCalled()
    } finally {
      releaseSave.resolve(undefined)
      await Promise.all([save, move])
      await Promise.all([localRuntime.dispose(), cloudRuntime.dispose()])
    }
    expect(
      new TextDecoder().decode(await cloud.readFile('/cloud/project/main.kcl'))
    ).toBe('new')
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
