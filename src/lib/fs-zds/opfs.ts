import path from 'path'
import { reportClientError } from '@src/lib/clientErrors'
import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import {
  isAlreadyExistsError,
  isPublishDirectoryDestinationExists,
  PUBLISH_DIRECTORY_DESTINATION_EXISTS,
} from '@src/lib/fs-zds/errors'
// The Origin Private File System. Used for browser environments.
import type { IStat, IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import OPFSWriteWorker from '@src/lib/fs-zds/opfsWriteWorker.ts?worker'

// Holds onto directory metadata that is not stored by the File System API.
const META_FILE = '._meta'

interface MetaFileDirectoryData {
  mtimeMs: number
}

function createDirectoryMetadata(): MetaFileDirectoryData {
  return {
    mtimeMs: new Date().getTime(),
  }
}

async function writeDirectoryMetadata(
  metaFilePath: string,
  metadata: MetaFileDirectoryData
) {
  await writeFile(
    path.resolve(metaFilePath),
    new TextEncoder().encode(JSON.stringify(metadata))
  )
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

type OPFSWriteWorkerRequest = {
  id: number
  type: 'write-file'
  targetPath: string
  data: Uint8Array<ArrayBuffer>
}

type OPFSWriteWorkerResponse =
  | { id: number; ok: true }
  | { id: number; ok: false; error: string }

const pendingWorkerWrites = new Map<
  number,
  {
    resolve: () => void
    reject: (reason?: unknown) => void
  }
>()

let writeWorkerId = 0
let opfsWriteWorker: Worker | null = null

const getOPFSWriteWorker = () => {
  if (opfsWriteWorker) return opfsWriteWorker

  opfsWriteWorker = new OPFSWriteWorker({ name: 'opfs-write' })
  opfsWriteWorker.onmessage = (
    event: MessageEvent<OPFSWriteWorkerResponse>
  ) => {
    const pending = pendingWorkerWrites.get(event.data.id)
    if (!pending) return

    pendingWorkerWrites.delete(event.data.id)
    if (event.data.ok) {
      pending.resolve()
      return
    }

    pending.reject(event.data.error)
  }

  return opfsWriteWorker
}

const writeFileViaWorker = (
  targetPath: string,
  data: Uint8Array<ArrayBuffer>
): Promise<void> => {
  const worker = getOPFSWriteWorker()
  const id = writeWorkerId++
  const request: OPFSWriteWorkerRequest = {
    id,
    type: 'write-file',
    targetPath,
    data,
  }

  return new Promise((resolve, reject) => {
    pendingWorkerWrites.set(id, { resolve, reject })
    worker.postMessage(request)
  })
}

const walk = async (
  targetPath: string,
  onTargetNode?: (part: string) => void
): Promise<undefined | FileSystemDirectoryHandle | FileSystemFileHandle> => {
  const resolvedTargetPath = path.resolve(targetPath)
  const resolvedCwd = path.resolve()
  const pathRoot = path.parse(resolvedTargetPath).root
  const storageRootPath =
    resolvedCwd === path.parse(resolvedCwd).root ||
    resolvedTargetPath === resolvedCwd ||
    resolvedTargetPath.startsWith(`${resolvedCwd}${path.sep}`)
      ? resolvedCwd
      : pathRoot
  let current = await navigator.storage.getDirectory()
  let cwd = storageRootPath
  let looped = true
  let currentChanged = true

  if (resolvedTargetPath === storageRootPath) {
    return current
  }

  while (looped && currentChanged) {
    let entries = current.entries()
    looped = false
    currentChanged = false
    for await (let [name, handle] of entries) {
      looped = true
      const currentPath = path.resolve(cwd, name)

      if (
        resolvedTargetPath !== currentPath &&
        !resolvedTargetPath.startsWith(`${currentPath}${path.sep}`)
      ) {
        continue
      }

      if (onTargetNode) {
        onTargetNode(name)
      }

      if (resolvedTargetPath === currentPath) {
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
  const startingPoint = await walk(targetPath)

  if (startingPoint === undefined) return Promise.reject('ENOENT')
  if (!(startingPoint instanceof FileSystemDirectoryHandle))
    return Promise.reject('ENOTDIR')

  let visited: [string, string][] = []
  const asyncIters: [
    string,
    AsyncIterableIterator<
      [string, FileSystemDirectoryHandle | FileSystemFileHandle]
    >,
  ][] = [[targetPath, startingPoint.entries()]]

  while (asyncIters.length > 0) {
    const asyncIter = asyncIters.pop()
    if (asyncIter === undefined) break
    const [cwd, handles] = asyncIter
    for await (const current of handles) {
      await onVisit?.(cwd, current)
      visited.push([cwd, current[0]])
      if (current[1] instanceof FileSystemDirectoryHandle) {
        asyncIters.push([path.resolve(cwd, current[0]), current[1].entries()])
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
  let obj
  try {
    const json = await readFile(metaFilePath, { encoding: 'utf-8' })
    try {
      obj = JSON.parse(json)
    } catch {
      obj = undefined
    }
  } catch (e: unknown) {
    if (e !== 'ENOENT') {
      // eslint-disable-next-line suggest-no-throw/suggest-no-throw
      throw e
    }
  }

  if (!isMetaFileDirectoryData(obj)) {
    obj = createDirectoryMetadata()
    await writeDirectoryMetadata(metaFilePath, obj)
  }

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

const readFileTry = async <T extends ReadFileOptions>(
  attemptN: number,
  handle: FileSystemFileHandle,
  options?: T
): Promise<ReadFileReturn<T>> => {
  try {
    const file = await handle.getFile()

    if (options === 'utf8' || options?.encoding === 'utf-8') {
      return (await file.text()) as ReadFileReturn<T>
    }

    return new Uint8Array(await file.arrayBuffer()) as ReadFileReturn<T>
  } catch (e: unknown) {
    console.error(e)
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (attemptN === 3) {
          return reject(e)
        }
        void readFileTry<T>(attemptN + 1, handle, options).then(resolve)
      }, attemptN * 1000)
    })
  }
}

const readFile = async <T extends ReadFileOptions>(
  targetPath: string,
  options?: T
): Promise<ReadFileReturn<T>> => {
  const handle = await walk(targetPath)
  if (handle === undefined) return Promise.reject('ENOENT')

  if (handle instanceof FileSystemFileHandle) {
    return readFileTry(0, handle, options)
  }

  return Promise.reject()
}

function opfsPathMutationLockName(targetPath: string) {
  return `zds:opfs:path-mutation:${path
    .resolve(targetPath)
    .replaceAll('\\', '/')}`
}

async function runWithOPFSPathMutationLock<T>(
  targetPath: string,
  operation: () => Promise<T>,
  requireCrossRendererLock = false
) {
  const lockManager =
    typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!lockManager) {
    return requireCrossRendererLock
      ? Promise.reject('OPFS_PATH_LOCK_UNAVAILABLE')
      : operation()
  }

  let lockAcquired = false
  try {
    return await lockManager.request(
      opfsPathMutationLockName(targetPath),
      async () => {
        lockAcquired = true
        return operation()
      }
    )
  } catch (error) {
    if (lockAcquired || requireCrossRendererLock) {
      return Promise.reject(error)
    }
    return operation()
  }
}

async function mkdirSingle(targetPath: string, allowExisting: boolean) {
  const existing = await walk(targetPath)
  if (existing !== undefined) {
    if (allowExisting && existing instanceof FileSystemDirectoryHandle) {
      return undefined
    }
    return Promise.reject('EEXIST')
  }

  const parentPath = path.dirname(targetPath)
  const parent = await walk(parentPath)
  if (parent === undefined) return Promise.reject('ENOENT')
  if (parent instanceof FileSystemFileHandle) return Promise.reject('EISFILE')
  await parent.getDirectoryHandle(path.basename(targetPath), { create: true })
  return undefined
}

async function mkdirRecursive(
  targetPath: string,
  lockAlreadyHeldPath?: string
) {
  const resolvedLockAlreadyHeldPath = lockAlreadyHeldPath
    ? path.resolve(lockAlreadyHeldPath)
    : undefined
  const resolvedTargetPath = path.resolve(targetPath)
  const relativeParts = resolvedTargetPath
    .slice(path.parse(resolvedTargetPath).root.length)
    .split(path.sep)
    .filter(Boolean)
  let currentPath = path.parse(resolvedTargetPath).root
  for (const part of relativeParts) {
    currentPath = path.resolve(currentPath, part)
    if (currentPath === resolvedLockAlreadyHeldPath) {
      await mkdirSingle(currentPath, true)
    } else {
      await runWithOPFSPathMutationLock(currentPath, () =>
        mkdirSingle(currentPath, true)
      )
    }
  }
  return undefined
}

const mkdir = async (targetPath: string, options?: { recursive: boolean }) => {
  if (!options?.recursive) {
    return runWithOPFSPathMutationLock(targetPath, () =>
      mkdirSingle(targetPath, false)
    )
  }

  return mkdirRecursive(targetPath)
}

const rm = async (
  targetPath: string,
  options?: { recursive: boolean; force?: boolean }
) => {
  const dirName = path.dirname(targetPath)
  const baseName = path.basename(targetPath)
  const handle = await walk(dirName)
  if (handle === undefined) {
    return options?.force ? undefined : Promise.reject('ENOENT')
  }
  if (handle instanceof FileSystemFileHandle) return
  let isFile = false
  try {
    await handle.getFileHandle(baseName)
    isFile = true
  } catch {}
  try {
    return await handle.removeEntry(baseName, {
      recursive: (options?.recursive ?? false) && !isFile,
    })
  } catch (error) {
    if (options?.force && (await walk(targetPath)) === undefined) {
      return undefined
    }
    return Promise.reject(error)
  }
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
  const fileHandle = await handle.getFileHandle(parts.slice(-1)[0], {
    create: true,
  })
  const writableMethod = (
    fileHandle as FileSystemFileHandle & {
      createWritable?: () => Promise<{
        write: (data: Blob) => Promise<void>
        close: () => Promise<void>
      }>
    }
  ).createWritable

  if (typeof writableMethod === 'function') {
    const writer = await writableMethod.call(fileHandle)
    await writer.write(new Blob([data], { type: 'application/octet-stream' }))
    await writer.close()
  } else {
    void reportClientError({
      code: 'opfs_missing_create_writable',
      dedupeKey: 'opfs_missing_create_writable',
      errorName: 'MissingBrowserFeature',
      message:
        'FileSystemFileHandle.createWritable is unavailable for OPFS writes; using the worker fallback.',
      extra: {
        fileExtension: path.extname(targetPath),
        hasCreateWritable: false,
        hasWorkerFallback: true,
      },
    })

    try {
      await writeFileViaWorker(targetPath, data)
    } catch (error: unknown) {
      if (error === 'OPFS_WRITE_UNSUPPORTED') {
        void reportClientError({
          code: 'opfs_write_unsupported',
          dedupeKey: 'opfs_write_unsupported',
          errorName: 'MissingBrowserFeature',
          message:
            'OPFS writes are unsupported because both createWritable and worker write fallbacks are unavailable.',
          extra: {
            fileExtension: path.extname(targetPath),
            hasCreateWritable: false,
            hasWorkerFallback: false,
          },
        })
      }

      return Promise.reject(error)
    }
  }

  // Update parent directory's metadata, since OPFS doesn't support tracking it.
  // Yep, each writeFile is recursively called, so each writeFile is actually
  // 2 now due to this deficiency.
  // UNLESS ITS THE META_FILE ITSELF, THEN WE SKIP.

  if (targetPath.includes(META_FILE)) return undefined

  await writeFile(
    path.resolve(targetPath, '..', META_FILE),
    new TextEncoder().encode(JSON.stringify(createDirectoryMetadata()))
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
  const operation = async (): Promise<undefined> => {
    const handle = await walk(sourcePath)
    if (handle === undefined) return Promise.reject('ENOENT')
    if ((await walk(targetPath)) !== undefined) return Promise.reject('EEXIST')

    if (handle instanceof FileSystemFileHandle) {
      await copy(sourcePath, targetPath, targetPath)
      await rm(sourcePath)
    } else {
      await mkdirSingle(targetPath, false)
      await copy(sourcePath, targetPath, targetPath)
      await rm(sourcePath, { recursive: true })
    }
    return undefined
  }
  return runWithOPFSPathMutationLock(targetPath, operation, true)
}

// OPFS takes a very minimal approach to its API surface via primitives.
// cp is not a primitive, since you can implement `cp` with `read` and `write`.
// https://chromestatus.com/feature/5640802622504960
const copy = async (
  sourcePath: string,
  targetPath: string,
  lockAlreadyHeldPath?: string
): Promise<undefined> => {
  const handleSource = await walk(sourcePath)
  if (handleSource === undefined) return Promise.reject('ENOENT')

  if (handleSource instanceof FileSystemFileHandle) {
    const data = await readFile(sourcePath)

    if (typeof data === 'string') {
      await writeFile(targetPath, new TextEncoder().encode(data))
    } else {
      await writeFile(targetPath, Uint8Array.from(data))
    }
  } else {
    const targetHandle = await walk(targetPath)
    if (targetHandle === undefined) {
      await mkdir(targetPath)
    } else if (targetHandle instanceof FileSystemFileHandle) {
      return Promise.reject('ENOTDIR')
    }
    await scan(sourcePath, async (cwd, handle) => {
      const relativePathToSourcePath = path.relative(sourcePath, cwd)
      const absolutePath = path.resolve(
        targetPath,
        relativePathToSourcePath,
        handle[0]
      )
      if (handle[1] instanceof FileSystemDirectoryHandle) {
        await mkdirRecursive(absolutePath, lockAlreadyHeldPath)
      } else {
        const sourceFile = await handle[1].getFile()
        const data = await sourceFile.arrayBuffer()
        await writeFile(absolutePath, new Uint8Array(data))
      }
    })
  }
  return undefined
}

const cp = async (sourcePath: string, targetPath: string) =>
  copy(sourcePath, targetPath)

const publishDirectory: IZooDesignStudioFS['publishDirectory'] = async (
  sourcePath,
  targetPath,
  evidence
) => {
  const operation = async () => {
    const sourceHandle = await walk(sourcePath)
    if (sourceHandle === undefined) {
      return Promise.reject(
        new Error('Duplicate publication source does not exist')
      )
    }
    if (!(sourceHandle instanceof FileSystemDirectoryHandle)) {
      return Promise.reject(
        new Error('Duplicate publication source is not a directory')
      )
    }
    const assertSourceOwnership = async () => {
      const currentSource = await walk(sourcePath)
      if (
        !(currentSource instanceof FileSystemDirectoryHandle) ||
        !(await sourceHandle.isSameEntry(currentSource))
      ) {
        return Promise.reject(
          new Error('Duplicate publication source ownership was lost')
        )
      }
    }
    const reservationPath = path.resolve(
      path.dirname(targetPath),
      evidence.reservationFileName
    )
    if ((await walk(reservationPath)) !== undefined) {
      return Promise.reject(PUBLISH_DIRECTORY_DESTINATION_EXISTS)
    }
    const reservationParent = await walk(path.dirname(reservationPath))
    if (!(reservationParent instanceof FileSystemDirectoryHandle)) {
      return Promise.reject(
        new Error('Duplicate reservation parent is unavailable')
      )
    }
    let reservationHandle: FileSystemFileHandle | undefined
    try {
      reservationHandle = await reservationParent.getFileHandle(
        path.basename(reservationPath),
        { create: true }
      )
      await writeFile(reservationPath, evidence.reservationPrepared)
    } catch (error) {
      if (reservationHandle) {
        try {
          const currentReservation = await walk(reservationPath)
          if (
            currentReservation instanceof FileSystemFileHandle &&
            (await reservationHandle.isSameEntry(currentReservation))
          ) {
            await rm(reservationPath, { recursive: false, force: true }).catch(
              () => undefined
            )
          }
        } catch {}
      }
      return Promise.reject(error)
    }
    const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
      left.length === right.length &&
      left.every((byte, index) => byte === right[index])
    const fileStillOwned = async (
      filePath: string,
      originalHandle: FileSystemFileHandle,
      expected: Uint8Array
    ) => {
      const currentHandle = await walk(filePath)
      if (
        !(currentHandle instanceof FileSystemFileHandle) ||
        !(await originalHandle.isSameEntry(currentHandle))
      ) {
        return false
      }
      const contents = await readFile(filePath)
      return typeof contents !== 'string' && bytesEqual(contents, expected)
    }

    // The destination path lock is shared with mkdir. Creating the target
    // while holding it gives cooperating renderers a single no-clobber
    // reservation for the whole publication.
    try {
      await mkdirSingle(targetPath, false)
    } catch (error) {
      if (
        await fileStillOwned(
          reservationPath,
          reservationHandle,
          evidence.reservationPrepared
        )
      ) {
        await rm(reservationPath, { recursive: false, force: true })
      }
      return Promise.reject(
        isAlreadyExistsError(error)
          ? PUBLISH_DIRECTORY_DESTINATION_EXISTS
          : error
      )
    }

    const targetHandle = await walk(targetPath)
    if (!(targetHandle instanceof FileSystemDirectoryHandle)) {
      return Promise.reject(new Error('Duplicate target ownership was lost'))
    }
    const markerPath = path.resolve(targetPath, evidence.markerName)
    const assertOwnership = async (
      expectedMarker: Uint8Array,
      expectedReservation: Uint8Array
    ) => {
      const currentTarget = await walk(targetPath)
      if (
        !(currentTarget instanceof FileSystemDirectoryHandle) ||
        !(await targetHandle.isSameEntry(currentTarget)) ||
        !(await fileStillOwned(
          reservationPath,
          reservationHandle,
          expectedReservation
        ))
      ) {
        return Promise.reject(
          new Error('Duplicate publication ownership was lost')
        )
      }
      const markerHandle = await walk(markerPath)
      if (
        !(markerHandle instanceof FileSystemFileHandle) ||
        !(await readFile(markerPath).then(
          (contents) =>
            typeof contents !== 'string' && bytesEqual(contents, expectedMarker)
        ))
      ) {
        return Promise.reject(
          new Error('Duplicate publication ownership was lost')
        )
      }
    }
    try {
      await writeFile(markerPath, evidence.targetPublishing)
      await assertOwnership(
        evidence.targetPublishing,
        evidence.reservationPrepared
      )
      await writeFile(reservationPath, evidence.reservationReserved)
      await assertOwnership(
        evidence.targetPublishing,
        evidence.reservationReserved
      )
    } catch (error) {
      // Never delete by pathname after reservation: another renderer may have
      // replaced it. Copying has not started, so it is empty unless a marker
      // was partially created or another renderer populated it.
      return Promise.reject(error)
    }

    for await (const [entryName] of sourceHandle.entries()) {
      // OPFS directory metadata is regenerated for the new target. More
      // importantly, never copy a stale publication marker from the source.
      if (entryName === evidence.markerName || entryName === META_FILE) {
        continue
      }

      await assertOwnership(
        evidence.targetPublishing,
        evidence.reservationReserved
      )
      await assertSourceOwnership()

      const sourceEntryPath = path.resolve(sourcePath, entryName)
      const targetEntryPath = path.resolve(targetPath, entryName)
      if ((await walk(targetEntryPath)) !== undefined) {
        return Promise.reject(
          new Error('A duplicate target entry already exists')
        )
      }

      const sourceEntry = await walk(sourceEntryPath)
      if (sourceEntry === undefined) {
        return Promise.reject(
          new Error('A duplicate staging entry disappeared during publication')
        )
      }
      if (sourceEntry instanceof FileSystemDirectoryHandle) {
        await mkdirSingle(targetEntryPath, false)
      }
      await copy(sourceEntryPath, targetEntryPath, targetPath)
    }

    await assertOwnership(
      evidence.targetPublishing,
      evidence.reservationReserved
    )
    await assertSourceOwnership()
    await writeFile(markerPath, evidence.targetPublished)
    await assertOwnership(
      evidence.targetPublished,
      evidence.reservationReserved
    )
    await writeFile(reservationPath, evidence.reservationPublished)
    await assertOwnership(
      evidence.targetPublished,
      evidence.reservationPublished
    )

    return undefined
  }

  // Without Web Locks, OPFS has no atomic create-if-absent operation exposed
  // across renderers. Refuse publication instead of risking a merge.
  try {
    return await runWithOPFSPathMutationLock(targetPath, operation, true)
  } catch (error) {
    // Keep the typed collision sentinel for the actor's retry loop. All other
    // publication failures reach UI error handling as readable Error objects.
    if (isPublishDirectoryDestinationExists(error) || error instanceof Error) {
      return Promise.reject(error)
    }
    const message =
      error === 'OPFS_PATH_LOCK_UNAVAILABLE'
        ? 'Cannot safely publish the duplicate because the browser path lock is unavailable'
        : `Duplicate publication failed: ${String(error)}`
    return Promise.reject(new Error(message))
  }
}

const impl: IZooDesignStudioFS = {
  resolve: path.resolve.bind(path),
  join: path.join.bind(path),
  relative: path.relative.bind(path),
  extname: path.extname.bind(path),
  sep: path.sep,
  basename: path.basename.bind(path),
  dirname: path.dirname.bind(path),
  getPath,
  access,
  cp,
  readFile,
  rename,
  publishDirectory,
  writeFile,
  readdir,
  stat,
  mkdir,
  rm,
  detach: async () => {
    if (!opfsWriteWorker) return
    opfsWriteWorker.terminate()
    opfsWriteWorker = null
    for (const pending of pendingWorkerWrites.values()) {
      pending.reject('OPFS worker detached')
    }
    pendingWorkerWrites.clear()
  },
  attach: async () => {},
}

export default {
  impl,
}
