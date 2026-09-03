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
import type { FileSystemRegistryService } from '@src/registry/contracts/fileSystem'
import { Effect, Either, ManagedRuntime } from 'effect'

export interface FileSystemRuntime {
  readonly service: FileSystemRegistryService
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
  const runtime = ManagedRuntime.make(legacyFileSystemLayer(backing))

  const runRuntimePromise = async <A, E>(
    program: Effect.Effect<A, E, FileSystem>
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

  return {
    service,
    dispose: runtime.dispose,
  }
}

export type FileSystemProgram<A> = Effect.Effect<A, FileSystemError, FileSystem>
