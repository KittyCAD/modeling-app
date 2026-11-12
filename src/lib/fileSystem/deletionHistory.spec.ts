import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import nodefs from '@src/lib/fs-zds/nodefs'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: { FileOperationsError: 'FileOperationsError' },
  reportClientError: vi.fn(),
}))

for (const kind of ['disk', 'memory'] as const) {
  describe(`${kind} deletion history`, () => {
    const fixture = async () => {
      const root = await mkdtemp(join(tmpdir(), 'zds-deletion-'))
      const backing =
        kind === 'disk' ? nodefs.impl : createMemoryFileSystem(nodefs.impl)
      await backing.mkdir(root, { recursive: true })
      const runtime = createFileOperationsRuntime(backing)
      return {
        root,
        backing,
        ...runtime,
        dispose: async () => {
          await runtime.dispose()
          await rm(root, { recursive: true, force: true })
        },
      }
    }

    it('preserves generated binary trees and empty folders across delete/undo/redo', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.uint8Array({ maxLength: 256 }), {
            minLength: 1,
            maxLength: 8,
          }),
          async (files) => {
            const f = await fixture()
            try {
              const target = join(f.root, 'folder')
              const empty = join(target, 'nested', 'empty')
              await f.operations.createDirectory(empty)
              for (const [i, bytes] of files.entries())
                await f.operations.createFile(join(target, `${i}.bin`), bytes)
              await f.operations.createFile(join(f.root, 'unrelated'), 'keep')
              const deletion = await f.operations.removeWithSnapshot(target)
              expect(await f.operations.exists(target)).toBe(false)
              expect(
                [...(await f.operations.readDirectory(f.root))].sort()
              ).toEqual(['unrelated'])
              for (const restore of [true, false, true]) {
                await f.operations.replayDeletion(deletion, restore)
                expect(await f.operations.exists(target)).toBe(restore)
                if (restore) {
                  expect(await f.operations.readDirectory(empty)).toEqual([])
                  for (const [i, bytes] of files.entries())
                    expect(
                      new Uint8Array(
                        await f.operations.readFile(join(target, `${i}.bin`))
                      )
                    ).toEqual(bytes)
                }
              }
              expect(
                new TextDecoder().decode(
                  await f.operations.readFile(join(f.root, 'unrelated'))
                )
              ).toBe('keep')
            } finally {
              await f.dispose()
            }
          }
        ),
        { numRuns: 30 }
      )
    })

    it('restores generated standalone files from memory', async () => {
      const f = await fixture()
      try {
        await fc.assert(
          fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async (bytes) => {
            const target = join(f.root, 'standalone.bin')
            await f.operations.createFile(target, bytes)
            const deletion = await f.operations.removeWithSnapshot(target)
            await f.operations.replayDeletion(deletion, true)
            expect(new Uint8Array(await f.operations.readFile(target))).toEqual(
              bytes
            )
            await f.operations.replayDeletion(deletion, false)
          }),
          { numRuns: 30 }
        )
      } finally {
        await f.dispose()
      }
    })

    it('rolls back an interrupted restoration so Undo can retry', async () => {
      const f = await fixture()
      try {
        const target = join(f.root, 'folder')
        const file = join(target, 'file')
        await f.operations.createDirectory(target)
        await f.operations.createFile(file, 'original')
        const deletion = await f.operations.removeWithSnapshot(target)
        const write = vi
          .spyOn(f.backing, 'writeFile')
          .mockRejectedValueOnce(new Error('storage unavailable'))
        await expect(
          f.operations.replayDeletion(deletion, true)
        ).rejects.toBeDefined()
        write.mockRestore()
        expect(await f.operations.exists(target)).toBe(false)
        await f.operations.replayDeletion(deletion, true)
        expect(
          new TextDecoder().decode(await f.operations.readFile(file))
        ).toBe('original')
      } finally {
        await f.dispose()
      }
    })

    it.each(['file', 'folder'] as const)(
      'rolls back a partly written %s restoration and allows retry',
      async (entryKind) => {
        await fc.assert(
          fc.asyncProperty(
            fc.uint8Array({ minLength: 2, maxLength: 64 }),
            fc.nat(),
            async (bytes, offset) => {
              const f = await fixture()
              try {
                const target = join(f.root, 'deleted')
                const file = entryKind === 'file' ? target : join(target, 'b')
                if (entryKind === 'folder') {
                  await f.operations.createDirectory(target)
                  await f.operations.createFile(join(target, 'a'), 'first')
                }
                await f.operations.createFile(file, bytes)
                await f.operations.createFile(join(f.root, 'unrelated'), 'keep')
                const deletion = await f.operations.removeWithSnapshot(target)
                const originalWrite = f.backing.writeFile
                const write = vi
                  .spyOn(f.backing, 'writeFile')
                  .mockImplementation(async (path, data, options) => {
                    if (path !== file) return originalWrite(path, data, options)
                    await originalWrite(
                      path,
                      data.subarray(0, offset % (data.length + 1)),
                      options
                    )
                    throw new Error('storage unavailable')
                  })
                try {
                  await expect(
                    f.operations.replayDeletion(deletion, true)
                  ).rejects.toBeDefined()
                } finally {
                  write.mockRestore()
                }
                expect(await f.operations.exists(target)).toBe(false)
                await f.operations.replayDeletion(deletion, true)
                expect(
                  Uint8Array.from(await f.operations.readFile(file))
                ).toEqual(bytes)
                if (entryKind === 'folder')
                  expect(await f.operations.readDirectory(target)).toEqual([
                    'a',
                    'b',
                  ])
                expect(
                  new TextDecoder().decode(
                    await f.operations.readFile(join(f.root, 'unrelated'))
                  )
                ).toBe('keep')
              } finally {
                await f.dispose()
              }
            }
          ),
          {
            numRuns: 30,
            examples: [
              [new Uint8Array([1, 2, 3]), 0],
              [new Uint8Array([1, 2, 3]), 1],
              [new Uint8Array([1, 2, 3]), 3],
            ],
          }
        )
      }
    )

    it.each(['collision', 'changed file', 'added sibling'])(
      'preserves unexpected contents after a failed restore: %s',
      async (failure) => {
        const f = await fixture()
        try {
          const target = join(f.root, 'folder')
          const file = join(target, 'file')
          await f.operations.createDirectory(target)
          await f.operations.createFile(file, 'original')
          const deletion = await f.operations.removeWithSnapshot(target)
          const originalWrite = f.backing.writeFile
          const replacement = failure === 'changed file' ? 'replacement' : 'o'
          const write = vi
            .spyOn(f.backing, 'writeFile')
            .mockImplementationOnce(async (path) => {
              await originalWrite(path, new TextEncoder().encode(replacement))
              if (failure === 'added sibling')
                await originalWrite(
                  join(target, 'external'),
                  new Uint8Array([42])
                )
              throw Object.assign(new Error('write failed'), {
                code: failure === 'collision' ? 'EEXIST' : 'EIO',
              })
            })
          try {
            await expect(
              f.operations.replayDeletion(deletion, true)
            ).rejects.toBeDefined()
          } finally {
            write.mockRestore()
          }
          expect(
            new TextDecoder().decode(await f.operations.readFile(file))
          ).toBe(replacement)
          if (failure === 'added sibling')
            expect(
              Uint8Array.from(
                await f.operations.readFile(join(target, 'external'))
              )
            ).toEqual(new Uint8Array([42]))
        } finally {
          await f.dispose()
        }
      }
    )

    it('does not overwrite reused paths or redo over changed or added contents', async () => {
      const f = await fixture()
      try {
        const target = join(f.root, 'folder')
        const path = join(target, 'file')
        await f.operations.createDirectory(target)
        await f.operations.createFile(path, 'original')
        const deletion = await f.operations.removeWithSnapshot(target)
        await f.operations.createFile(target, 'replacement')
        await expect(
          f.operations.replayDeletion(deletion, true)
        ).rejects.toBeDefined()
        expect(
          new TextDecoder().decode(await f.operations.readFile(target))
        ).toBe('replacement')
        await f.operations.remove(target)
        await f.operations.replayDeletion(deletion, true)
        await f.operations.createDirectory(join(target, 'new-empty-folder'))
        await expect(
          f.operations.replayDeletion(deletion, false)
        ).rejects.toBeDefined()
        expect(
          await f.operations.exists(join(target, 'new-empty-folder'))
        ).toBe(true)
        await f.operations.remove(join(target, 'new-empty-folder'))
        await f.operations.writeFile(path, 'changed')
        await expect(
          f.operations.replayDeletion(deletion, false)
        ).rejects.toBeDefined()
        expect(
          new TextDecoder().decode(await f.operations.readFile(path))
        ).toBe('changed')
      } finally {
        await f.dispose()
      }
    })

    it('waits for a slow snapshot read, excludes overlapping writes, and permits unrelated writes', async () => {
      const f = await fixture()
      let release = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const target = join(f.root, 'file')
      await f.operations.createFile(target, 'original')
      await f.operations.createFile(join(f.root, 'unrelated'), 'before')
      const originalRead = f.backing.readFile
      const read = vi
        .spyOn(f.backing, 'readFile')
        .mockImplementation(async () => {
          await gate
          return new TextEncoder().encode('original')
        })
      const runtime = createFileOperationsRuntime(f.backing)
      try {
        const deleted = vi.fn()
        const deletion = runtime.operations
          .removeWithSnapshot(target)
          .then((value) => {
            deleted()
            return value
          })
        await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
        const written = vi.fn()
        const write = runtime.operations.writeFile(target, 'new').then(written)
        await runtime.operations.writeFile(join(f.root, 'unrelated'), 'keep')
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
        await vi.advanceTimersByTimeAsync(7_000)
        expect(deleted).not.toHaveBeenCalled()
        expect(written).not.toHaveBeenCalled()
        vi.useRealTimers()
        release()
        await deletion
        await write
        vi.useRealTimers()
        read.mockRestore()
        expect(new TextDecoder().decode(await originalRead(target))).toBe('new')
      } finally {
        release()
        vi.useRealTimers()
        read.mockRestore()
        await runtime.dispose()
        await f.dispose()
      }
    })

    it('leaves the source intact if snapshot capture fails', async () => {
      const f = await fixture()
      const target = join(f.root, 'file')
      try {
        await f.operations.createFile(target, 'original')
        const read = vi
          .spyOn(f.backing, 'readFile')
          .mockRejectedValueOnce(new Error('disk read failed'))
        await expect(
          f.operations.removeWithSnapshot(target)
        ).rejects.toBeDefined()
        read.mockRestore()
        expect(
          new TextDecoder().decode(await f.operations.readFile(target))
        ).toBe('original')
      } finally {
        await f.dispose()
      }
    })
  })
}

it('refuses a symlink tree without deleting the link or its external target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zds-deletion-link-'))
  const runtime = createFileOperationsRuntime(nodefs.impl)
  try {
    const target = join(root, 'target')
    const link = join(root, 'link')
    await runtime.operations.createDirectory(target)
    await runtime.operations.createFile(join(target, 'file'), 'external')
    await symlink(target, link, 'junction')
    await expect(
      runtime.operations.removeWithSnapshot(link)
    ).rejects.toBeDefined()
    expect(
      (await runtime.operations.stat(link, { followSymlinks: false })).kind
    ).toBe('symlink')
    expect(
      new TextDecoder().decode(
        await runtime.operations.readFile(join(target, 'file'))
      )
    ).toBe('external')
  } finally {
    await runtime.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
