import {
  canReadWrite as canReadWriteOperation,
  copy as copyOperation,
  createDirectory as createDirectoryOperation,
  createFile as createFileOperation,
  createUniqueDirectory as createUniqueDirectoryOperation,
  createUniqueFile as createUniqueFileOperation,
  exists as existsOperation,
  type FileOperations,
  type FileOperationsOptions,
  fileOperationsLayer,
  move as moveOperation,
  pendingFileOperations,
  readDirectory as readDirectoryOperation,
  readFile as readFileOperation,
  remove as removeOperation,
  removeWithSnapshot,
  replayFileDeletion,
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
import { make as makeScheduler } from 'effect/ManagedRuntime'

export interface FileOperationsScheduler {
  readonly operations: FileOperationsRegistryService
  readonly dispose: () => Promise<void>
}

/**
 * Own shared locks and operation lifetimes for one filesystem backing.
 *
 * Promise conversion happens privately at this registry boundary. Effect-aware
 * code composes against the internal filesystem layers while registry
 * consumers use the conventional FileOperations Promise facade.
 */
export function createFileOperationsScheduler(
  backing: IZooDesignStudioFS,
  options: FileOperationsOptions = {}
): FileOperationsScheduler {
  const baseLayer = fileSystemLayer(backing)
  const layer = fileOperationsLayer(backing, options).pipe(
    Layer.provide(baseLayer)
  )
  const scheduler = makeScheduler(layer)
  const active = new Set<Promise<unknown>>()
  const track = <T>(task: Promise<T>) => {
    active.add(task)
    void task.then(
      () => active.delete(task),
      () => active.delete(task)
    )
    return task
  }

  const runScheduledPromise = async <A, E, R extends FileOperations>(
    program: Effect.Effect<A, E, R>,
    onFailure?: (error: E) => void
  ): Promise<A> => {
    const result = await track(
      scheduler.runPromise(program.pipe(Effect.either))
    )
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
    runScheduledPromise(program, (error) =>
      reportFileOperationsError(operation, error)
    )

  const operations: FileOperationsRegistryService = {
    pending: () => runScheduledPromise(pendingFileOperations),
    stat: (path, options) =>
      runFileOperationsPromise('stat', statOperation(path, options)),
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
    removeWithSnapshot: (path) =>
      runFileOperationsPromise('remove', removeWithSnapshot(path)),
    replayDeletion: (deletion, restore) =>
      runFileOperationsPromise(
        restore ? 'create-file' : 'remove',
        replayFileDeletion(deletion, restore)
      ),
    remove: (path) => runFileOperationsPromise('remove', removeOperation(path)),
    rename: (source, destination) =>
      runFileOperationsPromise('rename', renameOperation(source, destination)),
  }

  return {
    operations,
    dispose: async () => {
      while (active.size) await Promise.allSettled([...active])
      await scheduler.dispose()
    },
  }
}

export type FileOperationsProgram<A> = Effect.Effect<
  A,
  FileSystemError,
  FileOperations
>
