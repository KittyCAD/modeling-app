// The Origin Private File System. Used for browser environments.
import type { IZooDesignStudioFS, IStat } from '@src/lib/fs-zds/interface'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import path from 'path'

// Holds onto directory metadata that is not stored by the File System API.
const META_FILE = '._meta'

interface MetaFileDirectoryData {
  mtimeMs: number
}

const isMetaFileDirectoryData = (x: unknown): x is MetaFileDirectoryData => {
  return (
    typeof x === 'object' &&
    x !== null &&
    'mtimeMs' in x &&
    typeof x.mtimeMs === 'number'
  )
}

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
      const currentPath = path.resolve(cwd, name)

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
    handle: [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  ) => Promise<void>
): Promise<[string, string][]> => {
  console.log('scan', targetPath)
  const startingPoint = await walk(targetPath)

  console.log(startingPoint)
  if (startingPoint === undefined) return Promise.reject('ENOENT')
  if (!(startingPoint instanceof FileSystemDirectoryHandle))
    return Promise.reject('ENOTDIR')

  let visited: [string, string][] = []
  const asyncIters: [
    string,
    AsyncIterableIterator<
      [string, FileSystemDirectoryHandle | FileSystemFileHandle]
    >,
  ][] = [[targetPath, await startingPoint.entries()]]

  console.log('looping entries')

  while (asyncIters.length > 0) {
    const asyncIter = asyncIters.pop()
    if (asyncIter === undefined) break
    const [cwd, handles] = asyncIter
    for await (const current of handles) {
      await onVisit?.(cwd, current)
      visited.push([cwd, current[0]])
      if (current[1] instanceof FileSystemDirectoryHandle) {
        asyncIters.push([
          path.resolve(cwd, current[0]),
          await current[1].entries(),
        ])
      }
    }
  }

  return visited
}

const stat = async (targetPath: string): Promise<IStat> => {
  const handle = await walk(targetPath)
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
  // Update: lee's read the whole fs spec, and it truly lacks info.
  // Because of this, we have to store a ._meta file that holds onto it, and
  // update it as necessary. For now it will only store: creation and
  // modification time.
  const metaFilePath = path.resolve(targetPath, META_FILE)
  let json
  try {
    json = await readFile(metaFilePath, { encoding: 'utf-8' })
  } catch (e: unknown) {
    if (typeof e !== 'string') {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw e
    }

    // The metafile didn't exist in the first place. Let's create it.
    if (e === 'ENOENT') {
      await writeFile(
        path.resolve(metaFilePath),
        new TextEncoder().encode(
          JSON.stringify({
            mtimeMs: new Date().getTime(),
          })
        )
      )
    }

    // This will work now.
    json = await readFile(metaFilePath, { encoding: 'utf-8' })
  }

  const obj = JSON.parse(json)
  if (!isMetaFileDirectoryData(obj))
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error(`Corrupt ${META_FILE} file`)

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
    mtimeMs: obj.mtimeMs,
    ctimeMs: 0,
    birthtimeMs: 0,
    atime: new Date(),
    mtime: new Date(obj.mtimeMs),
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

    return (await file.bytes()) as ReadFileReturn<T>
  }

  return Promise.reject()
}

const mkdir = async (targetPath: string, options?: { recursive: boolean }) => {
  const parts = targetPath.split(path.sep)

  console.log(targetPath, parts)
  if (options?.recursive === true) {
    let current = navigator.storage.getDirectory()
    for (const part of parts) {
      // Indicative we're at /
      console.log(part)
      if (part === '') continue
      // await
      console.log('creating', part)
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
  if (handle instanceof FileSystemFileHandle) return
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
  const parts = targetPath.split(path.sep)
  const parent = parts.slice(0, -1).join(path.sep)
  const handle = await walk(parent)
  if (handle === undefined) return Promise.reject('ENOENT')
  if (handle instanceof FileSystemFileHandle) return Promise.reject('EISFILE')
  const handleFile = (await handle).getFileHandle(parts.slice(-1)[0], {
    create: true,
  })
  const writer = await (await handleFile).createWritable()
  console.log('xxxxxxxssssssss', data)
  console.trace()
  await writer.write(new Blob([data], { type: 'application/octet-stream' }))
  await writer.close()

  // Update parent directory's metadata, since OPFS doesn't support tracking it.
  // Yep, each writeFile is recursively called, so each writeFile is actually
  // 2 now due to this deficiency.
  // UNLESS ITS THE META_FILE ITSELF, THEN WE SKIP.

  if (targetPath.includes(META_FILE)) return undefined

  await writeFile(
    path.resolve(targetPath, '..', META_FILE),
    new TextEncoder().encode(
      JSON.stringify({
        mtimeMs: new Date().getTime(),
      })
    )
  )

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
  console.log('rename', sourcePath, targetPath)

  const handle = await walk(sourcePath)
  if (handle === undefined) return Promise.reject('ENOENT')

  if (handle instanceof FileSystemFileHandle) {
    await cp(sourcePath, targetPath)
    await rm(sourcePath)
    console.log('rename file')
  } else {
    console.log('about to rename directory')
    await mkdir(targetPath)
    await cp(sourcePath, targetPath)
    await rm(sourcePath, { recursive: true })
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

  if (handleSource instanceof FileSystemFileHandle) {
    const data = await readFile(sourcePath)
    if (typeof data === 'string') {
      await writeFile(targetPath, new TextEncoder().encode(data))
    } else {
      await writeFile(targetPath, Uint8Array.from(data))
    }
  } else {
    await scan(sourcePath, async (cwd, handle) => {
      const relativePathToSourcePath = path.basename(cwd, sourcePath)
      const absolutePath = path.resolve(
        targetPath,
        relativePathToSourcePath,
        handle[0]
      )
      if (handle[1] instanceof FileSystemDirectoryHandle) {
        await mkdir(absolutePath)
      } else {
        const sourceFile = await handle[1].getFile()
        const data = await sourceFile.arrayBuffer()
        await writeFile(absolutePath, new Uint8Array(data))
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
