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
    registry = new Registry()
    registry.configure([createFileOperationsExtension(nodeFileSystem.impl)])

    const operations = registry.get(fileOperationsService)
    await operations.writeFile(file, 'line([0, 0], [1, 1])')

    expect(new TextDecoder().decode(await operations.readFile(file))).toBe(
      'line([0, 0], [1, 1])'
    )
    await expect(operations.exists(file)).resolves.toBe(true)
    await expect(operations.stat(file)).resolves.toMatchObject({
      kind: 'file',
    })
    await expect(operations.readDirectory(root)).resolves.toEqual([
      { name: 'main.kcl', kind: 'file' },
    ])
    await expect(operations.pending()).resolves.toBe(0)
  })
})
