import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import nodefs from '@src/lib/fs-zds/nodefs'
import { fileSystemContract } from '@src/lib/fs-zds/testSupport/fileSystemContract'
import { posix, win32 } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

fileSystemContract('MemoryFS adapter properties (no disk I/O)', async () => {
  const fs = createMemoryFileSystem(nodefs.impl)
  const root = fs.resolve('/memory-contract', crypto.randomUUID())
  await fs.mkdir(root, { recursive: true })
  return {
    fs,
    root,
    dispose: () => fs.rm(root, { recursive: true, force: true }),
  }
})

describe.each([
  { name: 'POSIX', paths: posix, root: '/' },
  { name: 'Windows drive', paths: win32, root: 'C:\\' },
  { name: 'Windows share', paths: win32, root: '\\\\server\\share\\' },
])('MemoryFS $name paths', ({ paths, root }) => {
  const create = () => createMemoryFileSystem({ ...nodefs.impl, ...paths })

  it('rejects replacement beneath a file without changing the existing tree', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array(),
        fc.integer({ min: 0, max: 4 }),
        async (bytes, depth) => {
          const fs = create()
          const file = paths.join(root, 'parent', 'file')
          await fs.mkdir(paths.dirname(file), { recursive: true })
          await fs.writeFile(file, bytes)
          const nested = paths.join(file, ...Array(depth).fill('nested'))
          const child = paths.join(nested, 'child')
          expect(() =>
            fs.replaceDirectory(nested, [{ path: child, data: bytes }])
          ).toThrow('ENOTDIR')
          expect(await fs.readFile(file)).toEqual(bytes)
          await expect(fs.readFile(child)).rejects.toMatchObject({
            code: 'ENOENT',
          })
          expect(await fs.readdir(paths.dirname(file))).toEqual(['file'])
        }
      ),
      { numRuns: 30 }
    )
  })

  it('removes every descendant when removing the filesystem root', async () => {
    const fs = create()
    const directory = paths.join(root, 'a', 'nested')
    const file = paths.join(directory, 'file')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(file, new Uint8Array([42]))
    await expect(fs.rm(root)).rejects.toMatchObject({ code: 'ENOTEMPTY' })
    await fs.rm(root, { recursive: true })
    for (const path of [root, paths.join(root, 'a'), directory, file])
      await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.mkdir(root)
    expect(await fs.readdir(root)).toEqual([])
  })

  it('replaces the filesystem root with exactly the supplied files', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array(), async (bytes) => {
        const fs = create()
        const oldFile = paths.join(root, 'old', 'file')
        await fs.mkdir(paths.dirname(oldFile), { recursive: true })
        await fs.writeFile(oldFile, new Uint8Array([1]))
        const file = paths.join(root, 'new', 'file')
        fs.replaceDirectory(root, [{ path: file, data: bytes }])
        expect(await fs.readFile(file)).toEqual(bytes)
        expect(await fs.readdir(root)).toEqual(['new'])
        await expect(fs.stat(oldFile)).rejects.toMatchObject({ code: 'ENOENT' })
        fs.replaceDirectory(root, [])
        expect(await fs.readdir(root)).toEqual([])
        await expect(fs.readFile(file)).rejects.toMatchObject({
          code: 'ENOENT',
        })
      }),
      { numRuns: 30 }
    )
  })
})
