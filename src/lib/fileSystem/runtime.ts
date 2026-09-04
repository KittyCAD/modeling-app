import {
  canReadWrite as canReadWriteOperation,
  copy as copyOperation,
  createDirectory as createDirectoryOperation,
  createFile as createFileOperation,
  createUniqueDirectory as createUniqueDirectoryOperation,
  createUniqueFile as createUniqueFileOperation,
  exists as existsOperation,
  type FileOperations,
  fileOperationsLayer,
  move as moveOperation,
  pendingFileOperations,
  readDirectory as readDirectoryOperation,
  readFile as readFileOperation,
  remove as removeOperation,
  rename as renameOperation,
  stat as statOperation,
  writeFile as writeFileOperation,
} from '@src/lib/fileSystem/fileOperations'
import {
  type FileOperationsOperation,
  reportFileOperationsError,
} from '@src/lib/fileSystem/fileOperationsClientErrorReporting'
import {
  type FileSystemError,
  fileSystemLayer,
} from '@src/lib/fileSystem/fileSystem'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'

export interface FileOperationsRuntime {
  readonly operations: FileOperationsRegistryService
  readonly dispose: () => Promise<void>
}

/**
 * Own one Effect runtime for the mounted file-operations registry node.
 *
 * Promise conversion happens privately at this registry boundary. Effect-aware
 * code composes against the internal filesystem layers while registry
 * consumers use the conventional FileOperations Promise facade.
 */
export function createFileOperationsRuntime(
  backing: IZooDesignStudioFS
): FileOperationsRuntime {
  const baseLayer = fileSystemLayer(backing)
  const layer = fileOperationsLayer(backing).pipe(Layer.provide(baseLayer))
  const runtime = ManagedRuntime.make(layer)

  const runRuntimePromise = async <A, E, R extends FileOperations>(
    program: Effect.Effect<A, E, R>,
    onFailure?: (error: E) => void
  ): Promise<A> => {
    const result = await runtime.runPromise(program.pipe(Effect.either))
    if (Either.isLeft(result)) {
      onFailure?.(result.left)
      return Promise.reject(result.left)
    }
    return result.right
  }

  const runFileOperationsPromise = <A>(
    operation: FileOperationsOperation,
    program: Effect.Effect<A, FileSystemError, FileOperations>
  ) =>
    runRuntimePromise(program, (error) =>
      reportFileOperationsError(operation, error)
    )

  const operations: FileOperationsRegistryService = {
    pending: () => runRuntimePromise(pendingFileOperations),
    stat: (path) => runFileOperationsPromise('stat', statOperation(path)),
    canReadWrite: (path) =>
      runFileOperationsPromise('access', canReadWriteOperation(path)),
    exists: (path) => runFileOperationsPromise('exists', existsOperation(path)),
    readDirectory: (path) =>
      runFileOperationsPromise('read-directory', readDirectoryOperation(path)),
    readFile: (path) =>
      runFileOperationsPromise('read-file', readFileOperation(path)),
    copy: (source, destination, options) =>
      runFileOperationsPromise(
        'copy',
        copyOperation(source, destination, options)
      ),
    move: (source, destination) =>
      runFileOperationsPromise('move', moveOperation(source, destination)),
    writeFile: (path, contents) =>
      runFileOperationsPromise(
        'write-file',
        writeFileOperation(path, contents)
      ),
    createFile: (path, contents) =>
      runFileOperationsPromise(
        'create-file',
        createFileOperation(path, contents)
      ),
    createUniqueFile: (parent, name, contents) =>
      runFileOperationsPromise(
        'create-unique-file',
        createUniqueFileOperation(parent, name, contents)
      ),
    createDirectory: (path) =>
      runFileOperationsPromise(
        'create-directory',
        createDirectoryOperation(path)
      ),
    createUniqueDirectory: (parent, preferredName) =>
      runFileOperationsPromise(
        'create-unique-directory',
        createUniqueDirectoryOperation(parent, preferredName)
      ),
    remove: (path) => runFileOperationsPromise('remove', removeOperation(path)),
    rename: (source, destination) =>
      runFileOperationsPromise('rename', renameOperation(source, destination)),
  }

  return {
    operations,
    dispose: runtime.dispose,
  }
}

export type FileOperationsProgram<A> = Effect.Effect<
  A,
  FileSystemError,
  FileOperations
>
