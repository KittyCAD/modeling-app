// This filesystem derives its functions from NodeJS.
// This is primarily used for unit tests.
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import noopfs from '@src/lib/fs-zds/noopfs'
import {
  isAlreadyExistsError,
  PUBLISH_DIRECTORY_DESTINATION_EXISTS,
} from '@src/lib/fs-zds/errors'

import fs from 'node:fs/promises'
import path from 'node:path'

const attach = async () => {}
const detach = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type NodeFSOptions = {}

const getPath: IZooDesignStudioFS['getPath'] = async (type) => {
  return path.sep + type
}

const makeCopiedPathWritable = async (targetPath: string): Promise<void> => {
  const stat = await fs.lstat(targetPath)
  if (stat.isSymbolicLink()) return

  await fs.chmod(targetPath, stat.mode | (stat.isDirectory() ? 0o700 : 0o600))
  if (!stat.isDirectory()) return

  for (const entryName of await fs.readdir(targetPath)) {
    await makeCopiedPathWritable(path.join(targetPath, entryName))
  }
}

export const cp: IZooDesignStudioFS['cp'] = async (
  sourcePath,
  targetPath,
  options
) => {
  const { makeWritable, ...copyOptions } = options ?? {}
  await fs.cp(sourcePath, targetPath, copyOptions)
  if (makeWritable === true) {
    await makeCopiedPathWritable(targetPath)
  }
}

