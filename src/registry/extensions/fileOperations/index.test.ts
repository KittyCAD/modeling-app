import { posix } from '@chainner/node-path'
import { defineRegistryItem, provide, Slot } from '@kittycad/registry'
import { createMemoryFileSystem } from '@src/lib/fs-zds/memory'
import noopfs from '@src/lib/fs-zds/noopfs'
import { createFileOperationsRuntime } from '@src/lib/fileSystem/runtime'
import { fileOperationsMountsValueSpec } from '@src/registry/contracts/fileOperations'
import { readTextFile } from '@src/lib/fileSystem/readTextFile'
import { tmpdir } from 'node:os'
import { Registry } from '@kittycad/registry'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { createFileOperationsExtension } from '@src/registry/extensions/fileOperations'
import { afterEach, describe, expect, it } from 'vitest'

describe('file operations extension', () => {
  const roots: string[] = []
  let registry: Registry | undefined

  afterEach(async () => {
    await registry?.disposeAsync()
    registry = undefined
    await Promise.all(
      roots
        .splice(0)
        .map((root) =>
          nodeFileSystem.impl.rm(root, { recursive: true, force: true })
        )
    )
  })

  it('mounts one file operations runtime behind the registry capability', async () => {
    const root = nodeFileSystem.impl.join(
      tmpdir(),
      `zds-effect-file-operations-registry-${crypto.randomUUID()}`
    )
    const file = nodeFileSystem.impl.join(root, 'main.kcl')
    roots.push(root)
    await nodeFileSystem.impl.mkdir(root, { recursive: true })
    registry = new Registry()
    registry.configure([createFileOperationsExtension(nodeFileSystem.impl)])

    const operations = registry.get(fileOperationsService)
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
  const paths = { ...noopfs.impl, ...posix }
  const disk = createMemoryFileSystem(paths)
  const memory = createMemoryFileSystem(paths)
  await disk.mkdir('/projects', { recursive: true })
  await memory.mkdir('/projects', { recursive: true })
  await disk.writeFile('/projects/main.kcl', new TextEncoder().encode('disk'))
  await memory.writeFile(
    '/projects/main.kcl',
    new TextEncoder().encode('memory')
  )
  const runtime = createFileOperationsRuntime(memory)
  const registry = new Registry()
  const slot = new Slot()
  registry.configure([createFileOperationsExtension(disk), slot.of()])
  try {
    const files = registry.get(fileOperationsService)
    expect(
      new TextDecoder().decode(await files.readFile('/projects/main.kcl'))
    ).toBe('disk')
    registry.reconfigure(slot, [
      defineRegistryItem({
        provides: [
          provide(fileOperationsMountsValueSpec, {
            root: '/projects',
            operations: runtime.operations,
          }),
        ],
      }),
    ])
    expect(
      new TextDecoder().decode(await files.readFile('/projects/main.kcl'))
    ).toBe('memory')
    registry.reconfigure(slot, [])
    expect(
      new TextDecoder().decode(await files.readFile('/projects/main.kcl'))
    ).toBe('disk')
  } finally {
    await registry.disposeAsync()
    await runtime.dispose()
  }
})
