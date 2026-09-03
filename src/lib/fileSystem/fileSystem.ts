import { fsZdsConstants } from '@src/lib/fs-zds/constants'
import type {
  IStat as BackingFileStat,
  IZooDesignStudioFS,
} from '@src/lib/fs-zds/interface'
import { Context, Data, Effect, Layer } from 'effect'

export type FileKind = 'file' | 'directory'

export interface FileStat {
  readonly kind: FileKind
  readonly size: number
  readonly modifiedAt: number
}

export interface DirectoryEntry {
  readonly name: string
  readonly kind: FileKind
}

export type FileSystemOperation =
  | 'copy'
  | 'create-directory'
  | 'create-file'
  | 'read-directory'
  | 'read-file'
  | 'remove'
  | 'rename'
  | 'stat'
  | 'write-file'

interface FileSystemErrorDetails {
  readonly operation: FileSystemOperation
  readonly path: string
  readonly destination?: string
  readonly cause: unknown
  readonly message: string
}

/** A requested filesystem path does not exist. */
export class FileNotFound extends Data.TaggedError(
  'FileNotFound'
)<FileSystemErrorDetails> {}

/** A filesystem mutation would overwrite an existing entry. */
export class FileAlreadyExists extends Data.TaggedError(
  'FileAlreadyExists'
)<FileSystemErrorDetails> {}

/** The current process or browser grant does not permit this operation. */
export class FilePermissionDenied extends Data.TaggedError(
  'FilePermissionDenied'
)<FileSystemErrorDetails> {}

/** The active platform does not implement this filesystem operation. */
export class FileOperationUnsupported extends Data.TaggedError(
  'FileOperationUnsupported'
)<FileSystemErrorDetails> {}

/** An unclassified platform I/O failure. */
export class FileIoFailure extends Data.TaggedError(
  'FileIoFailure'
)<FileSystemErrorDetails> {}

export type FileSystemError =
  | FileNotFound
  | FileAlreadyExists
  | FilePermissionDenied
  | FileOperationUnsupported
  | FileIoFailure

/**
 * Platform-independent filesystem effects.
 *
 * The service deliberately contains no navigation, notifications, or project
 * policy. Those concerns belong to callers and to the coordinated storage
 * service built above this capability.
 */
export interface FileSystemService {
  readonly stat: (path: string) => Effect.Effect<FileStat, FileSystemError>
  readonly exists: (path: string) => Effect.Effect<boolean, FileSystemError>
  readonly readDirectory: (
    path: string
  ) => Effect.Effect<readonly DirectoryEntry[], FileSystemError>
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
  readonly makeDirectory: (path: string) => Effect.Effect<void, FileSystemError>
  readonly remove: (path: string) => Effect.Effect<void, FileSystemError>
  readonly rename: (
    source: string,
    destination: string
  ) => Effect.Effect<void, FileSystemError>
}

export class FileSystem extends Context.Tag('zds/FileSystem')<
  FileSystem,
  FileSystemService
>() {}

function errorCode(cause: unknown): string | undefined {
  if (typeof cause === 'string') {
    return cause
  }
  if (typeof cause !== 'object' || cause === null) {
    return undefined
  }

  const code = 'code' in cause ? cause.code : undefined
  if (typeof code === 'string') {
    return code
  }

  const name = 'name' in cause ? cause.name : undefined
  return typeof name === 'string' ? name : undefined
}

function describeOperation(
  operation: FileSystemOperation,
  path: string,
  destination?: string
): string {
  const target = destination ? `${path} -> ${destination}` : path
  return `Unable to ${operation} ${target}`
}

export function fileSystemError(
  operation: FileSystemOperation,
  path: string,
  cause: unknown,
  destination?: string
): FileSystemError {
  const details: FileSystemErrorDetails = {
    operation,
    path,
    destination,
    cause,
    message: describeOperation(operation, path, destination),
  }

  switch (errorCode(cause)) {
    case 'ENOENT':
    case 'NotFoundError':
      return new FileNotFound(details)
    case 'EEXIST':
    case 'PathExistsError':
      return new FileAlreadyExists(details)
    case 'EACCES':
    case 'EPERM':
    case 'NotAllowedError':
    case 'SecurityError':
      return new FilePermissionDenied(details)
    case 'ENOTSUP':
    case 'EOPNOTSUPP':
    case 'NotSupportedError':
      return new FileOperationUnsupported(details)
    default:
      return new FileIoFailure(details)
  }
}

