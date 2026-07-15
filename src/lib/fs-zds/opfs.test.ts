import path from 'path'
import { PUBLISH_DIRECTORY_DESTINATION_EXISTS } from '@src/lib/fs-zds/errors'
import { DUPLICATE_IN_PROGRESS_FILE_NAME } from '@src/lib/constants'
import { createDuplicatePublicationEvidence } from '@src/lib/fs-zds/duplicateReservations'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@src/lib/fs-zds/opfsWriteWorker.ts?worker', () => ({
  default: class MockOPFSWriteWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null

    postMessage() {}

    terminate() {}
  },
}))

class MockFileSystemFileHandle {
  data: Uint8Array<ArrayBuffer>
  lastModified = Date.now()

  constructor(
    public name: string,
    contents = ''
  ) {
    this.data = new TextEncoder().encode(contents)
  }

  async getFile() {
    const data = this.data
    const lastModified = this.lastModified
    return {
      size: data.byteLength,
      lastModified,
      text: async () => new TextDecoder().decode(data),
      arrayBuffer: async () => data.slice().buffer,
    } as File
  }

  async isSameEntry(other: FileSystemHandle) {
    return other === (this as unknown as FileSystemHandle)
  }

  async createWritable() {
    return {
      write: async (blob: Blob) => {
        this.data = new Uint8Array(await blob.arrayBuffer())
        this.lastModified = Date.now()
      },
      close: async () => {},
    }
  }
}

class MockFileSystemDirectoryHandle {
  children = new Map<
    string,
    MockFileSystemDirectoryHandle | MockFileSystemFileHandle
  >()

  constructor(public name: string) {}

  async isSameEntry(other: FileSystemHandle) {
    return other === (this as unknown as FileSystemHandle)
  }

  async *entries() {
    for (const entry of this.children) {
      yield entry
    }
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.children.get(name)
    if (existing instanceof MockFileSystemDirectoryHandle) {
      return existing
    }
    if (!options?.create) {
      throw new Error('NotFoundError')
    }

    const next = new MockFileSystemDirectoryHandle(name)
    this.children.set(name, next)
    return next
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.children.get(name)
    if (existing instanceof MockFileSystemFileHandle) {
      return existing
    }
    if (!options?.create) {
      throw new Error('NotFoundError')
    }

    const next = new MockFileSystemFileHandle(name)
    this.children.set(name, next)
    return next
  }

  async removeEntry(name: string, options?: { recursive?: boolean }) {
    const existing = this.children.get(name)
    if (
      existing instanceof MockFileSystemDirectoryHandle &&
      existing.children.size > 0 &&
      !options?.recursive
    ) {
      throw new Error('InvalidModificationError')
    }
    this.children.delete(name)
  }

  addDirectory(name: string) {
    const next = new MockFileSystemDirectoryHandle(name)
    this.children.set(name, next)
    return next
  }

  addFile(name: string, contents = '') {
    const next = new MockFileSystemFileHandle(name, contents)
    this.children.set(name, next)
    return next
  }
}

