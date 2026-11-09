import { tmpdir } from 'node:os'
import { posix } from '@chainner/node-path'
import { readTextFile } from '@src/lib/fileSystem/readTextFile'
import { createFileOperationsScheduler } from '@src/lib/fileSystem/scheduler'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import noopfs from '@src/lib/fs-zds/noopfs'
import {
  fileOperationsMountsFacet,
  fileOperationsService,
} from '@src/registry/contracts/fileOperations'
import { createFileOperationsExtension } from '@src/registry/extensions/fileOperations'
import {
  contribute,
  slot as createSlot,
  type InputOf,
  Registry,
} from 'plankton'
import { afterEach, describe, expect, it } from 'vitest'
describe('file operations extension', () => {
  const roots: string[] = []
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
    registry = undefined
    await Promise.all(
      roots.splice(0).map((root) =>
        nodeFileSystem.impl.rm(root, {
          recursive: true,
          force: true,
        })
      )
    )
  })
  it('mounts one file operations scheduler behind the registry capability', async () => {
    const root = nodeFileSystem.impl.join(
      tmpdir(),
      `zds-effect-file-operations-registry-${crypto.randomUUID()}`
    )
    const file = nodeFileSystem.impl.join(root, 'main.kcl')
    roots.push(root)
    await nodeFileSystem.impl.mkdir(root, {
      recursive: true,
    })
    registry = new Registry()
    await registry.configure([
      createFileOperationsExtension(nodeFileSystem.impl),
    ])
    const operations = registry.required(fileOperationsService)
    await operations.writeFile(file, 'line([0, 0], [1, 1])')
    expect(await readTextFile(operations, file)).toBe('line([0, 0], [1, 1])')
    await expect(operations.exists(file)).resolves.toBe(true)
    await expect(operations.stat(file)).resolves.toMatchObject({
      kind: 'file',
    })
    await expect(operations.readDirectory(root)).resolves.toEqual(['main.kcl'])
    await expect(operations.pending()).resolves.toBe(0)
  })
})
it('routes through registry mount replacements without replacing the file service', async () => {
  const paths = {
    ...noopfs.impl,
    ...posix,
  }
  const disk = createMemoryFileSystem(paths)
  const memory = createMemoryFileSystem(paths)
  await disk.mkdir('/projects', {
    recursive: true,
  })
  await memory.mkdir('/projects', {
    recursive: true,
  })
  await disk.writeFile('/projects/main.kcl', new TextEncoder().encode('disk'))
  await memory.writeFile(
    '/projects/main.kcl',
    new TextEncoder().encode('memory')
  )
  const runtime = createFileOperationsScheduler(memory)
  const registry = new Registry()
  const slot = createSlot([], Symbol())
  await registry.configure([
    createFileOperationsExtension(disk),
    {
      ...slot,
      create: () => ({
        items: [],
      }),
    },
  ])
  try {
    const files = registry.required(fileOperationsService)
    expect(
      new TextDecoder().decode(await files.readFile('/projects/main.kcl'))
    ).toBe('disk')
    const _fileOperationsMountsContribution: InputOf<
      typeof fileOperationsMountsFacet
    > = {
      root: '/projects',
      operations: runtime.operations,
    } satisfies InputOf<typeof fileOperationsMountsFacet>
    await registry.replace(slot, [
      [
        contribute(
          fileOperationsMountsFacet,
          () => _fileOperationsMountsContribution
        ),
      ],
    ])
    expect(
      new TextDecoder().decode(await files.readFile('/projects/main.kcl'))
    ).toBe('memory')
    await registry.replace(slot, [])
    expect(
      new TextDecoder().decode(await files.readFile('/projects/main.kcl'))
    ).toBe('disk')
  } finally {
    await registry.dispose()
    await runtime.dispose()
  }
})