function tryBacking<A>(
  operation: FileSystemOperation,
  path: string,
  attempt: () => A | PromiseLike<A>,
  destination?: string
): Effect.Effect<A, FileSystemError> {
  return Effect.tryPromise({
    try: async () => await attempt(),
    catch: (cause) => fileSystemError(operation, path, cause, destination),
  })
}

function toFileStat(stat: BackingFileStat): FileStat {
  return {
    kind: stat.mode & fsZdsConstants.S_IFDIR ? 'directory' : ('file' as const),
    size: stat.size,
    modifiedAt: stat.mtimeMs,
  }
}

/**
 * Adapt an `fsZds` backing to the Effect capability.
 *
 * The adapter is intentionally the only module where Effect programs know
 * about the combined path/filesystem backing interface. `fsZds` remains
 * responsible for selecting the platform backing.
 */
export function makeFileSystem(backing: IZooDesignStudioFS): FileSystemService {
  const stat = (path: string) =>
    tryBacking('stat', path, () => backing.stat(path)).pipe(
      Effect.map(toFileStat)
    )

  const exists = (path: string) =>
    stat(path).pipe(
      Effect.as(true),
      Effect.catchTag('FileNotFound', () => Effect.succeed(false))
    )

  const readFile = (path: string) =>
    tryBacking('read-file', path, () => backing.readFile(path))

  const makeDirectory = (path: string) =>
    tryBacking('create-directory', path, () =>
      backing.mkdir(path, { recursive: true })
    ).pipe(Effect.asVoid)

  /**
   * Take ownership of mutable caller bytes before passing them to a backing.
   * The copy also normalizes SharedArrayBuffer-backed views to ArrayBuffer.
   */
  const snapshotBytes = (contents: Uint8Array) => new Uint8Array(contents)

  const writeFile = (path: string, contents: Uint8Array) => {
    const parent = backing.dirname(path)
    const bytes = snapshotBytes(contents)

    return makeDirectory(parent).pipe(
      Effect.zipRight(
        tryBacking('write-file', path, () => backing.writeFile(path, bytes))
      ),
      Effect.asVoid
    )
  }

  const service: FileSystemService = {
    stat,
    exists,
    readFile,
    makeDirectory,
    readDirectory: (path) =>
      tryBacking('read-directory', path, () => backing.readdir(path)).pipe(
        Effect.flatMap((names) =>
          Effect.forEach(
            names,
            (name) =>
              stat(backing.join(path, name)).pipe(
                Effect.map(
                  (entry): DirectoryEntry => ({ name, kind: entry.kind })
                )
              ),
            { concurrency: 'unbounded' }
          )
        )
      ),
    copy: (source, destination) =>
      tryBacking(
        'copy',
        source,
        () => backing.cp(source, destination, { recursive: true }),
        destination
      ).pipe(Effect.asVoid),
    writeFile,
    remove: (path) =>
      tryBacking('remove', path, () =>
        backing.rm(path, { recursive: true })
      ).pipe(Effect.asVoid),
    rename: (source, destination) =>
      tryBacking(
        'rename',
        source,
        () => backing.rename(source, destination),
        destination
      ).pipe(Effect.asVoid),
  }

  return service
}

export const fileSystemLayer = (backing: IZooDesignStudioFS) =>
  Layer.succeed(FileSystem, makeFileSystem(backing))

export const stat = (path: string) =>
  FileSystem.pipe(Effect.flatMap((fileSystem) => fileSystem.stat(path)))

export const exists = (path: string) =>
  FileSystem.pipe(Effect.flatMap((fileSystem) => fileSystem.exists(path)))

export const readDirectory = (path: string) =>
  FileSystem.pipe(
    Effect.flatMap((fileSystem) => fileSystem.readDirectory(path))
  )

export const readFile = (path: string) =>
  FileSystem.pipe(Effect.flatMap((fileSystem) => fileSystem.readFile(path)))

export const copy = (source: string, destination: string) =>
  FileSystem.pipe(
    Effect.flatMap((fileSystem) => fileSystem.copy(source, destination))
  )

export const writeFile = (path: string, contents: Uint8Array) =>
  FileSystem.pipe(
    Effect.flatMap((fileSystem) => fileSystem.writeFile(path, contents))
  )

export const makeDirectory = (path: string) =>
  FileSystem.pipe(
    Effect.flatMap((fileSystem) => fileSystem.makeDirectory(path))
  )

export const remove = (path: string) =>
  FileSystem.pipe(Effect.flatMap((fileSystem) => fileSystem.remove(path)))

export const rename = (source: string, destination: string) =>
  FileSystem.pipe(
    Effect.flatMap((fileSystem) => fileSystem.rename(source, destination))
  )
