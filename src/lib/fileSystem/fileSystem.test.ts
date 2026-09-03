import { tmpdir } from 'node:os'
import {
  FileNotFound,
  legacyFileSystemLayer,
  readFile,
  rename,
  writeFile,
} from '@src/lib/fileSystem/fileSystem'
import {
  createFileSystemRuntime,
  type FileSystemRuntime,
} from '@src/lib/fileSystem/runtime'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('Effect filesystem capability', () => {
  let root: string
  let runtime: FileSystemRuntime

  beforeEach(() => {
    root = nodeFileSystem.impl.join(
      tmpdir(),
      `zds-effect-filesystem-${crypto.randomUUID()}`
    )
    runtime = createFileSystemRuntime(nodeFileSystem.impl)
  })

  afterEach(async () => {
    await nodeFileSystem.impl.rm(root, { recursive: true, force: true })
    await runtime.dispose()
  })

  it('composes filesystem programs against the filesystem layer', async () => {
    const source = nodeFileSystem.impl.join(root, 'nested', 'main.kcl')
    const destination = nodeFileSystem.impl.join(root, 'nested', 'renamed.kcl')

    const program = Effect.gen(function* () {
      yield* writeFile(
        source,
        new TextEncoder().encode('cube = startSketchOn(XY)')
      )
      const beforeRename = yield* readFile(source)
      yield* rename(source, destination)
      const afterRename = yield* readFile(destination)
      return {
        beforeRename: new TextDecoder().decode(beforeRename),
        afterRename: new TextDecoder().decode(afterRename),
      }
    })

    await expect(
      Effect.runPromise(
        program.pipe(Effect.provide(legacyFileSystemLayer(nodeFileSystem.impl)))
      )
    ).resolves.toEqual({
      beforeRename: 'cube = startSketchOn(XY)',
      afterRename: 'cube = startSketchOn(XY)',
    })
  })

  it('provides a Promise facade with semantic stat and directory entries', async () => {
    const source = nodeFileSystem.impl.join(root, 'main.kcl')
    await runtime.service.writeFile(source, new TextEncoder().encode('1234'))

    await expect(runtime.service.stat(root)).resolves.toMatchObject({
      kind: 'directory',
    })
    await expect(runtime.service.stat(source)).resolves.toEqual({
      kind: 'file',
      size: 4,
      modifiedAt: expect.any(Number),
    })
    await expect(runtime.service.readDirectory(root)).resolves.toEqual([
      { name: 'main.kcl', kind: 'file' },
    ])
  })

  it('reports missing files explicitly', async () => {
    const missing = nodeFileSystem.impl.join(root, 'missing.kcl')

    await expect(runtime.service.exists(missing)).resolves.toBe(false)
    await expect(runtime.service.readFile(missing)).rejects.toBeInstanceOf(
      FileNotFound
    )
  })

  it('does not hide permission failures behind exists false', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      stat: async () => Promise.reject(denied),
    }
    const deniedRuntime = createFileSystemRuntime(backing)

    await expect(deniedRuntime.service.exists('/restricted')).rejects.toEqual(
      expect.objectContaining({
        _tag: 'FilePermissionDenied',
        cause: denied,
        operation: 'stat',
        path: '/restricted',
      })
    )
    await deniedRuntime.dispose()
  })

  it.each([
    ['NotAllowedError', 'FilePermissionDenied'],
    ['EACCES', 'FilePermissionDenied'],
    ['unexpected', 'FileIoFailure'],
  ] as const)(
    'maps %s platform failures without losing their cause',
    async (code, tag) => {
      const cause = Object.assign(new Error(code), { code })
      const backing: IZooDesignStudioFS = {
        ...nodeFileSystem.impl,
        readFile: async () => Promise.reject(cause),
      }
      const errorRuntime = createFileSystemRuntime(backing)

      await expect(errorRuntime.service.readFile('/failure')).rejects.toEqual(
        expect.objectContaining({
          _tag: tag,
          cause,
          path: '/failure',
        })
      )
      await errorRuntime.dispose()
    }
  )
})
