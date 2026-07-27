import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import { webSafeJoin, webSafePathSplit } from '@src/lib/pathUtils'

const SYNC_DATABASE_NAME = 'zds-opfs-cloud-sync'

export type CloudSyncTestFsOptions = {
  projectDirectory?: string
  failRenames?: boolean
}

export function normalizeTestPath(path: string) {
  const normalized = path.replace(/\/+/g, '/')
  if (!normalized || normalized === '/') {
    return '/'
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function joinTestPaths(...parts: string[]) {
  return normalizeTestPath(webSafeJoin(parts))
}

function dirname(path: string) {
  const parts = webSafePathSplit(normalizeTestPath(path)).filter(Boolean)
  return parts.length <= 1 ? '/' : joinTestPaths(...parts.slice(0, -1))
}

function basename(path: string) {
  return webSafePathSplit(normalizeTestPath(path)).filter(Boolean).at(-1) || ''
}

function createStat(mode: number, size = 0): IStat {
  const date = new Date(0)
  return {
    dev: 0,
    ino: 0,
    mode,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    size,
    blksize: 0,
    blocks: 0,
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: date,
    mtime: date,
    ctime: date,
    birthtime: date,
  }
}

function pathNotFound() {
  return Promise.reject('ENOENT')
}

export function createCloudSyncTestFs(
  files: Map<string, string>,
  options: CloudSyncTestFsOptions = {}
) {
  const projectDirectory = options.projectDirectory ?? '/documents/Projects'
  const directories = new Set<string>()
  const addDirectory = (path: string) => {
    const parts = webSafePathSplit(normalizeTestPath(path)).filter(Boolean)
    directories.add('/')
    for (let index = 0; index < parts.length; index += 1) {
      directories.add(joinTestPaths(...parts.slice(0, index + 1)))
    }
  }

  addDirectory(projectDirectory)
  for (const path of files.keys()) {
    addDirectory(dirname(path))
  }

  const movePath = (path: string, source: string, target: string) =>
    path === source
      ? target
      : path.startsWith(`${source}/`)
        ? `${target}${path.slice(source.length)}`
        : path

  return {
    resolve: joinTestPaths,
    join: joinTestPaths,
    relative: (from: string, to: string) => {
      const normalizedFrom = normalizeTestPath(from)
      const normalizedTo = normalizeTestPath(to)
      return normalizedTo === normalizedFrom
        ? ''
        : normalizedTo.replace(`${normalizedFrom}/`, '')
    },
    extname: (path: string) => {
      const fileName = basename(path)
      const extensionStart = fileName.lastIndexOf('.')
      return extensionStart === -1 ? '' : fileName.slice(extensionStart)
    },
    sep: '/',
    basename,
    dirname,
    getPath: async () => '/documents',
    access: async (path: string) => {
      const normalizedPath = normalizeTestPath(path)
      if (!files.has(normalizedPath) && !directories.has(normalizedPath)) {
        return pathNotFound()
      }
    },
    cp: async () => undefined,
    readFile: async (
      path: string,
      options?: { encoding?: string } | string
    ) => {
      const contents = files.get(normalizeTestPath(path))
      if (contents === undefined) {
        return pathNotFound()
      }
      if (
        options === 'utf8' ||
        (typeof options === 'object' && options.encoding === 'utf-8')
      ) {
        return contents
      }
      return new TextEncoder().encode(contents)
    },
    rename: async (sourcePath: string, targetPath: string) => {
      if (options.failRenames) {
        return Promise.reject(new Error('rename failed'))
      }

      const source = normalizeTestPath(sourcePath)
      const target = normalizeTestPath(targetPath)
      if (directories.has(source)) {
        const movedDirectories = [...directories]
          .filter((path) => path === source || path.startsWith(`${source}/`))
          .map((path) => [path, movePath(path, source, target)] as const)
        const movedFiles = [...files.entries()]
          .filter(([path]) => path === source || path.startsWith(`${source}/`))
          .map(
            ([path, contents]) =>
              [path, movePath(path, source, target), contents] as const
          )

        for (const [path] of movedDirectories) {
          directories.delete(path)
        }
        for (const [path] of movedFiles) {
          files.delete(path)
        }
        for (const [, nextPath] of movedDirectories) {
          directories.add(nextPath)
        }
        for (const [, nextPath, contents] of movedFiles) {
          files.set(nextPath, contents)
        }
        return
      }

      const contents = files.get(source)
      if (contents === undefined) {
        return pathNotFound()
      }
      files.delete(source)
      files.set(target, contents)
    },
    writeFile: async (path: string, data: Uint8Array | string) => {
      files.set(
        normalizeTestPath(path),
        typeof data === 'string' ? data : new TextDecoder().decode(data)
      )
    },
    readdir: async (path: string) => {
      const normalizedPath = normalizeTestPath(path)
      if (!directories.has(normalizedPath)) {
        return pathNotFound()
      }

      const children = new Set<string>()
      for (const entry of [...directories, ...files.keys()]) {
        if (entry !== normalizedPath && dirname(entry) === normalizedPath) {
          children.add(basename(entry))
        }
      }
      return [...children]
    },
    stat: async (path: string) => {
      const normalizedPath = normalizeTestPath(path)
      if (directories.has(normalizedPath)) {
        return createStat(0o040000)
      }

      const contents = files.get(normalizedPath)
      if (contents !== undefined) {
        return createStat(0o100000, contents.length)
      }
      return pathNotFound()
    },
    mkdir: async (path: string) => {
      addDirectory(path)
    },
    rm: async (path: string) => {
      const normalizedPath = normalizeTestPath(path)
      for (const directory of [...directories]) {
        if (
          directory === normalizedPath ||
          directory.startsWith(`${normalizedPath}/`)
        ) {
          directories.delete(directory)
        }
      }
      for (const file of [...files.keys()]) {
        if (file === normalizedPath || file.startsWith(`${normalizedPath}/`)) {
          files.delete(file)
        }
      }
    },
    detach: async () => undefined,
    attach: async () => undefined,
  } as IZooDesignStudioFS
}

export function getFetchUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

export function getFetchMethod(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) {
  if (init?.method) {
    return init.method
  }
  if (typeof input === 'object' && 'method' in input) {
    return input.method
  }
  return 'GET'
}

export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function deleteCloudSyncTestDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(
      new Error('IndexedDB is unavailable in this test environment.')
    )
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`IndexedDB database ${SYNC_DATABASE_NAME} is blocked.`))
    }, 1000)
    const request = indexedDB.deleteDatabase(SYNC_DATABASE_NAME)
    request.onerror = () => {
      clearTimeout(timeout)
      reject(
        request.error ??
          new Error(
            `Failed to delete IndexedDB database ${SYNC_DATABASE_NAME}.`
          )
      )
    }
    request.onblocked = () => undefined
    request.onsuccess = () => {
      clearTimeout(timeout)
      resolve()
    }
  })
}
