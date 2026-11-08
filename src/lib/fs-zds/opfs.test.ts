import path from 'path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@src/lib/fs-zds/opfsWorker.ts?worker&inline', () => ({
  default: class MockOPFSWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null

    postMessage(request: { id: number; type: string }) {
      if (request.type === 'read-file')
        queueMicrotask(() => {
          this.onmessage?.({
            data: {
              id: request.id,
              ok: true,
              data: new TextEncoder().encode('worker bytes'),
            },
          } as MessageEvent<unknown>)
        })
    }

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

  async isSameEntry(other: unknown) {
    return this === other
  }

  async createWritable() {
    return {
      write: async (data: Uint8Array<ArrayBuffer>) => {
        this.data = data.slice()
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

  async isSameEntry(other: unknown) {
    return this === other
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
    if (existing) {
      throw new DOMException('Not a directory', 'TypeMismatchError')
    }
    if (!options?.create) {
      throw new DOMException('Directory not found', 'NotFoundError')
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
    if (existing) {
      throw new DOMException('Not a file', 'TypeMismatchError')
    }
    if (!options?.create) {
      throw new DOMException('File not found', 'NotFoundError')
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
  const projectPath = path.resolve('/', 'projects', 'project')
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

  function enableWriteLocks() {
    const pending = new Map<string, Promise<unknown>>()
    const request = vi.fn((name: string, callback: () => Promise<unknown>) => {
      const next = (pending.get(name) ?? Promise.resolve()).then(callback)
      pending.set(
        name,
        next.catch(() => undefined)
      )
      return next
    })
    vi.spyOn(navigator, 'locks', 'get').mockReturnValue({
      request,
    } as unknown as LockManager)
  }

  test('reads through a worker when a browser file blob is unreadable', async () => {
    const project = addProjectWithMeta('{"mtimeMs":1}')
    const file = project.addFile('main.kcl', 'worker bytes')
    const snapshot = await file.getFile()
    vi.spyOn(file, 'getFile').mockResolvedValue({
      ...snapshot,
      text: async () =>
        Promise.reject(new DOMException('Offline blob', 'NotReadableError')),
    })
    const opfs = await getOpfs()
    await expect(
      opfs.impl.readFile(path.join(projectPath, 'main.kcl'), 'utf8')
    ).resolves.toBe('worker bytes')
    await opfs.impl.detach()
  })

  test('propagates the final failure after retrying file reads', async () => {
    const project = addProjectWithMeta('{"mtimeMs":1}')
    const file = project.addFile('main.kcl', 'bytes')
    const error = new Error('Failed file read')
    vi.spyOn(file, 'getFile').mockRejectedValue(error)
    const opfs = await getOpfs()
    vi.useFakeTimers()
    try {
      const reading = opfs.impl
        .readFile(path.join(projectPath, 'main.kcl'))
        .catch((e) => e)
      await vi.runAllTimersAsync()
      expect(await reading).toBe(error)
    } finally {
      vi.useRealTimers()
    }
  })

  test('renaming an existing file or directory to itself preserves it', async () => {
    const project = addProjectWithMeta('{"mtimeMs":1}')
    project.addFile('main.kcl', 'bytes')
    const opfs = await getOpfs()
    const file = path.join(projectPath, 'main.kcl')
    await opfs.impl.rename(file, file)
    await opfs.impl.rename(projectPath, projectPath)
    await expect(opfs.impl.readFile(file, 'utf8')).resolves.toBe('bytes')
  })

  test.each([false, true])(
    'uses native moves for file and directory aliases: directory=%s',
    async (directory) => {
      const project = addProjectWithMeta('{"mtimeMs":1}')
      const entry = directory
        ? project.addDirectory('source')
        : project.addFile('source', 'bytes')
      // Model a backing where both spellings resolve to one native entry.
      project.children.set('Source', entry)
      const move = vi.fn(async (_parent: unknown, name: string) => {
        project.children.delete('source')
        project.children.set(name, entry)
      })
      Object.assign(entry, { move })
      const opfs = await getOpfs()
      await expect(
        opfs.impl.isSameEntry?.(
          path.join(projectPath, 'source'),
          path.join(projectPath, 'Source')
        )
      ).resolves.toBe(true)
      await opfs.impl.rename(
        path.join(projectPath, 'source'),
        path.join(projectPath, 'Source')
      )
      expect(move).toHaveBeenCalledWith(project, 'Source')
      expect(project.children.get('Source')).toBe(entry)
      expect(project.children.has('source')).toBe(false)
    }
  )

  test('preserves an aliased entry when native move is unavailable', async () => {
    const project = addProjectWithMeta('{"mtimeMs":1}')
    const file = project.addFile('source.kcl', 'original bytes')
    project.children.set('Source.kcl', file)
    const opfs = await getOpfs()
    await expect(
      opfs.impl.rename(
        path.join(projectPath, 'source.kcl'),
        path.join(projectPath, 'Source.kcl')
      )
    ).rejects.toBe('ENOTSUP')
    expect(await (await file.getFile()).text()).toBe('original bytes')
    expect(project.children.get('source.kcl')).toBe(file)
  })

  test('exclusive creation preserves an existing file', async () => {
    const project = addProjectWithMeta('{"mtimeMs":1}')
    project.addFile('main.kcl', 'imported code')
    enableWriteLocks()
    const opfs = await getOpfs()
    const target = path.join(projectPath, 'main.kcl')

    await expect(
      opfs.impl.writeFile(target, new TextEncoder().encode('default code'), {
        flag: 'wx',
      })
    ).rejects.toBe('EEXIST')
    await expect(opfs.impl.readFile(target, 'utf8')).resolves.toBe(
      'imported code'
    )
  })

  test('only one concurrent exclusive creator writes a missing file', async () => {
    addProjectWithMeta('{"mtimeMs":1}')
    enableWriteLocks()
    const opfs = await getOpfs()
    const target = path.join(projectPath, 'main.kcl')

    const results = await Promise.allSettled(
      ['first code', 'second code'].map((code) =>
        opfs.impl.writeFile(target, new TextEncoder().encode(code), {
          flag: 'wx',
        })
      )
    )
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ])
    await expect(opfs.impl.readFile(target, 'utf8')).resolves.toBe('first code')
  })

  test('exclusive creation waits for a normal write and preserves its contents', async () => {
    addProjectWithMeta('{"mtimeMs":1}')
    enableWriteLocks()
    const opfs = await getOpfs()
    const target = path.join(projectPath, 'main.kcl')

    const results = await Promise.allSettled([
      opfs.impl.writeFile(target, new TextEncoder().encode('imported code')),
      opfs.impl.writeFile(target, new TextEncoder().encode('default code'), {
        flag: 'wx',
      }),
    ])
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ])
    await expect(opfs.impl.readFile(target, 'utf8')).resolves.toBe(
      'imported code'
    )
  })

  test('keeps adapter-owned metadata out of directory membership', async () => {
    const project = addProjectWithMeta('{"mtimeMs":1}')
    project.addFile('main.kcl', 'code')
    project.addFile('._metadata', 'user file')
    project.addDirectory('empty')
    const opfs = await getOpfs()
    expect((await opfs.impl.readdir(projectPath)).sort()).toEqual([
      '._metadata',
      'empty',
      'main.kcl',
    ])
    expect(await opfs.impl.readFile(metaPath, 'utf8')).toBe('{"mtimeMs":1}')
  })

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

  test('copies files from nested directories', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source
      .addDirectory('nested')
      .addDirectory('deep')
      .addFile('main.kcl', 'cube = 1')
    projects.addDirectory('target')

    const opfs = await getOpfs()
    const sourcePath = path.resolve('/', 'projects', 'source')
    const targetPath = path.resolve('/', 'projects', 'target')
    const nestedPath = path.join('nested', 'deep', 'main.kcl')

    await opfs.impl.cp(sourcePath, targetPath, {
      recursive: true,
    })

    await expect(
      opfs.impl.readFile(path.join(targetPath, nestedPath), {
        encoding: 'utf-8',
      })
    ).resolves.toBe('cube = 1')
  })

  test('requires recursive mode to copy a directory', async () => {
    const projects = root.addDirectory('projects')
    projects.addDirectory('source')
    projects.addDirectory('target')
    const opfs = await getOpfs()

    await expect(
      opfs.impl.cp(
        path.resolve('/', 'projects', 'source'),
        path.resolve('/', 'projects', 'target')
      )
    ).rejects.toBe('EISDIR')
  })

  test('preserves colliding files when copy force is false', async () => {
    const projects = root.addDirectory('projects')
    const source = projects.addDirectory('source')
    source.addFile('existing.kcl', 'source contents')
    source.addFile('new.kcl', 'new contents')
    const target = projects.addDirectory('target')
    target.addFile('existing.kcl', 'target contents')

    const opfs = await getOpfs()
    const sourcePath = path.resolve('/', 'projects', 'source')
    const targetPath = path.resolve('/', 'projects', 'target')

    await opfs.impl.cp(sourcePath, targetPath, {
      recursive: true,
      force: false,
    })

    await expect(
      opfs.impl.readFile(path.join(targetPath, 'existing.kcl'), 'utf8')
    ).resolves.toBe('target contents')
    await expect(
      opfs.impl.readFile(path.join(targetPath, 'new.kcl'), 'utf8')
    ).resolves.toBe('new contents')
  })
})
