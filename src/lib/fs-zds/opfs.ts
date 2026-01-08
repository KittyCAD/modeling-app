// The Origin Private File System. Used for browser environments.
import type { IZooDesignStudioFS, IStat } from '@src/lib/fs-zds/interface'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import path from 'path'

const noopAsync = async (..._args: any[]) =>
  Promise.reject(new Error('unimplemented'))

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type OPFSOptions = {}

// NOTE TO SELF OR ANYONE ELSE IN CASE: RETURN PROMISE.REJECT IN FAILURE CASES!

const walk = async (
  targetPath: string,
  onTargetNode?: (part: string) => void
): Promise<undefined | FileSystemDirectoryHandle | FileSystemFileHandle> => {
  let current = await navigator.storage.getDirectory()
  let cwd = ''
  let looped = true
  let currentChanged = true

  // '/'.split('/').length === 2 always.
  if (targetPath.split(path.sep).length === 2) {
    return current
  }

  while (looped && currentChanged) {
    let entries = await current.entries()
    looped = false
    currentChanged = false
    for await (let [name, handle] of entries) {
      looped = true
      const currentPath = cwd + path.sep + name
      if (targetPath.startsWith(currentPath) === false) {
        continue
      }

      if (onTargetNode) {
        onTargetNode(name)
      }

      if (targetPath === currentPath) {
        return handle
      }

      if (handle instanceof FileSystemDirectoryHandle) {
        cwd = currentPath
        current = handle
        currentChanged = true
        break
      }

      return undefined
    }
  }

  // We never found it. The result should be found in the loop.
  return undefined
}

// Similar to walk, but more powerful, scan will visit every single edge
// (file/dir) at every node (dir).
// onVisit: eagerly evaluate a function at every node.
// return value: a list of Handles.
const scan = async (
  targetPath: string,
  onVisit?: (
    cwd: string,
    handle: FileSystemDirectoryHandle | FileSystemFileHandle
  ) => Promise<void>
): Promise<(FileSystemDirectoryHandle | FileSystemFileHandle)[]> => {
  console.log('scan', targetPath)
  const startingPoint = await walk(targetPath)
  if (startingPoint === undefined) return Promise.reject('ENOENT')

  let visited = []
  let handles = await startingPoint.entries()
  let cwd = '/'

  console.log('looping entries')
  while (handles.length > 0) {
    const current = handles.pop()
    await onVisit?.(cwd, current)
    visited.push(current)
    if (current instanceof FileSystemDirectoryHandle) {
      cwd = path.resolve(cwd, current.name)
      handles.push(await current.entries())
    }
  }

  return visited
}

const stat = async (path: string): Promise<IStat> => {
  const handle = await walk(path)
  if (handle === undefined) return Promise.reject('ENOENT')

  if (handle instanceof FileSystemFileHandle) {
    const file = await handle.getFile()

    // Most data is fake because it simply doesn't exist in OPFS.
    return {
      dev: 0,
      ino: 0,
      mode: 0,
      nlink: 0,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: file.size,
      blksize: 0,
      blocks: 0,
      atimeMs: file.lastModified,
      mtimeMs: file.lastModified,
      ctimeMs: file.lastModified,
      birthtimeMs: file.lastModified,
      atime: new Date(file.lastModified),
      mtime: new Date(file.lastModified),
      ctime: new Date(file.lastModified),
      birthtime: new Date(file.lastModified),
    }
  }

  // Otherwise it's a directory, which oddly doesn't have any info.
  return {
    dev: 0,
    ino: 0,
    nlink: 0,
    mode: fsZdsConstants.S_IFDIR,
    uid: 0,
    gid: 0,
    rdev: 0,
    size: 0,
    blksize: 0,
    blocks: 0,
    atimeMs: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: new Date(),
    mtime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
  }
}

const readdir = async (path: string) => {
  const dir = await walk(path)
  if (dir === undefined) return []
  if (!(dir instanceof FileSystemDirectoryHandle)) return []
  let entries = []
  for await (let [name] of dir.entries()) {
    entries.push(name)
  }
  return entries
}

type ReadFileOptions = undefined | 'utf8' | { encoding?: 'utf-8' }
type ReadFileReturn<T> = T extends 'utf8' | { encoding: 'utf-8' }
  ? string
  : Uint8Array

const readFile = async <T extends ReadFileOptions>(
  targetPath: string,
  options?: T
): Promise<ReadFileReturn<T>> => {
  const handle = await walk(targetPath)
  if (handle === undefined) return Promise.reject('ENOENT')

  if (handle instanceof FileSystemFileHandle) {
    const file = await handle.getFile()
    if (options === 'utf8' || options?.encoding === 'utf-8') {
      return (await file.text()) as ReadFileReturn<T>
    }

    return new Uint8Array(await file.arrayBuffer()) as ReadFileReturn<T>
  }

  return Promise.reject()
}

