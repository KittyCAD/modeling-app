import {
  copy as copyOperation,
  createDirectory as createDirectoryOperation,
  createFile as createFileOperation,
  createUniqueDirectory as createUniqueDirectoryOperation,
  createUniqueFile as createUniqueFileOperation,
  type FileOperations,
  fileOperationsLayer,
  pendingFileOperations,
  readFile as readFileOperation,
  remove as removeOperation,
  rename as renameOperation,
  writeFile as writeFileOperation,
} from '@src/lib/fileSystem/fileOperations'
import {
  copy,
  exists,
  type FileSystem,
  type FileSystemError,
  legacyFileSystemLayer,
  makeDirectory,
  readDirectory,
  readFile,
  remove,
  rename,
  stat,
  writeFile,
} from '@src/lib/fileSystem/fileSystem'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { FileSystemRegistryService } from '@src/registry/contracts/fileSystem'
import { Effect, Either, Layer, ManagedRuntime } from 'effect'

export interface FileSystemRuntime {
  readonly service: FileSystemRegistryService
  readonly operations: FileOperationsRegistryService
  readonly dispose: () => Promise<void>
}

/**
 * Own one Effect runtime for the mounted filesystem registry node.
 *
 * Promise conversion happens privately at this registry boundary. Effect-aware
 * code composes against the filesystem tags and layers while registry consumers
 * use conventional Promise facades.
 */
export function createFileSystemRuntime(
  backing: IZooDesignStudioFS
): FileSystemRuntime {
  const fileSystemLayer = legacyFileSystemLayer(backing)
  const layer = fileOperationsLayer(backing).pipe(
    Layer.provideMerge(fileSystemLayer)
  )
  const runtime = ManagedRuntime.make(layer)

  const runRuntimePromise = async <A, E, R extends FileSystem | FileOperations>(
    program: Effect.Effect<A, E, R>
  ): Promise<A> => {
    const result = await runtime.runPromise(program.pipe(Effect.either))
    if (Either.isLeft(result)) {
      return Promise.reject(result.left)
    }
    return result.right
  }

  const service: FileSystemRegistryService = {
    stat: (path) => runRuntimePromise(stat(path)),
    exists: (path) => runRuntimePromise(exists(path)),
    readDirectory: (path) => runRuntimePromise(readDirectory(path)),
    readFile: (path) => runRuntimePromise(readFile(path)),
    copy: (source, destination) => runRuntimePromise(copy(source, destination)),
    writeFile: (path, contents) => runRuntimePromise(writeFile(path, contents)),
    makeDirectory: (path) => runRuntimePromise(makeDirectory(path)),
    remove: (path) => runRuntimePromise(remove(path)),
    rename: (source, destination) =>
      runRuntimePromise(rename(source, destination)),
  }

  const operations: FileOperationsRegistryService = {
    pending: () => runRuntimePromise(pendingFileOperations),
    readFile: (path) => runRuntimePromise(readFileOperation(path)),
    copy: (source, destination) =>
      runRuntimePromise(copyOperation(source, destination)),
    writeFile: (path, contents) =>
      runRuntimePromise(writeFileOperation(path, contents)),
    createFile: (path, contents) =>
      runRuntimePromise(createFileOperation(path, contents)),
    createUniqueFile: (parent, name, contents) =>
      runRuntimePromise(createUniqueFileOperation(parent, name, contents)),
    createDirectory: (path) =>
      runRuntimePromise(createDirectoryOperation(path)),
    createUniqueDirectory: (parent, preferredName) =>
      runRuntimePromise(createUniqueDirectoryOperation(parent, preferredName)),
    remove: (path) => runRuntimePromise(removeOperation(path)),
    rename: (source, destination) =>
      runRuntimePromise(renameOperation(source, destination)),
  }

  return {
    service,
    operations,
    dispose: runtime.dispose,
  }
}

export type FileSystemProgram<A> = Effect.Effect<A, FileSystemError, FileSystem>
