import { tmpdir } from 'node:os'
import {
  copy,
  FileNotFound,
  fileSystemLayer,
  makeFileSystem,
  readDirectory,
  readFile,
  rename,
  stat,
  writeFile,
} from '@src/lib/fileSystem/fileSystem'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Effect filesystem capability', () => {
  let root: string

  beforeEach(() => {
    root = nodeFileSystem.impl.join(
      tmpdir(),
      `zds-effect-filesystem-${crypto.randomUUID()}`
    )
  })

  afterEach(async () => {
    await nodeFileSystem.impl.rm(root, { recursive: true, force: true })
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
        program.pipe(Effect.provide(fileSystemLayer(nodeFileSystem.impl)))
      )
    ).resolves.toEqual({
      beforeRename: 'cube = startSketchOn(XY)',
      afterRename: 'cube = startSketchOn(XY)',
    })
  })

  it('provides semantic stat and directory entries', async () => {
    const source = nodeFileSystem.impl.join(root, 'main.kcl')
    const program = Effect.gen(function* () {
      yield* writeFile(source, new TextEncoder().encode('1234'))
      return {
        root: yield* stat(root),
        source: yield* stat(source),
        entries: yield* readDirectory(root),
      }
    }).pipe(Effect.provide(fileSystemLayer(nodeFileSystem.impl)))

    await expect(Effect.runPromise(program)).resolves.toEqual({
      root: {
        kind: 'directory',
        device: expect.any(Number),
        inode: expect.any(Number),
        size: expect.any(Number),
        accessedAt: expect.any(Number),
        modifiedAt: expect.any(Number),
        changedAt: expect.any(Number),
        createdAt: expect.any(Number),
      },
      source: {
        kind: 'file',
        device: expect.any(Number),
        inode: expect.any(Number),
        size: 4,
        accessedAt: expect.any(Number),
        modifiedAt: expect.any(Number),
        changedAt: expect.any(Number),
        createdAt: expect.any(Number),
      },
      entries: [{ name: 'main.kcl', kind: 'file' }],
    })
  })

  it('distinguishes denied access from unexpected access failures', async () => {
    const access = vi
      .fn<IZooDesignStudioFS['access']>()
      .mockRejectedValueOnce(new Error('EACCES: permission denied'))
      .mockRejectedValueOnce(new Error('EIO: device failure'))
    const fileSystem = makeFileSystem({ ...nodeFileSystem.impl, access })

    await expect(
      Effect.runPromise(fileSystem.canReadWrite('/restricted'))
    ).resolves.toBe(false)
    await expect(
      Effect.runPromise(fileSystem.canReadWrite('/broken').pipe(Effect.flip))
    ).resolves.toEqual(
      expect.objectContaining({
        _tag: 'FileIoFailure',
        operation: 'access',
        path: '/broken',
      })
    )

    expect(access).toHaveBeenNthCalledWith(
      1,
      '/restricted',
      fsZdsConstants.R_OK | fsZdsConstants.W_OK
    )
  })

  it('snapshots mutable bytes before passing them to the backing', async () => {
    const source = nodeFileSystem.impl.join(root, 'main.kcl')
    let writtenContents: Uint8Array | undefined
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      writeFile: async (_path, contents) => {
        writtenContents = contents
      },
    }
    const fileSystem = makeFileSystem(backing)
    const contents = new Uint8Array([1, 2, 3])
    const write = fileSystem.writeFile(source, contents)

    contents[0] = 9
    await Effect.runPromise(write)

    expect(writtenContents).toEqual(new Uint8Array([1, 2, 3]))
    expect(writtenContents).not.toBe(contents)
  })

  it('forwards explicit copy collision policy to the backing', async () => {
    const backingCopy = vi.fn<IZooDesignStudioFS['cp']>()
    const program = copy('/source', '/destination', false).pipe(
      Effect.provide(
        fileSystemLayer({ ...nodeFileSystem.impl, cp: backingCopy })
      )
    )

    await Effect.runPromise(program)

    expect(backingCopy).toHaveBeenCalledWith('/source', '/destination', {
      recursive: true,
      force: false,
    })
  })

  it('returns typed missing-file failures', async () => {
    const missing = nodeFileSystem.impl.join(root, 'missing.kcl')
    const fileSystem = makeFileSystem(nodeFileSystem.impl)

    await expect(Effect.runPromise(fileSystem.exists(missing))).resolves.toBe(
      false
    )
    await expect(
      Effect.runPromise(fileSystem.readFile(missing).pipe(Effect.flip))
    ).resolves.toBeInstanceOf(FileNotFound)
  })

  it('does not hide permission failures behind exists false', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      stat: async () => Promise.reject(denied),
    }
    const fileSystem = makeFileSystem(backing)

    await expect(
      Effect.runPromise(fileSystem.exists('/restricted').pipe(Effect.flip))
    ).resolves.toEqual(
      expect.objectContaining({
        _tag: 'FilePermissionDenied',
        cause: denied,
        operation: 'stat',
        path: '/restricted',
      })
    )
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
      const fileSystem = makeFileSystem(backing)

      await expect(
        Effect.runPromise(fileSystem.readFile('/failure').pipe(Effect.flip))
      ).resolves.toEqual(
        expect.objectContaining({
          _tag: tag,
          cause,
          path: '/failure',
        })
      )
    }
  )
})