const mkdir = async (targetPath: string, options?: { recursive: boolean }) => {
  const parts = targetPath.split(path.sep)

  if (options?.recursive === true) {
    let current = navigator.storage.getDirectory()
    for (const part of parts) {
      // Indicative we're at /
      if (part === '') continue
      // await
      current = (await current).getDirectoryHandle(part, { create: true })
    }
    return undefined
  }

  // If not recursive, try to walk to the parent first, then create.
  const parent = parts.slice(0, -1).join(path.sep)
  const handle = await walk(parent)
  if (handle === undefined) return Promise.reject('ENOENT')
  if (handle instanceof FileSystemFileHandle) return Promise.reject('EISFILE')
  await handle.getDirectoryHandle(parts.slice(-1)[0], { create: true })
  return undefined
}

const rm = async (targetPath: string, options?: { recursive: boolean }) => {
  const dirName = path.dirname(targetPath)
  const baseName = path.basename(targetPath)
  const handle = await walk(dirName)
  if (handle === undefined) return Promise.reject('ENOENT')
  if (!(handle instanceof FileSystemDirectoryHandle))
    return Promise.reject('EISNOTDIR')
  let isFile = false
  try {
    await handle.getFileHandle(baseName)
    isFile = true
  } catch (e: unknown) {
    console.log(e)
  }
  return handle.removeEntry(baseName, {
    recursive: (options?.recursive ?? false) && !isFile,
  })
}

const writeFile = async (
  targetPath: string,
  data: Uint8Array<ArrayBuffer>,
  options?: any
) => {
  console.log('Writefile')
  const parts = targetPath.split(path.sep)
  const parent = parts.slice(0, -1).join(path.sep)
  const handle = await walk(parent)
  if (handle === undefined) return Promise.reject('ENOENT')
  if (handle instanceof FileSystemFileHandle) return Promise.reject('EISFILE')
  const handleFile = (await handle).getFileHandle(parts.slice(-1)[0], {
    create: true,
  })
  const writer = await (await handleFile).createWritable()
  await writer.write(data)
  await writer.close()
  return undefined
}

const getPath: IZooDesignStudioFS['getPath'] = async (type) => {
  return path.sep + type
}

// In OPFS the system always has read-write permissions.
const access = async (_path: string, _bitflags: number): Promise<undefined> => {
  return undefined
}

// Kind of a misnomer coming from NodeJS. This should be called `move`.
const rename = async (
  sourcePath: string,
  targetPath: string
): Promise<undefined> => {
  const handle = await walk(sourcePath)
  if (handle === undefined) return Promise.reject('ENOENT')

  if (handle instanceof FileSystemFileHandle) {
    await cp(sourcePath, targetPath)
    await rm(sourcePath)
    console.log('rename file')
  } else {
    console.log('about to rename directory')
    await mkdir(targetPath)
    await cp(sourcePath, targetPath, { recursive: true })
    await rm(sourcePath, { recursive: true })
    console.log('rename dir')
  }
  console.log('done')
  return undefined
}

// OPFS takes a very minimal approach to its API surface via primitives.
// cp is not a primitive, since you can implement `cp` with `read` and `write`.
// https://chromestatus.com/feature/5640802622504960
const cp = async (
  sourcePath: string,
  targetPath: string
): Promise<undefined> => {
  const handleSource = await walk(sourcePath)
  if (handleSource === undefined) return Promise.reject('ENOENT')

  let handleTarget = await walk(targetPath)
  if (handleTarget === undefined) return Promise.reject('ENOENT')

  console.log('about to copy')
  if (handleSource instanceof FileSystemFileHandle) {
    console.log('copying file')
    const data = await readFile(sourcePath)
    await writeFile(targetPath, data)
  } else {
    console.log('copying dir recurse')
    await scan(sourcePath, async (cwd, handle) => {
      console.log('hi')
      const relativePath = path.relative(sourcePath, cwd)
      if (handle instanceof FileSystemDirectoryHandle) {
        await mkdir(relativePath)
      } else {
        const sourceFile = await handle.getFile()
        const data = await sourceFile.arrayBuffer()
        await writeFile(path.resolve(relativePath, handle.name), data)
      }
    })
  }
  return undefined
}

const impl: IZooDesignStudioFS = {
  getPath,
  access,
  cp,
  readFile,
  rename,
  writeFile,
  readdir,
  stat,
  mkdir,
  rm,
  detach: async () => {},
  attach: async () => {},
}

export default {
  impl,
}
