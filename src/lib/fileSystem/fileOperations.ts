import {
  type FileNameParts,
  fileNameCandidate,
} from '@src/lib/fileSystem/fileNames'
import {
  FileSystem,
  type FileSystemError,
  fileSystemError,
} from '@src/lib/fileSystem/fileSystem'
import {
  type PathLockRequirement,
  pathLockRequirements,
} from '@src/lib/fileSystem/pathLocking'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import {
  Context,
  Effect,
  Layer,
  Stream,
  SubscriptionRef,
  SynchronizedRef,
} from 'effect'

const SHARED_LOCK_PERMITS = 1
const EXCLUSIVE_LOCK_PERMITS = 1_000_000

interface PathLockEntry {
  readonly semaphore: Effect.Semaphore
  readonly users: number
}

/**
 * The coordinated workspace storage boundary above the raw filesystem.
 *
 * This boundary covers both project directories and the files within them.
 * Reads take shared path locks while mutations take exclusive target locks,
 * allowing unrelated paths to proceed concurrently without exposing a file
 * while a coordinated mutation of that path is in progress.
 */
export interface FileOperationsService {
  readonly pending: Effect.Effect<number>
  readonly pendingChanges: Stream.Stream<number>
  /** Read one complete version of a file coordinated with path mutations. */
  readonly readFile: (
    path: string
  ) => Effect.Effect<Uint8Array, FileSystemError>
  readonly copy: (
    source: string,
    destination: string
  ) => Effect.Effect<void, FileSystemError>
  readonly writeFile: (
    path: string,
    contents: Uint8Array
  ) => Effect.Effect<void, FileSystemError>
  /** Create exactly this path without overwriting an existing entry. */
  readonly createFile: (
    path: string,
    contents: Uint8Array
  ) => Effect.Effect<void, FileSystemError>
  /** Create the preferred filename or a numbered variant and return its path. */
  readonly createUniqueFile: (
    parent: string,
    name: FileNameParts,
    contents: Uint8Array
  ) => Effect.Effect<string, FileSystemError>
  /** Create exactly this path, rejecting any existing file or directory. */
  readonly createDirectory: (
    path: string
  ) => Effect.Effect<void, FileSystemError>
  /** Create the preferred name or a numbered variant and return its path. */
  readonly createUniqueDirectory: (
    parent: string,
    preferredName: string
  ) => Effect.Effect<string, FileSystemError>
  readonly remove: (path: string) => Effect.Effect<void, FileSystemError>
  readonly rename: (
    source: string,
    destination: string
  ) => Effect.Effect<void, FileSystemError>
}

export class FileOperations extends Context.Tag('zds/FileOperations')<
  FileOperations,
  FileOperationsService
>() {}

