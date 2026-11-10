import { link, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import nodefs from '@src/lib/fs-zds/nodefs'
import fc from 'fast-check'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lib/clientErrors', () => ({
  ClientErrorCode: { FileOperationsError: 'FileOperationsError' },
  reportClientError: vi.fn(),
}))

it.each([
  ['Part.kcl', 'part.kcl'],
  ['cafe\u0301.kcl'.normalize('NFC'), 'cafe\u0301.kcl'],
])(
  'preserves bytes renaming %s to %s on the actual volume',
  async (from, to) => {
    const root = await mkdtemp(join(tmpdir(), 'zds-rename-alias-'))
    const runtime = createFileOperationsRuntime(nodefs.impl)
    try {
      await fc.assert(
        fc.asyncProperty(fc.uint8Array({ maxLength: 256 }), async (bytes) => {
          const source = join(root, from)
          const destination = join(root, to)
          await runtime.operations.createFile(source, bytes)
          await runtime.operations.rename(source, destination)
          expect(
            new Uint8Array(await runtime.operations.readFile(destination))
          ).toEqual(bytes)
          // Native volumes may normalize Unicode, but ASCII casing must follow the requested name.
          expect(
            (await runtime.operations.readDirectory(root)).map((name) =>
              name.normalize('NFC')
            )
          ).toEqual([to.normalize('NFC')])
          await runtime.operations.remove(destination)
        }),
        { numRuns: 30 }
      )
    } finally {
      await runtime.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }
)

it('refuses replacement of a distinct hard link on the actual volume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zds-rename-links-'))
  const runtime = createFileOperationsRuntime(nodefs.impl)
  try {
    const source = join(root, 'source')
    const destination = join(root, 'destination')
    await runtime.operations.createFile(source, 'keep')
    await link(source, destination)
    await expect(
      runtime.operations.rename(source, destination)
    ).rejects.toMatchObject({ _tag: 'FileAlreadyExists' })
    expect([...(await runtime.operations.readDirectory(root))].sort()).toEqual([
      'destination',
      'source',
    ])
    expect(
      new TextDecoder().decode(await runtime.operations.readFile(source))
    ).toBe('keep')
    expect(
      new TextDecoder().decode(await runtime.operations.readFile(destination))
    ).toBe('keep')
  } finally {
    await runtime.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
