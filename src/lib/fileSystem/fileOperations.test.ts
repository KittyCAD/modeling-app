import { tmpdir } from 'node:os'
import type * as ClientErrorsModule from '@src/lib/clientErrors'
import { FileAlreadyExists } from '@src/lib/fileSystem/fileOperations'
import {
  createFileOperationsRuntime,
  type FileOperationsRuntime,
} from '@src/lib/fileSystem/runtime'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import nodeFileSystem from '@src/lib/fs-zds/nodefs'
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clientErrorMocks = vi.hoisted(() => ({
  reportClientError: vi.fn(),
}))

vi.mock('@src/lib/clientErrors', async (importOriginal) => {
  const original = await importOriginal<typeof ClientErrorsModule>()
  return {
    ...original,
    reportClientError: clientErrorMocks.reportClientError,
  }
})

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
  const runtimes: FileOperationsRuntime[] = []
  const roots: string[] = []

  beforeEach(() => {
    clientErrorMocks.reportClientError.mockClear()
  })

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
    const runtime = createFileOperationsRuntime(backing)
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
    const secondContents = new TextEncoder().encode('second')
    const second = runtime.operations.writeFile(path, secondContents)

    await vi.waitFor(async () =>
      expect(await runtime.operations.pending()).toBe(2)
    )
    secondContents.fill('x'.charCodeAt(0))
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

  it('accepts UTF-8 strings for every file-writing operation', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-text-${crypto.randomUUID()}`
      )
    )
    const textPath = testPath(root, 'text.kcl')
    const bytesPath = testPath(root, 'bytes.kcl')
    const malformedPath = testPath(root, 'malformed.kcl')
    const text = 'café 🐈 — 図面'
    const runtime = createRuntime(nodeFileSystem.impl)

    await runtime.operations.writeFile(textPath, text)
    await runtime.operations.writeFile(
      bytesPath,
      new TextEncoder().encode(text)
    )
    await runtime.operations.createFile(malformedPath, '\ud800')
    const uniquePath = await runtime.operations.createUniqueFile(
      root,
      { stem: 'generated', extension: '.kcl' },
      'λ'
    )

    const [textBytes, explicitBytes, malformedBytes, uniqueBytes] =
      await Promise.all([
        runtime.operations.readFile(textPath),
        runtime.operations.readFile(bytesPath),
        runtime.operations.readFile(malformedPath),
        runtime.operations.readFile(uniquePath),
      ])

    expect([...textBytes]).toEqual([...explicitBytes])
    expect(new TextDecoder().decode(textBytes)).toBe(text)
    expect([...malformedBytes]).toEqual([0xef, 0xbf, 0xbd])
    expect(new TextDecoder().decode(uniqueBytes)).toBe('λ')
  })

  it('forwards explicit copy collision policy to the backing', async () => {
    const copy = vi.fn<IZooDesignStudioFS['cp']>()
    const runtime = createRuntime({ ...nodeFileSystem.impl, cp: copy })

    await runtime.operations.copy('/source', '/destination', {
      overwrite: false,
    })

    expect(copy).toHaveBeenCalledWith('/source', '/destination', {
      recursive: true,
      force: false,
    })
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
    await nodeFileSystem.impl.mkdir(root, { recursive: true })
    await Promise.all([
      nodeFileSystem.impl.writeFile(firstPath, new Uint8Array()),
      nodeFileSystem.impl.writeFile(secondPath, new Uint8Array()),
    ])
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

  it('reads directory membership only after an in-flight child creation finishes', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-directory-read-${crypto.randomUUID()}`
      )
    )
    const child = testPath(root, 'parts')
    await nodeFileSystem.impl.mkdir(root, { recursive: true })
    const finishCreate = createGate()
    const createStarted = createGate()
    const events: string[] = []
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      mkdir: async (path, options) => {
        if (path === child) {
          events.push('create:start')
          createStarted.open()
          await finishCreate.promise
          events.push('create:end')
        }
        await nodeFileSystem.impl.mkdir(path, options)
      },
      readdir: async (path) => {
        events.push('read-directory')
        return nodeFileSystem.impl.readdir(path)
      },
    }
    const runtime = createRuntime(backing)

    const create = runtime.operations.createDirectory(child)
    await createStarted.promise
    const read = runtime.operations.readDirectory(root)
    setTimeout(finishCreate.open, 0)

    await expect(read).resolves.toEqual([{ name: 'parts', kind: 'directory' }])
    await create
    expect(events).toEqual(['create:start', 'create:end', 'read-directory'])
  })

  it('makes a parent rename wait for a write beneath it', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-parent-write-${crypto.randomUUID()}`
      )
    )
    const project = testPath(root, 'project')
    const destination = testPath(root, 'renamed-project')
    const path = testPath(project, 'src', 'main.kcl')
    await nodeFileSystem.impl.mkdir(nodeFileSystem.impl.dirname(path), {
      recursive: true,
    })
    await nodeFileSystem.impl.writeFile(path, new Uint8Array())
    const finishWrite = createGate()
    const writeStarted = createGate()
    const events: string[] = []
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      writeFile: async (target, contents) => {
        events.push('write:start')
        writeStarted.open()
        await finishWrite.promise
        await nodeFileSystem.impl.writeFile(target, contents)
        events.push('write:end')
      },
      rename: async (source, target) => {
        events.push('rename')
        await nodeFileSystem.impl.rename(source, target)
      },
    }
    const runtime = createRuntime(backing)

    const write = runtime.operations.writeFile(
      path,
      new TextEncoder().encode('updated')
    )
    await writeStarted.promise
    const rename = runtime.operations.rename(project, destination)
    setTimeout(finishWrite.open, 0)

    await Promise.all([write, rename])
    expect(events).toEqual(['write:start', 'write:end', 'rename'])
    const written = await runtime.operations.readFile(
      nodeFileSystem.impl.join(destination, 'src', 'main.kcl')
    )
    expect(new TextDecoder().decode(written)).toBe('updated')
  })

  it('keeps a cross-device move coordinated with writes beneath its source', async () => {
    const root = testPath(
      nodeFileSystem.impl.join(
        tmpdir(),
        `zds-file-operations-move-${crypto.randomUUID()}`
      )
    )
    const project = testPath(root, 'project')
    const destination = testPath(root, 'archive', 'project')
    const sourceFile = testPath(project, 'src', 'main.kcl')
    const destinationFile = testPath(destination, 'src', 'main.kcl')
    await nodeFileSystem.impl.mkdir(nodeFileSystem.impl.dirname(sourceFile), {
      recursive: true,
    })
    await nodeFileSystem.impl.writeFile(
      sourceFile,
      new TextEncoder().encode('previous')
    )
    const finishWrite = createGate()
    const writeStarted = createGate()
    const events: string[] = []
    const backing: IZooDesignStudioFS = {
      ...nodeFileSystem.impl,
      writeFile: async (target, contents) => {
        events.push('write:start')
        writeStarted.open()
        await finishWrite.promise
        await nodeFileSystem.impl.writeFile(target, contents)
        events.push('write:end')
      },
      rename: async () => {
        events.push('rename')
        return Promise.reject(
          Object.assign(new Error('Cross-device rename'), { code: 'EXDEV' })
        )
      },
      cp: async (source, target, options) => {
        events.push('copy')
        await nodeFileSystem.impl.cp(source, target, options)
      },
      rm: async (path, options) => {
        events.push('remove')
        await nodeFileSystem.impl.rm(path, options)
      },
    }
    const runtime = createRuntime(backing)

    const write = runtime.operations.writeFile(sourceFile, 'updated')
    await writeStarted.promise
    const move = runtime.operations.move(project, destination)
    setTimeout(finishWrite.open, 0)

    await Promise.all([write, move])
    expect(events).toEqual([
      'write:start',
      'write:end',
      'rename',
      'copy',
      'remove',
    ])
    expect(
      new TextDecoder().decode(
        await runtime.operations.readFile(destinationFile)
      )
    ).toBe('updated')
    await expect(runtime.operations.exists(project)).resolves.toBe(false)
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
    expect(clientErrorMocks.reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'file_operations_error',
        errorName: 'FileIoFailure',
        message: 'FileOperations operation failed during write-file.',
        extra: expect.objectContaining({
          operation: 'write-file',
          fileSystemOperation: 'write-file',
          errorType: 'FileIoFailure',
          causeCode: 'EIO',
        }),
      })
    )
    const reports = JSON.stringify(
      clientErrorMocks.reportClientError.mock.calls
    )
    expect(reports).not.toContain(path)
    expect(reports).not.toContain(failure.message)
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
    expect(clientErrorMocks.reportClientError).not.toHaveBeenCalled()
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
    await expect(runtime.operations.readDirectory(root)).resolves.toEqual([
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
    expect(
      new TextDecoder().decode(await runtime.operations.readFile(path))
    ).toBe('first')
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
              const written = await runtime.operations.readFile(path)
              expect(new TextDecoder().decode(written)).toBe(String(index))
            })
          )
          await Promise.all(
            Array.from({ length: occupiedCount }, async (_, index) => {
              const written = await runtime.operations.readFile(
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
