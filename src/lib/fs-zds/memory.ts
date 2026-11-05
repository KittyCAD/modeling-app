import type {
  IStat,
  IZooDesignStudioFS,
  WriteFileOptions,
  CopyOptions,
} from '@src/lib/fs-zds/interface'

interface MemoryEntry {
  data?: Uint8Array<ArrayBuffer>
  modified: number
  inode: number
}

/** A filesystem backed exclusively by owned bytes. It never accesses disk or OPFS. */
export function createMemoryFileSystem(
  paths: IZooDesignStudioFS
): IZooDesignStudioFS & {
  replaceDirectory: (
    root: string,
    files: readonly { path: string; data: Uint8Array }[]
  ) => void
} {
  const entries = new Map<string, MemoryEntry>()
  let inode = 0
  const error = (code: string, path: string) =>
    Object.assign(new Error(`${code}: ${path}`), { code })
  const key = (path: string) => paths.resolve(path)
  const get = (path: string) => {
    const entry = entries.get(key(path))
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    if (!entry) throw error('ENOENT', path)
    return entry
  }
  const makeEntry = (data?: Uint8Array): MemoryEntry => ({
    data: data ? new Uint8Array(data) : undefined,
    modified: Date.now(),
    inode: ++inode,
  })
  const children = (path: string) =>
    [...entries.keys()].filter(
      (candidate) =>
        candidate !== key(path) && paths.dirname(candidate) === key(path)
    )
  const mkdir = async (
    path: string,
    options?: { recursive?: boolean }
  ): Promise<undefined> => {
    path = key(path)
    const current = entries.get(path)
    if (current) {
      if (current.data) return Promise.reject(error('ENOTDIR', path))
      if (!options?.recursive) return Promise.reject(error('EEXIST', path))
      return
    }
    const parent = paths.dirname(path)
    if (parent !== path && !entries.has(parent)) {
      if (!options?.recursive) return Promise.reject(error('ENOENT', parent))
      await mkdir(parent, options)
    }
    if (parent !== path && get(parent).data)
      return Promise.reject(error('ENOTDIR', parent))
    entries.set(path, makeEntry())
  }
  async function readFile(
    path: string,
    options: { encoding: 'utf-8' }
  ): Promise<string>
  async function readFile(path: string, options: 'utf8'): Promise<string>
  async function readFile(path: string): Promise<Uint8Array>
  async function readFile(
    path: string,
    options?: unknown
  ): Promise<string | Uint8Array> {
    const data = get(path).data
    if (!data) return Promise.reject(error('EISDIR', path))
    return options ? new TextDecoder().decode(data) : new Uint8Array(data)
  }
  const writeFile = async (
    path: string,
    bytes: Uint8Array,
    options?: WriteFileOptions
  ) => {
    path = key(path)
    if (options?.flag === 'wx' && entries.has(path))
      return Promise.reject(error('EEXIST', path))
    if (entries.has(path) && !get(path).data)
      return Promise.reject(error('EISDIR', path))
    if (get(paths.dirname(path)).data)
      return Promise.reject(error('ENOTDIR', paths.dirname(path)))
    entries.set(path, makeEntry(bytes))
  }
  const rm = async (
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ) => {
    path = key(path)
    if (!entries.has(path) && options?.force) return
    get(path)
    const descendants = [...entries.keys()].filter((p) =>
      p.startsWith(`${path}${paths.sep}`)
    )
    if (descendants.length && !options?.recursive)
      return Promise.reject(error('ENOTEMPTY', path))
    for (const descendant of descendants) entries.delete(descendant)
    entries.delete(path)
  }
  const cp = async (
    source: string,
    destination: string,
    options?: CopyOptions
  ): Promise<void> => {
    source = key(source)
    destination = key(destination)
    if (
      destination === source ||
      destination.startsWith(`${source}${paths.sep}`)
    )
      return Promise.reject(error('EINVAL', destination))
    const entry = get(source)
    if (options?.force === false && entries.has(destination))
      return Promise.reject(error('EEXIST', destination))
    if (entry.data) await writeFile(destination, entry.data)
    else {
      if (!options?.recursive) return Promise.reject(error('EISDIR', source))
      await mkdir(destination, { recursive: true })
      for (const child of children(source))
        await cp(child, paths.join(destination, paths.basename(child)), options)
    }
  }
  return {
    ...paths,
    replaceDirectory: (root, files) => {
      root = key(root)
      const next = new Map<string, MemoryEntry>([[root, makeEntry()]])
      for (const file of files) {
        const path = key(file.path)
        if (!path.startsWith(`${root}${paths.sep}`)) {
          // eslint-disable-next-line suggest-no-throw/suggest-no-throw
          throw error('EINVAL', path)
        }
        next.set(path, makeEntry(file.data))
        let parent = paths.dirname(path)
        while (parent !== root) {
          if (next.get(parent)?.data) {
            // eslint-disable-next-line suggest-no-throw/suggest-no-throw
            throw error('ENOTDIR', parent)
          }
          next.set(parent, next.get(parent) ?? makeEntry())
          parent = paths.dirname(parent)
        }
      }
      // Validate file/directory collisions before publishing the new tree.
      for (const path of next.keys()) {
        if (path !== root && next.get(paths.dirname(path))?.data) {
          // eslint-disable-next-line suggest-no-throw/suggest-no-throw
          throw error('ENOTDIR', path)
        }
      }
      for (const path of entries.keys())
        if (path === root || path.startsWith(`${root}${paths.sep}`))
          entries.delete(path)
      for (const [path, entry] of next) entries.set(path, entry)
    },
    readFile,
    writeFile,
    mkdir,
    rm,
    cp,
    rename: async (source, destination) => {
      await cp(source, destination, { recursive: true, force: false })
      await rm(source, { recursive: true })
    },
    readdir: async (path) => {
      if (get(path).data) return Promise.reject(error('ENOTDIR', path))
      return children(path).map((child) => paths.basename(child))
    },
    stat: async (path): Promise<IStat> => {
      const entry = get(path)
      const mode = entry.data ? 0o100644 : 0o40755
      const time = entry.modified
      return {
        dev: 0,
        ino: entry.inode,
        mode,
        nlink: 1,
        uid: 0,
        gid: 0,
        rdev: 0,
        size: entry.data?.byteLength ?? 0,
        blksize: 4096,
        blocks: 0,
        atimeMs: time,
        mtimeMs: time,
        ctimeMs: time,
        birthtimeMs: time,
        atime: new Date(time),
        mtime: new Date(time),
        ctime: new Date(time),
        birthtime: new Date(time),
      }
    },
    access: async (path) => {
      get(path)
    },
    getPath: async () =>
      Promise.reject(
        new Error('A memory filesystem has no system directories.')
      ),
    attach: async () => {},
    detach: async () => {},
  }
}
