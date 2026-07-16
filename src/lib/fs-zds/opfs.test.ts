import path from 'path'
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

  async removeEntry(name: string) {
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
  const projectPath = path.resolve('projects', 'project')
  const metaPath = path.resolve(projectPath, '._meta')

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

  test('merges copied directories into an existing target tree', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source.addDirectory('nested').addFile('source.kcl', 'source')
    const target = projects.addDirectory('target')
    target.addDirectory('nested').addFile('existing.kcl', 'existing')
    const opfs = await getOpfs()

    await opfs.impl.cp(
      path.resolve('projects', 'source'),
      path.resolve('projects', 'target'),
      { recursive: true }
    )

    await expect(
      opfs.impl.readFile(
        path.resolve('projects', 'target', 'nested', 'source.kcl'),
        { encoding: 'utf-8' }
      )
    ).resolves.toBe('source')
    await expect(
      opfs.impl.readFile(
        path.resolve('projects', 'target', 'nested', 'existing.kcl'),
        { encoding: 'utf-8' }
      )
    ).resolves.toBe('existing')
  })

  test('rejects copying a directory to itself or one of its descendants', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source.addFile('main.kcl', 'source')
    const opfs = await getOpfs()
    const sourcePath = path.resolve('projects', 'source')

    await expect(opfs.impl.cp(sourcePath, sourcePath)).rejects.toBe('EINVAL')
    await expect(
      opfs.impl.cp(sourcePath, path.resolve(sourcePath, 'nested-copy'))
    ).rejects.toBe('EINVAL')
    expect(source.children.has('nested-copy')).toBe(false)
  })

  test('walks through exact path components instead of prefix siblings', async () => {
    const projects = root.addDirectory('projects')
    projects.addDirectory('project')
    const intended = projects.addDirectory('project-copy')
    intended.addFile('main.kcl', 'intended')
    const opfs = await getOpfs()

    await expect(
      opfs.impl.readFile(path.resolve('projects', 'project-copy', 'main.kcl'), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('intended')
  })

  test('creates a shallow absolute directory at the correct level', async () => {
    const opfs = await getOpfs()

    await opfs.impl.mkdir(path.resolve('/documents/Projects'), {
      recursive: true,
    })

    const documents = root.children.get('documents')
    expect(documents).toBeInstanceOf(MockFileSystemDirectoryHandle)
    expect(
      (documents as MockFileSystemDirectoryHandle).children.get('Projects')
    ).toBeInstanceOf(MockFileSystemDirectoryHandle)
    expect(root.children.has('Projects')).toBe(false)
  })

  test('checks whether a path exists', async () => {
    root.addDirectory('projects').addDirectory('source')
    const opfs = await getOpfs()

    await expect(
      opfs.impl.access(path.resolve('projects', 'source'), 0)
    ).resolves.toBeUndefined()
    await expect(
      opfs.impl.access(path.resolve('projects', 'missing'), 0)
    ).rejects.toBe('ENOENT')
  })

  test('allows forced removal of a missing path', async () => {
    root.addDirectory('projects')
    const opfs = await getOpfs()

    await expect(
      opfs.impl.rm(path.resolve('projects', 'missing'), { force: true })
    ).resolves.toBeUndefined()
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

  test('removes a newly created directory target when rename copying fails', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    const sourceFile = source.addFile('source.kcl', 'source')
    vi.spyOn(sourceFile, 'getFile').mockRejectedValue(
      new Error('simulated read failure')
    )
    const opfs = await getOpfs()

    await expect(
      opfs.impl.rename(
        path.resolve('projects', 'source'),
        path.resolve('projects', 'target')
      )
    ).rejects.toThrow('simulated read failure')
    expect(projects.children.has('target')).toBe(false)
    expect(projects.children.get('source')).toBe(source)
  })

  test('removes a newly created file target when rename writing fails', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addFile('source.kcl', 'source')
    const originalGetFileHandle = projects.getFileHandle.bind(projects)
    vi.spyOn(projects, 'getFileHandle').mockImplementation(
      async (name, options) => {
        const handle = await originalGetFileHandle(name, options)
        if (name === 'target.kcl') {
          vi.spyOn(handle, 'createWritable').mockResolvedValue({
            write: async () => {
              throw new Error('simulated write failure')
            },
            close: async () => {},
          })
        }
        return handle
      }
    )
    const opfs = await getOpfs()

    await expect(
      opfs.impl.rename(
        path.resolve('projects', 'source.kcl'),
        path.resolve('projects', 'target.kcl')
      )
    ).rejects.toThrow('simulated write failure')
    expect(projects.children.has('target.kcl')).toBe(false)
    expect(projects.children.get('source.kcl')).toBe(source)
  })

  test('removes the target when rename cannot remove its source', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source.addFile('source.kcl', 'source')
    const originalRemoveEntry = projects.removeEntry.bind(projects)
    vi.spyOn(projects, 'removeEntry').mockImplementation(async (name) => {
      if (name === 'source') {
        throw new Error('simulated remove failure')
      }
      await originalRemoveEntry(name)
    })
    const opfs = await getOpfs()

    await expect(
      opfs.impl.rename(
        path.resolve('projects', 'source'),
        path.resolve('projects', 'target')
      )
    ).rejects.toThrow('simulated remove failure')
    expect(projects.children.has('target')).toBe(false)
    expect(projects.children.get('source')).toBe(source)
  })

  test('serializes competing renames to the same target', async () => {
    const projects = root.addDirectory('projects')
    const firstSource = projects.addDirectory('first-source')
    firstSource.addFile('first.kcl', 'first')
    const secondSource = projects.addDirectory('second-source')
    secondSource.addFile('second.kcl', 'second')
    const request = installSerializedLockManager()
    const opfs = await getOpfs()
    const targetPath = path.resolve('projects', 'target')

    const results = await Promise.allSettled([
      opfs.impl.rename(path.resolve('projects', 'first-source'), targetPath),
      opfs.impl.rename(path.resolve('projects', 'second-source'), targetPath),
    ])

    expect(results[0].status).toBe('fulfilled')
    expect(results[1]).toEqual({ status: 'rejected', reason: 'EEXIST' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(projects.children.has('first-source')).toBe(false)
    expect(projects.children.get('second-source')).toBe(secondSource)
    await expect(
      opfs.impl.readFile(path.resolve(targetPath, 'first.kcl'), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('first')
  })
})
