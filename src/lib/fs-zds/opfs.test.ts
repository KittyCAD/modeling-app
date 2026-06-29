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
})
