// The Origin Private File System. Used for browser environments.
import { IZooDesignStudioFS, IStat } from './interface'

const noopAsync = async (..._args: any[]) => Promise.reject()
export type OPFSOptions = {}

// NOTE TO SELF OR ANYONE ELSE IN CASE: RETURN PROMISE.REJECT IN FAILURE CASES!
// MOST OF THIS CODE IS USING NIL VALUES!

const walk = async (
  targetPath: string,
  onTargetNode?: (part: string) => void
): Promise<undefined | FileSystemDirectoryHandle | FileSystemFileHandle> => {
  let current = await navigator.storage.getDirectory()
  let cwd = '/'

  while (true) {
    let entries = await current.entries()
    for await (let [name, handle] of entries) {
      const currentPath = cwd + name
      console.log(currentPath)
      if (targetPath.startsWith(currentPath) === false) {
        continue
      }

      if (onTargetNode) {
        onTargetNode(name)
      }

      if (handle instanceof FileSystemDirectoryHandle) {
        cwd = currentPath
        current = handle
        break
      }
      if (targetPath === currentPath) {
        return handle
      }
      return undefined
    }
  }

  return current
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
  path: string,
  options?: T
): Promise<ReadFileReturn<T>> => {
  const handle = await walk(path)
  if (handle === undefined) return Promise.reject('ENOENT')

  if (handle instanceof FileSystemFileHandle) {
    const file = await handle.getFile()
    if (options === 'utf8' || options?.encoding === 'utf-8') {
      return (await file.text()) as ReadFileReturn<T>
    }

    return (await file.bytes()) as ReadFileReturn<T>
  }

  return Promise.reject()
}

const mkdir = async (path: string, options?: { recursive: boolean }) => {
  const parts = path.split('/')

  if (options?.recursive === true) {
    let current = navigator.storage.getDirectory()
    for (const part of parts) {
      current = (await current).getDirectoryHandle(part, { create: true })
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

const writeFile = async (
  path: string,
  data: Uint8Array<ArrayBuffer>,
  options?: any
) => {
  const parts = path.split('/')
  const parent = parts.slice(0, -1).join('/')
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

const impl: IZooDesignStudioFS = {
  cp: noopAsync,
  readFile,
  rename: noopAsync,
  writeFile,
  readdir,
  stat,
  mkdir,
  rm: noopAsync,
  detach: async () => {},
  attach: async () => {},
}

export default {
  impl,
}
