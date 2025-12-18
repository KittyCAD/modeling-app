// The Origin Private File System. Used for browser environments.
import { IZooDesignStudioFS, IStat } from './interface'
import path from 'path'

const noopAsync = async (..._args: any[]) =>
  Promise.reject(new Error('unimplemented'))
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

const stat = async (path: string): Promise<IStat> => {
  const handle = await walk(path)
  if (handle === undefined) return Promise.reject('ENOENT')

  if (handle instanceof FileSystemFileHandle) {
    const file = await handle.getFile()

    // Most data is fake because it simply doesn't exist in OPFS.
    return {
      dev: 0,
      ino: 0,
      mode: null,
      nlink: 0,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: file.size,
      blksize: 0,
      blocks: 0,
      atimeMs: file.lastModified.toString(),
      mtimeMs: file.lastModified.toString(),
      ctimeMs: file.lastModified.toString(),
      birthtimeMs: file.lastModified.toString(),
      atime: new Date(file.lastModified),
      mtime: new Date(file.lastModified),
      ctime: new Date(file.lastModified),
      birthtime: new Date(file.lastModified),
      isDirectory: () => false,
    }
  }

  // Otherwise it's a directory, which oddly doesn't have any info.
  return {
    dev: 0,
    ino: 0,
    mode: null,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    size: 0,
    blksize: 0,
    blocks: 0,
    atimeMs: '0',
    mtimeMs: '0',
    ctimeMs: '0',
    birthtimeMs: '0',
    atime: new Date(),
    mtime: new Date(),
    ctime: new Date(),
    birthtime: new Date(),
    isDirectory: () => true,
  }
}

const readdir = async (path: string) => {
  const dir = await walk(path)
  if (dir === undefined) return []
  if (!(dir instanceof FileSystemDirectoryHandle)) return []
  let entries = []
  for await (let [name, entry] of dir.entries()) {
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
    if (
      options === 'utf8' ||
      options === 'utf-8' ||
      options?.encoding === 'utf-8'
    ) {
      return (await file.text()) as ReadFileReturn<T>
    }

    return (new Uint8Array(await file.arrayBuffer())) as ReadFileReturn<T>
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
      current = await (await current).getDirectoryHandle(part, { create: true })
    }
    return undefined
  }

  // If not recursive, try to walk to the parent first, then create.
  const parent = parts.slice(0, -1).join('/')
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
  return await handle.removeEntry(baseName, {
    recursive: options?.recursive ?? false,
  })
}

const writeFile = async (
  targetPath: string,
  data: Uint8Array<ArrayBuffer>,
  options?: any
) => {
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

const getPath: IZooDesignStudioFS['getPath'] = (type) => {
  return path.sep + type
}

// In OPFS the system always has read-write permissions.
const access = async (_path: src, _bitflags: number): Promise<undefined> => {
  return undefined
}

const impl: IZooDesignStudioFS = {
  getPath,
  access,
  cp: noopAsync,
  readFile,
  rename: noopAsync,
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
