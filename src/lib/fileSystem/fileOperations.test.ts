import { tmpdir } from 'node:os'
import { FileAlreadyExists } from '@src/lib/fileSystem/fileSystem'
import {
  createFileSystemRuntime,
  type FileSystemRuntime,
} from '@src/lib/fileSystem/runtime'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface Gate {
  readonly promise: Promise<void>
  readonly open: () => void
}

function createGate(): Gate {
  let open = () => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

function mockReadFile(
  read: () => Promise<Uint8Array> | Uint8Array
): IZooDesignStudioFS['readFile'] {
  const implementation = async (
    _path: string,
    options?: 'utf8' | { encoding: 'utf-8' }
  ) => {
    const contents = await read()
    return options ? new TextDecoder().decode(contents) : contents
  }

  return implementation as unknown as IZooDesignStudioFS['readFile']
}

describe('Effect filesystem operations', () => {
  const runtimes: FileSystemRuntime[] = []
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await Promise.all(
      roots
        .splice(0)
        .map((root) =>
          nodeFileSystem.impl.rm(root, { recursive: true, force: true })
        )
    )
  })

  const testPath = (...parts: string[]) => {
    if (parts.length === 1) {
      roots.push(parts[0])
    }
    return nodeFileSystem.impl.join(...parts)
  }

  const createRuntime = (backing: IZooDesignStudioFS) => {
    const runtime = createFileSystemRuntime(backing)
    runtimes.push(runtime)
    return runtime
  }

  it('runs mutations for one path in submission order', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-order-${crypto.randomUUID()}`
      )
    )
    const path = testPath(root, 'main.kcl')
    const firstWrite = createGate()
    const events: string[] = []
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      writeFile: async (_path, contents) => {
        const value = new TextDecoder().decode(contents)
        events.push(`start:${value}`)
        if (value === 'first') {
          await firstWrite.promise
        }
        events.push(`end:${value}`)
      },
    }
    const runtime = createRuntime(backing)

    const first = runtime.operations.writeFile(
      path,
      new TextEncoder().encode('first')
    )
    await vi.waitFor(() => expect(events).toEqual(['start:first']))
    const second = runtime.operations.writeFile(
      path,
      new TextEncoder().encode('second')
    )

    await vi.waitFor(async () =>
      expect(await runtime.operations.pending()).toBe(2)
    )
    expect(events).toEqual(['start:first'])

    firstWrite.open()
    await Promise.all([first, second])

    expect(events).toEqual([
      'start:first',
      'end:first',
      'start:second',
      'end:second',
    ])
    await expect(runtime.operations.pending()).resolves.toBe(0)
  })

  it('allows mutations of sibling files to proceed concurrently', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-concurrency-${crypto.randomUUID()}`
      )
    )
    const firstPath = testPath(root, 'first.kcl')
    const secondPath = testPath(root, 'second.kcl')
    const firstWrite = createGate()
    const started: string[] = []
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      writeFile: async (path) => {
        started.push(nodeFileSystem.impl.basename(path))
        if (path === firstPath) {
          await firstWrite.promise
        }
      },
    }
    const runtime = createRuntime(backing)

    const first = runtime.operations.writeFile(
      firstPath,
      new TextEncoder().encode('first')
    )
    await vi.waitFor(() => expect(started).toEqual(['first.kcl']))
    const second = runtime.operations.writeFile(
      secondPath,
      new TextEncoder().encode('second')
    )

    await vi.waitFor(() => expect(started).toEqual(['first.kcl', 'second.kcl']))

    firstWrite.open()
    await Promise.all([first, second])
  })

  it('reads a complete version after an in-flight write', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-read-write-${crypto.randomUUID()}`
      )
    )
    const path = testPath(root, 'main.kcl')
    const writeStarted = createGate()
    const finishWrite = createGate()
    const events: string[] = []
    let stored = new TextEncoder().encode('previous')
    const readFile = mockReadFile(() => {
      events.push('read')
      return new Uint8Array(stored)
    })
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      readFile,
      writeFile: async (_path, contents) => {
        events.push('write:start')
        stored = contents.slice(0, Math.floor(contents.length / 2))
        writeStarted.open()
        await finishWrite.promise
        stored = new Uint8Array(contents)
        events.push('write:end')
      },
    }
    const runtime = createRuntime(backing)
    const expected = new TextEncoder().encode('complete next version')

    const write = runtime.operations.writeFile(path, expected)
    await writeStarted.promise
    const read = runtime.operations.readFile(path)
    setTimeout(finishWrite.open, 0)

    await expect(read).resolves.toEqual(expected)
    await write
    expect(events).toEqual(['write:start', 'write:end', 'read'])
  })

  it('allows a read on an unrelated path during a write', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-read-concurrency-${crypto.randomUUID()}`
      )
    )
    const blockedPath = testPath(root, 'blocked.kcl')
    const readablePath = testPath(root, 'readable.kcl')
    const finishWrite = createGate()
    const writeStarted = createGate()
    const events: string[] = []
    const readFile = mockReadFile(() => {
      events.push('read')
      return new TextEncoder().encode('readable')
    })
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      readFile,
      writeFile: async () => {
        events.push('write:start')
        writeStarted.open()
        await finishWrite.promise
        events.push('write:end')
      },
    }
    const runtime = createRuntime(backing)

    const write = runtime.operations.writeFile(
      blockedPath,
      new TextEncoder().encode('blocked')
    )
    await writeStarted.promise

    await expect(runtime.operations.readFile(readablePath)).resolves.toEqual(
      new TextEncoder().encode('readable')
    )
    expect(events).toEqual(['write:start', 'read'])

    finishWrite.open()
    await write
  })

  it('makes a project rename wait for a read beneath the project', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-project-${crypto.randomUUID()}`
      )
    )
    const project = testPath(root, 'project')
    const destination = testPath(root, 'renamed-project')
    const path = testPath(project, 'src', 'main.kcl')
    const finishRead = createGate()
    const readStarted = createGate()
    const events: string[] = []
    const readFile = mockReadFile(async () => {
      events.push('read:start')
      readStarted.open()
      await finishRead.promise
      events.push('read:end')
      return new Uint8Array()
    })
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      readFile,
      rename: async () => {
        events.push('rename')
      },
    }
    const runtime = createRuntime(backing)

    const read = runtime.operations.readFile(path)
    await readStarted.promise
    const rename = runtime.operations.rename(project, destination)
    setTimeout(finishRead.open, 0)

    await Promise.all([read, rename])
    expect(events).toEqual(['read:start', 'read:end', 'rename'])
  })

  it('releases locks and pending state after a failed operation', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-failure-${crypto.randomUUID()}`
      )
    )
    const path = testPath(root, 'main.kcl')
    const events: string[] = []
    const failure = Object.assign(new Error('disk unavailable'), {
      code: 'EIO',
    })
    let attempts = 0
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      writeFile: async () => {
        attempts += 1
        events.push(`attempt:${attempts}`)
        if (attempts === 1) {
          return Promise.reject(failure)
        }
      },
    }
    const runtime = createRuntime(backing)

    const first = runtime.operations.writeFile(
      path,
      new TextEncoder().encode('first')
    )
    const second = runtime.operations.writeFile(
      path,
      new TextEncoder().encode('second')
    )

    await expect(first).rejects.toEqual(
      expect.objectContaining({ _tag: 'FileIoFailure', cause: failure })
    )
    await expect(second).resolves.toBeUndefined()
    expect(events).toEqual(['attempt:1', 'attempt:2'])
    await expect(runtime.operations.pending()).resolves.toBe(0)
  })

  it('rejects a colliding directory creation', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-directory-${crypto.randomUUID()}`
      )
    )
    const path = testPath(root, 'parts')
    const runtime = createRuntime(nodeFileSystem.impl)

    await runtime.operations.createDirectory(path)

    await expect(
      runtime.operations.createDirectory(path)
    ).rejects.toBeInstanceOf(FileAlreadyExists)
  })

  it('creates unique directories without concurrent name collisions', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-unique-directory-${crypto.randomUUID()}`
      )
    )
    const runtime = createRuntime(nodeFileSystem.impl)

    const created = await Promise.all([
      runtime.operations.createUniqueDirectory(root, 'untitled'),
      runtime.operations.createUniqueDirectory(root, 'untitled'),
      runtime.operations.createUniqueDirectory(root, 'untitled'),
    ])

    expect(created).toEqual([
      nodeFileSystem.impl.join(root, 'untitled'),
      nodeFileSystem.impl.join(root, 'untitled-1'),
      nodeFileSystem.impl.join(root, 'untitled-2'),
    ])
    await expect(runtime.service.readDirectory(root)).resolves.toEqual([
      { name: 'untitled', kind: 'directory' },
      { name: 'untitled-1', kind: 'directory' },
      { name: 'untitled-2', kind: 'directory' },
    ])
  })

  it('rejects a colliding file creation without overwriting it', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-create-file-${crypto.randomUUID()}`
      )
    )
    const path = testPath(root, 'main.kcl')
    const runtime = createRuntime(nodeFileSystem.impl)

    await runtime.operations.createFile(path, new TextEncoder().encode('first'))

    await expect(
      runtime.operations.createFile(path, new TextEncoder().encode('second'))
    ).rejects.toEqual(
      expect.objectContaining({
        _tag: 'FileAlreadyExists',
        operation: 'create-file',
        path,
      })
    )
    expect(new TextDecoder().decode(await runtime.service.readFile(path))).toBe(
      'first'
    )
  })

  it('allocates concurrent unique filenames without changing their full extensions', async () => {
    const segmentArbitrary = fc
      .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'), {
        minLength: 1,
        maxLength: 12,
      })
      .map((characters) => characters.join(''))
    const extensionArbitrary = fc.constantFrom('', '.kcl', '.step', '.prt.1')
    const occupiedCountArbitrary = fc.integer({ min: 0, max: 4 })
    const countArbitrary = fc.integer({ min: 1, max: 6 })
    const runtime = createRuntime(nodeFileSystem.impl)

    await fc.assert(
      fc.asyncProperty(
        segmentArbitrary,
        extensionArbitrary,
        occupiedCountArbitrary,
        countArbitrary,
        async (stem, extension, occupiedCount, count) => {
          const root = testPath(
            nodeFileSystem.impl.join(
              tmpdir(),
              `zds-file-operations-unique-file-${crypto.randomUUID()}`
            )
          )
          const contents = Array.from({ length: count }, (_, index) =>
            new TextEncoder().encode(String(index))
          )
          const candidatePath = (index: number) =>
            nodeFileSystem.impl.join(
              root,
              `${stem}${index === 0 ? '' : `-${index}`}${extension}`
            )

          for (let index = 0; index < occupiedCount; index++) {
            await runtime.operations.createFile(
              candidatePath(index),
              new TextEncoder().encode(`occupied-${index}`)
            )
          }

          const created = await Promise.all(
            contents.map((content) =>
              runtime.operations.createUniqueFile(
                root,
                { stem, extension },
                content
              )
            )
          )

          expect(new Set(created).size).toBe(count)
          expect(new Set(created)).toEqual(
            new Set(
              Array.from({ length: count }, (_, index) =>
                candidatePath(occupiedCount + index)
              )
            )
          )
          await Promise.all(
            created.map(async (path, index) => {
              const written = await runtime.service.readFile(path)
              expect(new TextDecoder().decode(written)).toBe(String(index))
            })
          )
          await Promise.all(
            Array.from({ length: occupiedCount }, async (_, index) => {
              const written = await runtime.service.readFile(
                candidatePath(index)
              )
              expect(new TextDecoder().decode(written)).toBe(
                `occupied-${index}`
              )
            })
          )
        }
      ),
      { numRuns: 30 }
    )
  })
})