describe('opfs', () => {
  let root: MockFileSystemDirectoryHandle
  const publicationEvidence = createDuplicatePublicationEvidence({
    token: '11111111-1111-4111-8111-111111111111',
    targetName: 'target',
    createdAt: 1,
  })
  const projectPath = path.resolve('projects', 'project')
  const metaPath = path.resolve(projectPath, '._meta')

  function installSerializedLockManager() {
    const lockTails = new Map<string, Promise<unknown>>()
    const request = vi.fn(
      async (name: string, callback: (lock: Lock) => Promise<unknown>) => {
        const previous = lockTails.get(name) ?? Promise.resolve()
        const current = previous
          .catch(() => undefined)
          .then(() => callback({ name, mode: 'exclusive' }))
        lockTails.set(name, current)
        try {
          return await current
        } finally {
          if (lockTails.get(name) === current) {
            lockTails.delete(name)
          }
        }
      }
    )
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: { request },
    })
    return request
  }

  beforeEach(() => {
    vi.resetModules()
    root = new MockFileSystemDirectoryHandle('')
    vi.stubGlobal('FileSystemDirectoryHandle', MockFileSystemDirectoryHandle)
    vi.stubGlobal('FileSystemFileHandle', MockFileSystemFileHandle)
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: vi.fn(async () => root),
      },
    })
    installSerializedLockManager()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(globalThis.navigator, 'locks')
  })

  async function getOpfs() {
    return (await import('@src/lib/fs-zds/opfs')).default
  }

  function addProjectWithMeta(contents: string) {
    const projects = root.addDirectory('projects')
    const project = projects.addDirectory('project')
    project.addFile('._meta', contents)
    return project
  }

  test('repairs empty directory metadata during stat', async () => {
    addProjectWithMeta('')
    const opfs = await getOpfs()

    const stat = await opfs.impl.stat(projectPath)
    const repaired = await opfs.impl.readFile(metaPath, {
      encoding: 'utf-8',
    })

    expect(stat.mtimeMs).toEqual(expect.any(Number))
    expect(JSON.parse(repaired)).toEqual({ mtimeMs: stat.mtimeMs })
  })

  test('repairs malformed directory metadata during stat', async () => {
    addProjectWithMeta('{"mtimeMs":"not-a-number"}')
    const opfs = await getOpfs()

    const stat = await opfs.impl.stat(projectPath)
    const repaired = await opfs.impl.readFile(metaPath, {
      encoding: 'utf-8',
    })

    expect(stat.mtimeMs).toEqual(expect.any(Number))
    expect(JSON.parse(repaired)).toEqual({ mtimeMs: stat.mtimeMs })
  })

  test('copies files in deeply nested directories', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    const nested = source.addDirectory('nested')
    const deeper = nested.addDirectory('deeper')
    deeper.addFile('part.kcl', 'nested part')
    nested.addDirectory('empty')
    const opfs = await getOpfs()
    const targetPath = path.resolve('projects', 'duplicate')

    await opfs.impl.cp(path.resolve('projects', 'source'), targetPath, {
      recursive: true,
    })

    await expect(
      opfs.impl.readFile(path.resolve(targetPath, 'nested/deeper/part.kcl'), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('nested part')
    await expect(
      opfs.impl.readdir(path.resolve(targetPath, 'nested/empty'))
    ).resolves.toEqual([])
  })

  test('does not create a directory over an existing path', async () => {
    const projects = root.addDirectory('projects')
    const existing = projects.addDirectory('existing')
    existing.addFile('keep.kcl', 'keep me')
    const opfs = await getOpfs()
    const existingPath = path.resolve('projects', 'existing')

    await expect(opfs.impl.mkdir(existingPath)).rejects.toBe('EEXIST')
    await expect(
      opfs.impl.readFile(path.resolve(existingPath, 'keep.kcl'), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('keep me')
  })

  test('does not merge a rename into an existing directory', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source.addFile('source.kcl', 'source')
    const target = projects.addDirectory('target')
    target.addFile('keep.kcl', 'keep me')
    const opfs = await getOpfs()
    const sourcePath = path.resolve('projects', 'source')
    const targetPath = path.resolve('projects', 'target')

    await expect(opfs.impl.rename(sourcePath, targetPath)).rejects.toBe(
      'EEXIST'
    )
    await expect(
      opfs.impl.readFile(path.resolve(targetPath, 'keep.kcl'), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('keep me')
    await expect(
      opfs.impl.readFile(path.resolve(sourcePath, 'source.kcl'), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('source')
  })

  test('does not publish into an existing empty directory', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source.addFile('source.kcl', 'source')
    const target = projects.addDirectory('target')
    const opfs = await getOpfs()
    const sourcePath = path.resolve('projects', 'source')
    const targetPath = path.resolve('projects', 'target')

    await expect(
      opfs.impl.publishDirectory(sourcePath, targetPath, publicationEvidence)
    ).rejects.toBe(PUBLISH_DIRECTORY_DESTINATION_EXISTS)

    expect(projects.children.get('target')).toBe(target)
    expect(target.children.size).toBe(0)
    await expect(
      opfs.impl.readFile(path.resolve(sourcePath, 'source.kcl'), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('source')
  })

  test('preserves its reservation when marker creation fails', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source.addFile('source.kcl', 'source')
    const originalGetDirectoryHandle =
      projects.getDirectoryHandle.bind(projects)
    vi.spyOn(projects, 'getDirectoryHandle').mockImplementation(
      async (name, options) => {
        const directory = await originalGetDirectoryHandle(name, options)
        if (name === 'target') {
          vi.spyOn(directory, 'getFileHandle').mockRejectedValueOnce(
            new Error('simulated marker failure')
          )
        }
        return directory
      }
    )
    const opfs = await getOpfs()
    const sourcePath = path.resolve('projects', 'source')
    const targetPath = path.resolve('projects', 'target')

    await expect(
      opfs.impl.publishDirectory(sourcePath, targetPath, publicationEvidence)
    ).rejects.toThrow('simulated marker failure')

    expect(projects.children.get('target')).toBeInstanceOf(
      MockFileSystemDirectoryHandle
    )
    expect(projects.children.get('source')).toBe(source)
  })

  test('keeps a failed publication hidden without deleting either directory', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    const nested = source.addDirectory('nested')
    const sourceFile = nested.addFile('source.kcl', 'source')
    vi.spyOn(sourceFile, 'getFile').mockRejectedValue(
      new Error('simulated read failure')
    )
    const opfs = await getOpfs()
    const sourcePath = path.resolve('projects', 'source')
    const targetPath = path.resolve('projects', 'target')

    await expect(
      opfs.impl.publishDirectory(sourcePath, targetPath, publicationEvidence)
    ).rejects.toThrow('simulated read failure')

    expect(projects.children.get('source')).toBe(source)
    expect(projects.children.get('target')).toBeInstanceOf(
      MockFileSystemDirectoryHandle
    )
    await expect(
      opfs.impl.readFile(
        path.resolve(targetPath, DUPLICATE_IN_PROGRESS_FILE_NAME),
        {
          encoding: 'utf-8',
        }
      )
    ).resolves.toContain('"phase":"publishing"')
  })

  test('leaves the marker for transactional finalization after a complete publication', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source.addFile('source.kcl', 'source')
    const opfs = await getOpfs()
    const sourcePath = path.resolve('projects', 'source')
    const targetPath = path.resolve('projects', 'target')

    await opfs.impl.publishDirectory(
      sourcePath,
      targetPath,
      publicationEvidence
    )

    await expect(
      opfs.impl.readFile(path.resolve(targetPath, 'source.kcl'), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('source')
    await expect(
      opfs.impl.readFile(
        path.resolve(targetPath, DUPLICATE_IN_PROGRESS_FILE_NAME),
        {
          encoding: 'utf-8',
        }
      )
    ).resolves.toContain('"phase":"publishing"')
    await expect(
      opfs.impl.readFile(path.resolve(sourcePath, 'source.kcl'), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('source')
  })

  test('never deletes a rename target by pathname when copying fails', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    const sourceFile = source.addFile('source.kcl', 'source')
    vi.spyOn(sourceFile, 'getFile').mockRejectedValue(
      new Error('simulated read failure')
    )
    const opfs = await getOpfs()
    const sourcePath = path.resolve('projects', 'source')
    const targetPath = path.resolve('projects', 'target')

    await expect(opfs.impl.rename(sourcePath, targetPath)).rejects.toThrow(
      'simulated read failure'
    )
    await expect(opfs.impl.stat(targetPath)).resolves.toBeDefined()
    expect(projects.children.get('source')).toBe(source)
  })

  test('serializes rename publication with a destination Web Lock', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source.addFile('source.kcl', 'source')
    const request = installSerializedLockManager()
    const opfs = await getOpfs()
    const sourcePath = path.resolve('projects', 'source')
    const targetPath = path.resolve('projects', 'target')

    await opfs.impl.rename(sourcePath, targetPath)

    expect(request).toHaveBeenCalledWith(
      `zds:opfs:path-mutation:${targetPath.replaceAll('\\', '/')}`,
      expect.any(Function)
    )
    await expect(
      opfs.impl.readFile(path.resolve(targetPath, 'source.kcl'), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('source')
  })

  test('keeps a concurrent mkdir out of a rename-owned target', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    const sourceFile = source.addFile('source.kcl', 'source')
    let rejectSourceRead!: (error: Error) => void
    let resolveSourceReadStarted!: () => void
    const sourceReadStarted = new Promise<void>((resolve) => {
      resolveSourceReadStarted = resolve
    })
    vi.spyOn(sourceFile, 'getFile').mockImplementation(async () => {
      resolveSourceReadStarted()
      return new Promise<never>((_resolve, reject) => {
        rejectSourceRead = reject
      })
    })
    const opfs = await getOpfs()
    const sourcePath = path.resolve('projects', 'source')
    const targetPath = path.resolve('projects', 'target')

    const renamePromise = opfs.impl.rename(sourcePath, targetPath)
    await sourceReadStarted
    let mkdirSettled = false
    const mkdirPromise = opfs.impl.mkdir(targetPath).finally(() => {
      mkdirSettled = true
    })
    await Promise.resolve()
    expect(mkdirSettled).toBe(false)

    rejectSourceRead(new Error('simulated source read failure'))
    await expect(renamePromise).rejects.toThrow('simulated source read failure')
    await expect(mkdirPromise).rejects.toBe('EEXIST')
    expect(projects.children.get('target')).toBeInstanceOf(
      MockFileSystemDirectoryHandle
    )
    expect(projects.children.get('source')).toBe(source)
  })

  test('refuses rename without a cross-renderer path lock', async () => {
    Reflect.deleteProperty(globalThis.navigator, 'locks')
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source.addFile('source.kcl', 'source')
    const opfs = await getOpfs()

    await expect(
      opfs.impl.rename(
        path.resolve('projects', 'source'),
        path.resolve('projects', 'target')
      )
    ).rejects.toBe('OPFS_PATH_LOCK_UNAVAILABLE')
    expect(projects.children.has('target')).toBe(false)
    expect(projects.children.get('source')).toBe(source)
  })
})
