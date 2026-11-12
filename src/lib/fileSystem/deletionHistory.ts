import type {
  FileSystemService,
  FileSystemError,
} from '@src/lib/fileSystem/fileSystem'
import {
  fileSystemError,
  ownFileContents,
} from '@src/lib/fileSystem/fileSystem'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import * as Effect from 'effect/Effect'

type Entry =
  | { readonly path: string; readonly kind: 'directory' }
  | { readonly path: string; readonly kind: 'file'; readonly bytes: Uint8Array }

/** Retained only by the editor's in-memory undo history; never serialized. */
export interface MemoryFileDeletion {
  readonly path: string
  readonly entries: readonly Entry[]
}

/** Call under the coordinator's exclusive subtree lock, including removal. */
export function captureDeletion(
  fs: FileSystemService,
  paths: Pick<IZooDesignStudioFS, 'join'>,
  path: string
): Effect.Effect<MemoryFileDeletion, FileSystemError> {
  const visit = (path: string): Effect.Effect<Entry[], FileSystemError> =>
    Effect.gen(function* () {
      const stat = yield* fs.stat(path, { followSymlinks: false })
      if (stat.kind === 'symlink')
        return yield* Effect.fail(
          fileSystemError(
            'remove',
            path,
            new Error('Deleting symbolic links with undo is not supported.')
          )
        )
      if (stat.kind === 'file')
        return [
          {
            path,
            kind: 'file',
            bytes: new Uint8Array(yield* fs.readFile(path)),
          },
        ]
      const entries: Entry[] = [{ path, kind: 'directory' }]
      for (const name of [...(yield* fs.readDirectory(path))].sort())
        entries.push(...(yield* visit(paths.join(path, name))))
      return entries
    })
  return visit(path).pipe(Effect.map((entries) => ({ path, entries })))
}

function sameContents(a: MemoryFileDeletion, b: MemoryFileDeletion): boolean {
  return (
    a.entries.length === b.entries.length &&
    a.entries.every((entry, i) => {
      const other = b.entries[i]
      return (
        other?.path === entry.path &&
        other.kind === entry.kind &&
        (entry.kind === 'directory' ||
          (other.kind === 'file' &&
            entry.bytes.length === other.bytes.length &&
            entry.bytes.every((byte, i) => byte === other.bytes[i])))
      )
    })
  )
}

/** Replay under the same exclusive subtree lock as capture and deletion. */
export function replayDeletion(
  fs: FileSystemService,
  paths: Pick<IZooDesignStudioFS, 'join'>,
  deletion: MemoryFileDeletion,
  restore: boolean
): Effect.Effect<void, FileSystemError> {
  return Effect.gen(function* () {
    // lstat also detects dangling links occupying the destination.
    const exists = yield* fs
      .stat(deletion.path, { followSymlinks: false })
      .pipe(
        Effect.as(true),
        Effect.catchTag('FileNotFound', () => Effect.succeed(false))
      )
    if (exists) {
      const current = yield* captureDeletion(fs, paths, deletion.path)
      if (!sameContents(current, deletion))
        return yield* Effect.fail(
          fileSystemError(
            restore ? 'create-file' : 'remove',
            deletion.path,
            new Error(
              restore
                ? 'Cannot restore: the deleted path has been reused.'
                : 'Cannot redo deletion: the restored contents have changed.'
            )
          )
        )
      if (!restore) yield* fs.remove(deletion.path)
    } else if (restore) {
      const created: Entry[] = []
      let attempted: Entry | undefined
      yield* Effect.gen(function* () {
        for (const entry of deletion.entries) {
          attempted = entry
          if (entry.kind === 'directory') yield* fs.makeDirectory(entry.path)
          else yield* fs.createFile(entry.path, ownFileContents(entry.bytes))
          created.push(entry)
          attempted = undefined
        }
      }).pipe(
        Effect.catchAll((error) =>
          // Roll back our partial restoration only if nothing else changed it.
          captureDeletion(fs, paths, deletion.path).pipe(
            Effect.flatMap((current) => {
              const failed = attempted
              const partial = current.entries.find(
                (entry) => entry.path === failed?.path
              )
              // Exclusive creation can fail after writing a prefix of the file.
              // A collision is never ours; unexpected bytes or siblings also
              // prevent rollback, just like changes to completed entries.
              if (
                error._tag !== 'FileAlreadyExists' &&
                failed?.kind === 'file' &&
                partial?.kind === 'file' &&
                partial.bytes.length <= failed.bytes.length &&
                partial.bytes.every((byte, i) => byte === failed.bytes[i])
              )
                created.push(partial)
              return sameContents(current, {
                path: deletion.path,
                entries: created,
              })
                ? fs.remove(deletion.path)
                : Effect.void
            }),
            Effect.catchAll(() => Effect.void),
            Effect.zipRight(Effect.fail(error))
          )
        )
      )
    }
  })
}
