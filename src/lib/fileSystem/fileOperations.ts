import {
  type FileNameParts,
  fileNameCandidate,
} from '@src/lib/fileSystem/fileNames'
import {
  type DirectoryEntry,
  type FileStat,
  FileSystem,
  type FileSystemError,
  fileSystemError,
} from '@src/lib/fileSystem/fileSystem'
import {
  type PathLockRequirement,
  pathLockRequirements,
} from '@src/lib/fileSystem/pathLocking'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as SynchronizedRef from 'effect/SynchronizedRef'

const SHARED_LOCK_PERMITS = 1
const EXCLUSIVE_LOCK_PERMITS = 1_000_000

interface PathLockEntry {
  readonly semaphore: Effect.Semaphore
  readonly users: number
}

/**
 * Contents accepted by file-writing operations.
 *
 * Strings are encoded as UTF-8. Mutable byte arrays are copied before the
 * operation enters the coordination queue, so later caller mutation cannot
 * change the submitted write.
 */
export type FileContents = string | Uint8Array

export interface CopyOptions {
  /** Whether an existing destination entry may be replaced. */
  readonly overwrite?: boolean
}

const textEncoder = new TextEncoder()

function snapshotFileContents(contents: FileContents): Uint8Array {
  return typeof contents === 'string'
    ? textEncoder.encode(contents)
    : new Uint8Array(contents)
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
  /** Observe one path while coordinated mutations of it are excluded. */
  readonly stat: (path: string) => Effect.Effect<FileStat, FileSystemError>
  /**
   * Observe whether one path currently exists.
   *
   * Call a strict or unique creation operation instead of using this result
   * to choose a name; the observation is not a reservation.
   */
  readonly exists: (path: string) => Effect.Effect<boolean, FileSystemError>
  /** Read a stable snapshot of a directory's immediate membership. */
  readonly readDirectory: (
    path: string
  ) => Effect.Effect<readonly DirectoryEntry[], FileSystemError>
  /** Read one complete version of a file coordinated with path mutations. */
  readonly readFile: (
    path: string
  ) => Effect.Effect<Uint8Array, FileSystemError>
  readonly copy: (
    source: string,
    destination: string,
    options?: CopyOptions
  ) => Effect.Effect<void, FileSystemError>
  /**
   * Move a file or directory, falling back to copy-and-remove when the
   * backing cannot rename across the source and destination locations.
   */
  readonly move: (
    source: string,
    destination: string
  ) => Effect.Effect<void, FileSystemError>
  /** Write bytes or a UTF-8 string to a path. */
  readonly writeFile: (
    path: string,
    contents: FileContents
  ) => Effect.Effect<void, FileSystemError>
  /**
   * Create exactly this path from bytes or a UTF-8 string without
   * overwriting an existing entry.
   */
  readonly createFile: (
    path: string,
    contents: FileContents
  ) => Effect.Effect<void, FileSystemError>
  /**
   * Create the preferred filename or a numbered variant from bytes or a UTF-8
   * string, then return its path.
   */
  readonly createUniqueFile: (
    parent: string,
    name: FileNameParts,
    contents: FileContents
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
    const directoryMembershipLocks = yield* SynchronizedRef.make(
      new Map<string, PathLockEntry>()
    )

    const reserveLock = (locks: typeof pathLocks, path: string) =>
      SynchronizedRef.modifyEffect(locks, (entries) => {
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

    const releaseLock = (locks: typeof pathLocks, path: string) =>
      SynchronizedRef.update(locks, (entries) => {
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
      locks: typeof pathLocks,
      requirements: readonly PathLockRequirement[],
      operation: Effect.Effect<A, E, R>,
      index = 0
    ): Effect.Effect<A, E, R> => {
      const requirement = requirements[index]
      if (!requirement) {
        return operation
      }

      return Effect.acquireUseRelease(
        reserveLock(locks, requirement.path),
        (semaphore) =>
          semaphore.withPermits(
            requirement.mode === 'exclusive'
              ? EXCLUSIVE_LOCK_PERMITS
              : SHARED_LOCK_PERMITS
          )(withLocks(locks, requirements, operation, index + 1)),
        () => releaseLock(locks, requirement.path)
      )
    }

    const withPathLocks = <A, E, R>(
      requirements: readonly PathLockRequirement[],
      operation: Effect.Effect<A, E, R>
    ) => withLocks(pathLocks, requirements, operation)

    const withDirectoryMembershipLocks = <A, E, R>(
      paths: readonly string[],
      mode: PathLockRequirement['mode'],
      operation: Effect.Effect<A, E, R>
    ) =>
      withLocks(
        directoryMembershipLocks,
        [...new Set(paths.map((path) => backing.resolve(path)))]
          .sort((left, right) => left.localeCompare(right))
          .map((path) => ({ path, mode })),
        operation
      )

    const coordinateRead = <A, E, R>(
      path: string,
      operation: Effect.Effect<A, E, R>
    ) =>
      withPathLocks(pathLockRequirements(backing, [path], 'shared'), operation)

    const coordinateDirectoryRead = <A, E, R>(
      path: string,
      operation: Effect.Effect<A, E, R>
    ) =>
      withPathLocks(
        pathLockRequirements(backing, [path], 'shared'),
        withDirectoryMembershipLocks([path], 'shared', operation)
      )

    const trackMutation = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
      SubscriptionRef.update(pending, (count) => count + 1).pipe(
        Effect.zipRight(operation),
        Effect.ensuring(SubscriptionRef.update(pending, (count) => count - 1))
      )

    const coordinateMutation = <A, E, R>(
      paths: readonly string[],
      operation: Effect.Effect<A, E, R>,
      membershipPaths = paths.map((path) => backing.dirname(path))
    ) =>
      trackMutation(
        withPathLocks(
          pathLockRequirements(backing, paths),
          withDirectoryMembershipLocks(membershipPaths, 'exclusive', operation)
        )
      )

    const coordinateWrite = (path: string, contents: Uint8Array) =>
      trackMutation(
        withPathLocks(
          pathLockRequirements(backing, [path]),
          fileSystem
            .exists(path)
            .pipe(
              Effect.flatMap((exists) =>
                exists
                  ? fileSystem.writeFile(path, contents)
                  : withDirectoryMembershipLocks(
                      [backing.dirname(path)],
                      'exclusive',
                      fileSystem.writeFile(path, contents)
                    )
              )
            )
        )
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

    const moveEntry = (source: string, destination: string) =>
      Effect.gen(function* () {
        const sourceStat = yield* fileSystem.stat(source)
        const destinationExists = yield* fileSystem.exists(destination)

        if (!destinationExists) {
          yield* fileSystem.makeDirectory(backing.dirname(destination))
          const renamed = yield* fileSystem.rename(source, destination).pipe(
            Effect.as(true),
            Effect.catchAll(() => Effect.succeed(false))
          )
          if (renamed) {
            return
          }
        }

        yield* fileSystem.makeDirectory(
          sourceStat.kind === 'directory'
            ? destination
            : backing.dirname(destination)
        )
        yield* fileSystem.copy(source, destination)
        yield* fileSystem.remove(source)
      })

    return FileOperations.of({
      pending: SubscriptionRef.get(pending),
      pendingChanges: pending.changes,
      stat: (path) => coordinateRead(path, fileSystem.stat(path)),
      exists: (path) => coordinateRead(path, fileSystem.exists(path)),
      readDirectory: (path) =>
        coordinateDirectoryRead(path, fileSystem.readDirectory(path)),
      readFile: (path) => coordinateRead(path, fileSystem.readFile(path)),
      copy: (source, destination, options) =>
        coordinateMutation(
          [source, destination],
          fileSystem.copy(source, destination, options?.overwrite)
        ),
      move: (source, destination) =>
        coordinateMutation(
          [source, destination],
          moveEntry(source, destination)
        ),
      writeFile: (path, contents) =>
        coordinateWrite(path, snapshotFileContents(contents)),
      createFile: (path, contents) =>
        coordinateMutation(
          [path],
          createFileAt(path, snapshotFileContents(contents))
        ),
      // As with unique directories, an exclusive parent lock makes candidate
      // selection and creation one coordinated operation.
      createUniqueFile: (parent, name, contents) =>
        coordinateMutation(
          [parent],
          createUniqueFileAt(parent, name, snapshotFileContents(contents)),
          [parent]
        ),
      createDirectory: (path) =>
        coordinateMutation([path], createDirectoryAt(path)),
      // Lock the parent exclusively while selecting and creating the name.
      // Child mutations take a shared parent lock, so no coordinated caller
      // can claim the same candidate between the existence check and creation.
      createUniqueDirectory: (parent, preferredName) =>
        coordinateMutation(
          [parent],
          createUniqueDirectoryAt(parent, preferredName),
          [parent]
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

export const stat = (path: string) =>
  FileOperations.pipe(Effect.flatMap((operations) => operations.stat(path)))

export const exists = (path: string) =>
  FileOperations.pipe(Effect.flatMap((operations) => operations.exists(path)))

export const readDirectory = (path: string) =>
  FileOperations.pipe(
    Effect.flatMap((operations) => operations.readDirectory(path))
  )

export const readFile = (path: string) =>
  FileOperations.pipe(Effect.flatMap((operations) => operations.readFile(path)))

export const copy = (
  source: string,
  destination: string,
  options?: CopyOptions
) =>
  FileOperations.pipe(
    Effect.flatMap((operations) =>
      operations.copy(source, destination, options)
    )
  )

export const move = (source: string, destination: string) =>
  FileOperations.pipe(
    Effect.flatMap((operations) => operations.move(source, destination))
  )

export const writeFile = (path: string, contents: FileContents) =>
  FileOperations.pipe(
    Effect.flatMap((operations) => operations.writeFile(path, contents))
  )

export const createFile = (path: string, contents: FileContents) =>
  FileOperations.pipe(
    Effect.flatMap((operations) => operations.createFile(path, contents))
  )

export const createUniqueFile = (
  parent: string,
  name: FileNameParts,
  contents: FileContents
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

// Keep one canonical definition for filesystem values and failures while
// exposing them through the application-facing capability.
export {
  type DirectoryEntry,
  FileAlreadyExists,
  FileIoFailure,
  type FileKind,
  FileNotFound,
  FileOperationUnsupported,
  FilePermissionDenied,
  type FileStat,
  type FileSystemError,
  type FileSystemOperation,
} from '@src/lib/fileSystem/fileSystem'
