import type {
  CopyOptions,
  IStat,
  IZooDesignStudioFS,
  WriteFileOptions,
} from '@src/lib/fs-zds/interface'

interface EntryMetadata {
  readonly inode: number
  readonly modified: number
}
type MemoryEntry = EntryMetadata &
  (
    | { readonly kind: 'file'; readonly bytes: Uint8Array<ArrayBuffer> }
    | { readonly kind: 'directory'; readonly children: Set<string> }
  )

export interface MemoryFileSystem extends IZooDesignStudioFS {
  replaceDirectory: (
    root: string,
    files: readonly { path: string; data: Uint8Array }[],
    directories?: readonly string[]
  ) => void
}

/** Owned bytes and indexed directory membership, with synchronous snapshot publication. */
export function createMemoryFileSystem(
  paths: IZooDesignStudioFS
): MemoryFileSystem {
  const entries = new Map<string, MemoryEntry>()
  let nextInode = 0
  const within = (root: string, target: string) =>
    target === root ||
    target.startsWith(root.endsWith(paths.sep) ? root : `${root}${paths.sep}`)
  const fail = (code: string, path: string): never => {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw Object.assign(new Error(`${code}: ${path}`), { code })
  }
  const metadata = (): EntryMetadata => ({
    inode: ++nextInode,
    modified: Date.now(),
  })
  const directory = (): MemoryEntry => ({
    ...metadata(),
    kind: 'directory',
    children: new Set(),
  })
  const file = (bytes: Uint8Array): MemoryEntry => ({
    ...metadata(),
    kind: 'file',
    bytes: new Uint8Array(bytes),
  })
  const get = (path: string): MemoryEntry =>
    entries.get(path) ?? fail('ENOENT', path)
  const children = (path: string): Set<string> => {
    const entry = get(path)
    return entry.kind === 'directory' ? entry.children : fail('ENOTDIR', path)
  }
  const put = (path: string, entry: MemoryEntry) => {
    const parent = paths.dirname(path)
    if (parent !== path) children(parent).add(path)
    entries.set(path, entry)
  }
  const ensureDirectory = (path: string, recursive: boolean): void => {
    const existing = entries.get(path)
    if (existing) {
      if (existing.kind !== 'directory') fail('ENOTDIR', path)
      if (!recursive) fail('EEXIST', path)
      return
    }
    const parent = paths.dirname(path)
    if (parent !== path && !entries.has(parent)) {
      if (!recursive) fail('ENOENT', parent)
      ensureDirectory(parent, true)
    }
    put(path, directory())
  }
  const subtree = (path: string): [string, MemoryEntry][] => {
    const result: [string, MemoryEntry][] = []
    const pending = [path]
    while (pending.length) {
      const current = pending.pop()!
      const entry = get(current)
      result.push([current, entry])
      if (entry.kind === 'directory') pending.push(...entry.children)
    }
    return result
  }
  const remove = (path: string) => {
    const contents = subtree(path)
    const parent = paths.dirname(path)
    if (parent !== path) children(parent).delete(path)
    for (const [name] of contents) entries.delete(name)
  }
  const write = (
    path: string,
    bytes: Uint8Array,
    options?: WriteFileOptions
  ) => {
    const existing = entries.get(path)
    if (existing && options?.flag === 'wx') fail('EEXIST', path)
    if (existing?.kind === 'directory') fail('EISDIR', path)
    put(path, file(bytes))
  }
  const copy = (
    source: string,
    destination: string,
    options?: CopyOptions
  ): void => {
    const entry = get(source)
    if (options?.force === false && entries.has(destination))
      fail('EEXIST', destination)
    if (entry.kind === 'file') {
      write(destination, entry.bytes)
      return
    }
    if (!options?.recursive) fail('EISDIR', source)
    ensureDirectory(destination, true)
    for (const child of entry.children)
      copy(child, paths.join(destination, paths.basename(child)), options)
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
    const entry = get(paths.resolve(path))
    if (entry.kind !== 'file') return fail('EISDIR', path)
    return options
      ? new TextDecoder().decode(entry.bytes)
      : new Uint8Array(entry.bytes)
  }
  return {
    ...paths,
    isSameEntry: undefined,
    readFile,
    writeFile: async (path, bytes, options) =>
      write(paths.resolve(path), bytes, options),
    mkdir: async (path, options?: { recursive?: boolean }) => {
      ensureDirectory(paths.resolve(path), options?.recursive ?? false)
      return undefined
    },
    rm: async (path, options?: { recursive?: boolean; force?: boolean }) => {
      path = paths.resolve(path)
      if (!entries.has(path) && options?.force) return
      const entry = get(path)
      if (
        entry.kind === 'directory' &&
        entry.children.size &&
        !options?.recursive
      )
        return fail('ENOTEMPTY', path)
      remove(path)
    },
    cp: async (source, destination, options) => {
      source = paths.resolve(source)
      destination = paths.resolve(destination)
      if (within(source, destination)) return fail('EINVAL', destination)
      copy(source, destination, options)
    },
    rename: async (source, destination) => {
      source = paths.resolve(source)
      destination = paths.resolve(destination)
      const entry = get(source)
      if (source === destination) return
      if (within(source, destination)) return fail('EINVAL', destination)
      children(paths.dirname(destination))
      const target = entries.get(destination)
      if (target) {
        if (entry.kind !== target.kind)
          return fail(
            target.kind === 'file' ? 'ENOTDIR' : 'EISDIR',
            destination
          )
        if (target.kind === 'directory' && target.children.size)
          return fail('ENOTEMPTY', destination)
      }
      const moved = subtree(source)
      const relocated = (path: string) =>
        paths.join(destination, paths.relative(source, path))
      remove(source)
      if (target) remove(destination)
      for (const [path, value] of moved) {
        // Directory membership changes with the path; inode and file bytes retain identity.
        entries.set(
          relocated(path),
          value.kind === 'file'
            ? value
            : {
                ...value,
                children: new Set([...value.children].map(relocated)),
              }
        )
      }
      children(paths.dirname(destination)).add(destination)
    },
    replaceDirectory: (root, files, directories = []) => {
      root = paths.resolve(root)
      // Construct and validate a detached subtree before publishing any changes.
      const next = new Map<string, MemoryEntry>([[root, directory()]])
      const addDirectory = (path: string): void => {
        const existing = next.get(path)
        if (existing) {
          if (existing.kind !== 'directory') fail('ENOTDIR', path)
          return
        }
        addDirectory(paths.dirname(path))
        next.set(path, directory())
      }
      const contained = (path: string) => {
        path = paths.resolve(path)
        if (path === root || !within(root, path)) fail('EINVAL', path)
        return path
      }
      for (const path of directories) addDirectory(contained(path))
      for (const item of files) {
        const path = contained(item.path)
        if (next.has(path)) fail('EEXIST', path)
        addDirectory(paths.dirname(path))
        next.set(path, file(item.data))
      }
      for (const [path] of next) {
        if (path === root) continue
        const parent = next.get(paths.dirname(path))!
        if (parent.kind !== 'directory') fail('ENOTDIR', path)
        else parent.children.add(path)
      }
      // Ensure the root's parent exists, as it would for ordinary directory creation.
      const parent = paths.dirname(root)
      if (parent !== root) ensureDirectory(parent, true)
      if (entries.has(root)) remove(root)
      for (const [path, entry] of next) entries.set(path, entry)
      if (parent !== root) children(parent).add(root)
    },
    readdir: async (path) =>
      [...children(paths.resolve(path))].map((child) => paths.basename(child)),
    stat: async (path): Promise<IStat> => {
      const entry = get(paths.resolve(path))
      const time = entry.modified
      return {
        dev: 0,
        ino: entry.inode,
        mode: entry.kind === 'file' ? 0o100644 : 0o40755,
        nlink: 1,
        uid: 0,
        gid: 0,
        rdev: 0,
        size: entry.kind === 'file' ? entry.bytes.byteLength : 0,
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
      get(paths.resolve(path))
    },
    getPath: async () =>
      Promise.reject(
        new Error('A memory filesystem has no system directories.')
      ),
    attach: async () => {},
    detach: async () => {},
  }
}
