import { posix, win32 } from '@chainner/node-path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import {
  collectCloudSnapshot,
  replaceCloudSnapshot,
  sameSnapshot,
} from '@src/lib/fs-zds/cloud/snapshot'
import {
  CLOUD_DIRECTORIES_FILE,
  encodeCloudDirectories,
} from '@src/lib/fs-zds/cloud/directories'

const files = fc.uniqueArray(
  fc.record({
    name: fc.integer({ min: 0, max: 1000 }).map((n) => `part-${n}.bin`),
    data: fc.uint8Array({ maxLength: 128 }),
  }),
  { selector: (entry) => entry.name, maxLength: 15 }
)

for (const [platform, paths] of [
  ['posix', posix],
  ['win32', win32],
] as const) {
  describe(`cloud snapshots on ${platform} paths`, () => {
    it('replaces files and empty directories without retaining old contents or sharing input bytes', async () => {
      await fc.assert(
        fc.asyncProperty(files, async (generated) => {
          const memory = createMemoryFileSystem({ ...noopfs.impl, ...paths })
          const root = paths.resolve('/project')
          await memory.mkdir(root, { recursive: true })
          await memory.writeFile(
            paths.join(root, 'old.bin'),
            new Uint8Array([99])
          )
          const expected = generated.map(({ name, data }) => ({
            relativePath: `nested/${name}`,
            data: new Uint8Array(data),
          }))
          const archive = [
            ...expected.map((file) => ({
              ...file,
              data: new Uint8Array(file.data),
            })),
            {
              relativePath: CLOUD_DIRECTORIES_FILE,
              data: encodeCloudDirectories(['empty/child']),
            },
          ]
          replaceCloudSnapshot(memory, root, archive)
          for (const file of archive) file.data.fill(255)
          await expect(
            memory.stat(paths.join(root, 'old.bin'))
          ).rejects.toMatchObject({ code: 'ENOENT' })
          expect(await memory.readdir(paths.join(root, 'empty/child'))).toEqual(
            []
          )
          for (const file of expected)
            expect(
              await memory.readFile(paths.join(root, file.relativePath))
            ).toEqual(file.data)
          expect(
            sameSnapshot(await collectCloudSnapshot(memory, root), [
              ...expected,
              {
                relativePath: CLOUD_DIRECTORIES_FILE,
                data: encodeCloudDirectories(['empty/child']),
              },
            ])
          ).toBe(true)
        }),
        { numRuns: 50 }
      )
    })

    it.each([
      [
        { relativePath: 'same', data: new Uint8Array([1]) },
        { relativePath: 'same', data: new Uint8Array([2]) },
      ],
      [
        { relativePath: 'parent', data: new Uint8Array([1]) },
        { relativePath: 'parent/child', data: new Uint8Array([2]) },
      ],
      [
        { relativePath: 'parent/child', data: new Uint8Array([1]) },
        { relativePath: 'parent', data: new Uint8Array([2]) },
      ],
      [
        { relativePath: 'empty', data: new Uint8Array([1]) },
        {
          relativePath: CLOUD_DIRECTORIES_FILE,
          data: encodeCloudDirectories(['empty/child']),
        },
      ],
    ])(
      'preserves the entire previous snapshot when replacement entries collide: %j',
      async (...archive) => {
        const memory = createMemoryFileSystem({ ...noopfs.impl, ...paths })
        const root = paths.resolve('/project')
        await memory.mkdir(paths.join(root, 'existing-empty'), {
          recursive: true,
        })
        await memory.writeFile(paths.join(root, 'keep'), new Uint8Array([42]))
        expect(() => replaceCloudSnapshot(memory, root, archive)).toThrow()
        expect(await memory.readFile(paths.join(root, 'keep'))).toEqual(
          new Uint8Array([42])
        )
        expect(
          await memory.readdir(paths.join(root, 'existing-empty'))
        ).toEqual([])
        expect((await memory.readdir(root)).sort()).toEqual([
          'existing-empty',
          'keep',
        ])
      }
    )

    it.each([
      '../escape',
      '/absolute',
      'a/../hidden',
      'C:/drive',
      'a\\b',
      'a\0b',
      './relative',
      'folder/',
    ])(
      'rejects original unsafe names before replacing memory: %s',
      async (relativePath) => {
        const memory = createMemoryFileSystem({ ...noopfs.impl, ...paths })
        const root = paths.resolve('/project')
        await memory.mkdir(root, { recursive: true })
        await memory.writeFile(paths.join(root, 'keep'), new Uint8Array([42]))
        expect(() =>
          replaceCloudSnapshot(memory, root, [
            { relativePath, data: new Uint8Array([1]) },
          ])
        ).toThrow()
        expect(await memory.readFile(paths.join(root, 'keep'))).toEqual(
          new Uint8Array([42])
        )
      }
    )

    it('collects empty-directory metadata without writing to the working snapshot', async () => {
      const memory = createMemoryFileSystem({ ...noopfs.impl, ...paths })
      const root = paths.resolve('/project')
      await memory.mkdir(paths.join(root, 'empty'), { recursive: true })
      const archive = await collectCloudSnapshot(memory, root)
      expect(archive).toEqual([
        {
          relativePath: CLOUD_DIRECTORIES_FILE,
          data: encodeCloudDirectories(['empty']),
        },
      ])
      expect(await memory.readdir(root)).toEqual(['empty'])
    })
  })
}

it('snapshot equality compares membership as well as bytes, regardless of order', () => {
  fc.assert(
    fc.property(files, (generated) => {
      const archive = generated.map(({ name, data }) => ({
        relativePath: name,
        data,
      }))
      expect(sameSnapshot(archive, [...archive].reverse())).toBe(true)
      expect(
        sameSnapshot(archive, [
          ...archive,
          { relativePath: 'extra', data: new Uint8Array() },
        ])
      ).toBe(false)
      if (archive.length > 1)
        expect(
          sameSnapshot(
            archive,
            archive.map(() => archive[0])
          )
        ).toBe(false)
    })
  )
})