export const publishDirectory: IZooDesignStudioFS['publishDirectory'] = async (
  sourcePath,
  targetPath,
  evidence
) => {
  type FileHandle = Awaited<ReturnType<typeof fs.open>>
  type FileIdentity = { dev: number; ino: number }
  const reservationPath = path.join(
    path.dirname(targetPath),
    evidence.reservationFileName
  )
  const markerPath = path.join(targetPath, evidence.markerName)
  let reservationHandle: FileHandle | undefined
  let markerHandle: FileHandle | undefined
  let reservationIdentity: FileIdentity | undefined
  let markerIdentity: FileIdentity | undefined
  const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  const writeEvidence = async (handle: FileHandle, data: Uint8Array) => {
    let offset = 0
    while (offset < data.byteLength) {
      const { bytesWritten } = await handle.write(
        data,
        offset,
        data.byteLength - offset,
        offset
      )
      if (bytesWritten <= 0) {
        return Promise.reject(
          new Error('Duplicate ownership evidence write made no progress')
        )
      }
      offset += bytesWritten
    }
    // Truncate only after the complete next record is in place. If a process
    // dies during an update, cleanup sees either the prior record or a torn
    // marker file and keeps the matching reservation quarantined.
    await handle.truncate(data.byteLength)
    await handle.sync()
  }
  const readEvidence = async (handle: FileHandle) => {
    const stat = await handle.stat()
    const contents = new Uint8Array(Number(stat.size))
    let offset = 0
    while (offset < contents.byteLength) {
      const { bytesRead } = await handle.read(
        contents,
        offset,
        contents.byteLength - offset,
        offset
      )
      if (bytesRead <= 0) break
      offset += bytesRead
    }
    return offset === contents.byteLength
      ? contents
      : contents.subarray(0, offset)
  }
  const ownedFileStillAtPath = async (
    filePath: string,
    handle: FileHandle | undefined,
    identity: FileIdentity | undefined,
    expected: Uint8Array
  ) => {
    if (!handle || !identity) return false
    try {
      const [stat, contents] = await Promise.all([
        fs.lstat(filePath),
        readEvidence(handle),
      ])
      return (
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.dev === identity.dev &&
        stat.ino === identity.ino &&
        bytesEqual(contents, expected)
      )
    } catch {
      return false
    }
  }
  const fileIdentityStillAtPath = async (
    filePath: string,
    identity: FileIdentity | undefined
  ) => {
    if (!identity) return false
    try {
      const stat = await fs.lstat(filePath)
      return (
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.dev === identity.dev &&
        stat.ino === identity.ino
      )
    } catch {
      return false
    }
  }

  try {
    reservationHandle = await fs.open(reservationPath, 'wx+')
    reservationIdentity = await reservationHandle.stat()
    await writeEvidence(reservationHandle, evidence.reservationPrepared)
  } catch (error) {
    const ownsReservation = await fileIdentityStillAtPath(
      reservationPath,
      reservationIdentity
    )
    await reservationHandle?.close().catch(() => undefined)
    if (ownsReservation) {
      const currentReservation = await fs
        .lstat(reservationPath)
        .catch(() => undefined)
      if (
        currentReservation?.isFile() &&
        !currentReservation.isSymbolicLink() &&
        currentReservation.dev === reservationIdentity?.dev &&
        currentReservation.ino === reservationIdentity.ino
      ) {
        await fs.rm(reservationPath, { force: true })
      }
    }
    return Promise.reject(
      isAlreadyExistsError(error) ? PUBLISH_DIRECTORY_DESTINATION_EXISTS : error
    )
  }

  // A non-recursive mkdir is the portable Node primitive that atomically
  // reserves a previously absent directory. In particular, rename cannot be
  // used here: on macOS it replaces an existing empty destination directory.
  try {
    await fs.mkdir(targetPath)
  } catch (error) {
    const ownsReservation = await ownedFileStillAtPath(
      reservationPath,
      reservationHandle,
      reservationIdentity,
      evidence.reservationPrepared
    )
    await reservationHandle.close().catch(() => undefined)
    reservationHandle = undefined
    if (ownsReservation) {
      const currentReservation = await fs
        .lstat(reservationPath)
        .catch(() => undefined)
      if (
        currentReservation?.isFile() &&
        !currentReservation.isSymbolicLink() &&
        currentReservation.dev === reservationIdentity.dev &&
        currentReservation.ino === reservationIdentity.ino
      ) {
        await fs.rm(reservationPath, { force: true })
      }
    }
    return Promise.reject(
      isAlreadyExistsError(error) ? PUBLISH_DIRECTORY_DESTINATION_EXISTS : error
    )
  }

  let targetIdentity: Awaited<ReturnType<typeof fs.lstat>>
  try {
    targetIdentity = await fs.lstat(targetPath)
    if (!targetIdentity.isDirectory() || targetIdentity.isSymbolicLink()) {
      await reservationHandle.close().catch(() => undefined)
      return Promise.reject(new Error('Duplicate target ownership lost'))
    }
  } catch (error) {
    await reservationHandle.close().catch(() => undefined)
    return Promise.reject(error)
  }
  const targetStillOwned = async (expectedMarker: Uint8Array) => {
    try {
      const stat = await fs.lstat(targetPath)
      return (
        stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        stat.dev === targetIdentity.dev &&
        stat.ino === targetIdentity.ino &&
        (await ownedFileStillAtPath(
          markerPath,
          markerHandle,
          markerIdentity,
          expectedMarker
        ))
      )
    } catch {
      return false
    }
  }
  const assertOwnership = async (
    expectedMarker: Uint8Array,
    expectedReservation: Uint8Array
  ) => {
    const targetOwned = await targetStillOwned(expectedMarker)
    const reservationOwned = await ownedFileStillAtPath(
      reservationPath,
      reservationHandle,
      reservationIdentity,
      expectedReservation
    )
    if (!targetOwned || !reservationOwned) {
      return Promise.reject(
        new Error(
          `Duplicate publication ownership lost (target=${targetOwned}, reservation=${reservationOwned})`
        )
      )
    }
  }

  try {
    markerHandle = await fs.open(markerPath, 'wx+')
    await writeEvidence(markerHandle, evidence.targetPublishing)
    markerIdentity = await markerHandle.stat()
    await assertOwnership(
      evidence.targetPublishing,
      evidence.reservationPrepared
    )
    await writeEvidence(reservationHandle, evidence.reservationReserved)
    await assertOwnership(
      evidence.targetPublishing,
      evidence.reservationReserved
    )
  } catch (error) {
    // Do not delete by pathname: another process could have replaced the
    // reservation after mkdir. No content copy starts without the marker, so
    // a markerless failure can leave only an empty quarantined directory.
    await markerHandle?.close().catch(() => undefined)
    await reservationHandle.close().catch(() => undefined)
    return Promise.reject(error)
  }

  try {
    for (const entryName of await fs.readdir(sourcePath)) {
      if (entryName === evidence.markerName) {
        continue
      }
      await assertOwnership(
        evidence.targetPublishing,
        evidence.reservationReserved
      )
      await fs.cp(
        path.join(sourcePath, entryName),
        path.join(targetPath, entryName),
        {
          recursive: true,
          force: false,
          errorOnExist: true,
          verbatimSymlinks: true,
        }
      )
    }
    await assertOwnership(
      evidence.targetPublishing,
      evidence.reservationReserved
    )
    await writeEvidence(markerHandle, evidence.targetPublished)
    await assertOwnership(
      evidence.targetPublished,
      evidence.reservationReserved
    )
    await writeEvidence(reservationHandle, evidence.reservationPublished)
    await assertOwnership(
      evidence.targetPublished,
      evidence.reservationPublished
    )
  } finally {
    await markerHandle?.close().catch(() => undefined)
    await reservationHandle.close().catch(() => undefined)
  }
}

let impl: IZooDesignStudioFS = noopfs.impl
if (typeof process !== 'undefined' && process.title !== 'browser') {
  impl = {
    resolve: path.resolve.bind(path),
    join: path.join.bind(path),
    relative: path.relative.bind(path),
    extname: path.extname.bind(path),
    sep: path.sep,
    basename: path.basename.bind(path),
    dirname: path.dirname.bind(path),
    getPath,
    access: fs.access,
    cp,
    readFile: fs.readFile,
    rename: fs.rename,
    publishDirectory,
    writeFile: fs.writeFile,
    readdir: fs.readdir,
    stat: fs.stat,
    mkdir: fs.mkdir,
    rm: fs.rm,
    detach,
    attach,
  }
}

export default {
  impl,
}
