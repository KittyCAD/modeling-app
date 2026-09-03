import { tmpdir } from 'node:os'
import { Registry } from '@kittycad/registry'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { fileSystemService } from '@src/registry/contracts/fileSystem'
import { createFileSystemExtension } from '@src/registry/extensions/fileSystem'
import { afterEach, describe, expect, it } from 'vitest'

describe('filesystem extension', () => {
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

  it('mounts one filesystem runtime behind the registry capability', async () => {
    const root = nodeFileSystem.impl.join(
      tmpdir(),
      `zds-effect-filesystem-registry-${crypto.randomUUID()}`
    )
    const file = nodeFileSystem.impl.join(root, 'main.kcl')
    roots.push(root)
    registry = new Registry()
    registry.configure([createFileSystemExtension(nodeFileSystem.impl)])

    const fileSystem = registry.get(fileSystemService)
    const operations = registry.get(fileOperationsService)
    await operations.writeFile(
      file,
      new TextEncoder().encode('line([0, 0], [1, 1])')
    )

    expect(new TextDecoder().decode(await fileSystem.readFile(file))).toBe(
      'line([0, 0], [1, 1])'
    )
    expect(new TextDecoder().decode(await operations.readFile(file))).toBe(
      'line([0, 0], [1, 1])'
    )
    await expect(operations.pending()).resolves.toBe(0)
  })
})