const makeFileOperations = (backing: IZooDesignStudioFS) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem
    const pending = yield* SubscriptionRef.make(0)
    const pathLocks = yield* SynchronizedRef.make(
      new Map<string, PathLockEntry>()
    )

    const reservePathLock = (path: string) =>
      SynchronizedRef.modifyEffect(pathLocks, (entries) => {
        const existing = entries.get(path)
        if (existing) {
          const next = new Map(entries)
          next.set(path, { ...existing, users: existing.users + 1 })
          return Effect.succeed([existing.semaphore, next] as const)
        }

        return Effect.makeSemaphore(EXCLUSIVE_LOCK_PERMITS).pipe(
          Effect.map((semaphore) => {
            const next = new Map(entries)
            next.set(path, { semaphore, users: 1 })
            return [semaphore, next] as const
          })
        )
      })

    const releasePathLock = (path: string) =>
      SynchronizedRef.update(pathLocks, (entries) => {
        const existing = entries.get(path)
        if (!existing) {
          return entries
        }

        const next = new Map(entries)
        if (existing.users === 1) {
          next.delete(path)
        } else {
          next.set(path, { ...existing, users: existing.users - 1 })
        }
        return next
      })

    const withLocks = <A, E, R>(
      requirements: readonly PathLockRequirement[],
      operation: Effect.Effect<A, E, R>,
      index = 0
    ): Effect.Effect<A, E, R> => {
      const requirement = requirements[index]
      if (!requirement) {
        return operation
      }

      return Effect.acquireUseRelease(
        reservePathLock(requirement.path),
        (semaphore) =>
          semaphore.withPermits(
            requirement.mode === 'exclusive'
              ? EXCLUSIVE_LOCK_PERMITS
              : SHARED_LOCK_PERMITS
          )(withLocks(requirements, operation, index + 1)),
        () => releasePathLock(requirement.path)
      )
    }

    const coordinateRead = <A, E, R>(
      path: string,
      operation: Effect.Effect<A, E, R>
    ) => withLocks(pathLockRequirements(backing, [path], 'shared'), operation)

    const coordinateMutation = <A, E, R>(
      paths: readonly string[],
      operation: Effect.Effect<A, E, R>
    ) =>
      SubscriptionRef.update(pending, (count) => count + 1).pipe(
        Effect.zipRight(
          withLocks(pathLockRequirements(backing, paths), operation)
        ),
        Effect.ensuring(SubscriptionRef.update(pending, (count) => count - 1))
      )

    const createEntryAt = <A>(
      operation: 'create-directory' | 'create-file',
      path: string,
      create: Effect.Effect<A, FileSystemError>
    ) =>
      fileSystem.exists(path).pipe(
        Effect.flatMap((exists) =>
          exists
            ? Effect.fail(
                fileSystemError(
                  operation,
                  path,
                  Object.assign(new Error(`Path ${path} already exists`), {
                    code: 'EEXIST',
                  })
                )
              )
            : create
        )
      )

    const createFileAt = (path: string, contents: Uint8Array) =>
      createEntryAt('create-file', path, fileSystem.writeFile(path, contents))

    const createDirectoryAt = (path: string) =>
      createEntryAt('create-directory', path, fileSystem.makeDirectory(path))

    const createUniqueFileAt = (
      parent: string,
      name: FileNameParts,
      contents: Uint8Array
    ) =>
      Effect.gen(function* () {
        let suffix = 0

        while (true) {
          const path = backing.join(parent, fileNameCandidate(name, suffix))
          if (!(yield* fileSystem.exists(path))) {
            yield* fileSystem.writeFile(path, contents)
            return path
          }
          suffix += 1
        }
      })

    const createUniqueDirectoryAt = (parent: string, preferredName: string) =>
      Effect.gen(function* () {
        const baseName = preferredName.replace(/-\d+$/, '')
        let suffix = 0

        while (true) {
          const name = suffix === 0 ? preferredName : `${baseName}-${suffix}`
          const path = backing.join(parent, name)
          if (!(yield* fileSystem.exists(path))) {
            yield* fileSystem.makeDirectory(path)
            return path
          }
          suffix += 1
        }
      })

    return FileOperations.of({
      pending: SubscriptionRef.get(pending),
      pendingChanges: pending.changes,
      readFile: (path) => coordinateRead(path, fileSystem.readFile(path)),
      copy: (source, destination) =>
        coordinateMutation(
          [source, destination],
          fileSystem.copy(source, destination)
        ),
      writeFile: (path, contents) =>
        coordinateMutation([path], fileSystem.writeFile(path, contents)),
      createFile: (path, contents) =>
        coordinateMutation([path], createFileAt(path, contents)),
      // As with unique directories, an exclusive parent lock makes candidate
      // selection and creation one coordinated operation.
      createUniqueFile: (parent, name, contents) =>
        coordinateMutation(
          [parent],
          createUniqueFileAt(parent, name, contents)
        ),
      createDirectory: (path) =>
        coordinateMutation([path], createDirectoryAt(path)),
      // Lock the parent exclusively while selecting and creating the name.
      // Child mutations take a shared parent lock, so no coordinated caller
      // can claim the same candidate between the existence check and creation.
      createUniqueDirectory: (parent, preferredName) =>
        coordinateMutation(
          [parent],
          createUniqueDirectoryAt(parent, preferredName)
        ),
      remove: (path) => coordinateMutation([path], fileSystem.remove(path)),
      rename: (source, destination) =>
        coordinateMutation(
          [source, destination],
          fileSystem.rename(source, destination)
        ),
    })
  })

export const fileOperationsLayer = (backing: IZooDesignStudioFS) =>
  Layer.effect(FileOperations, makeFileOperations(backing))

export const pendingFileOperations = FileOperations.pipe(
  Effect.flatMap((operations) => operations.pending)
)

export const fileOperationChanges = FileOperations.pipe(
  Effect.map((operations) => operations.pendingChanges),
  Stream.unwrap
)

export const readFile = (path: string) =>
  FileOperations.pipe(Effect.flatMap((operations) => operations.readFile(path)))

export const copy = (source: string, destination: string) =>
  FileOperations.pipe(
    Effect.flatMap((operations) => operations.copy(source, destination))
  )

export const writeFile = (path: string, contents: Uint8Array) =>
  FileOperations.pipe(
    Effect.flatMap((operations) => operations.writeFile(path, contents))
  )

export const createFile = (path: string, contents: Uint8Array) =>
  FileOperations.pipe(
    Effect.flatMap((operations) => operations.createFile(path, contents))
  )

export const createUniqueFile = (
  parent: string,
  name: FileNameParts,
  contents: Uint8Array
) =>
  FileOperations.pipe(
    Effect.flatMap((operations) =>
      operations.createUniqueFile(parent, name, contents)
    )
  )

export const createDirectory = (path: string) =>
  FileOperations.pipe(
    Effect.flatMap((operations) => operations.createDirectory(path))
  )

export const createUniqueDirectory = (parent: string, preferredName: string) =>
  FileOperations.pipe(
    Effect.flatMap((operations) =>
      operations.createUniqueDirectory(parent, preferredName)
    )
  )

export const remove = (path: string) =>
  FileOperations.pipe(Effect.flatMap((operations) => operations.remove(path)))

export const rename = (source: string, destination: string) =>
  FileOperations.pipe(
    Effect.flatMap((operations) => operations.rename(source, destination))
  )
