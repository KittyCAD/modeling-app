import type { FileSystemService } from '@src/lib/fileSystem/fileSystem'
import { fileSystemError } from '@src/lib/fileSystem/fileSystem'
import { conservativePathLockKey } from '@src/lib/fileSystem/pathLocking'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'
import * as Effect from 'effect/Effect'

/** Call while source, destination, and parent membership mutations are excluded. */
export function renameEntry(
  fs: FileSystemService,
  paths: Pick<IZooDesignStudioFS, 'dirname' | 'basename'>,
  source: string,
  destination: string
) {
  return Effect.gen(function* () {
    const target = yield* fs
      .stat(destination, { followSymlinks: false })
      .pipe(Effect.catchTag('FileNotFound', () => Effect.succeed(undefined)))
    if (target && source !== destination) {
      const original = yield* fs.stat(source, { followSymlinks: false })
      const sourceParent = paths.dirname(source)
      const destinationParent = paths.dirname(destination)
      const parent = yield* fs.stat(sourceParent)
      const targetParent = yield* fs.stat(destinationParent)
      const nameKey = conservativePathLockKey(paths.basename(source))
      const sameEntry = fs.isSameEntry
        ? yield* fs.isSameEntry(source, destination)
        : Number.isSafeInteger(original.inode) &&
          original.inode !== 0 &&
          original.inode === target.inode &&
          original.device === target.device
      const sameParent = fs.isSameEntry
        ? yield* fs.isSameEntry(sourceParent, destinationParent)
        : Number.isSafeInteger(parent.inode) &&
          parent.inode !== 0 &&
          parent.inode === targetParent.inode &&
          parent.device === targetParent.device
      // A shared inode alone is insufficient: distinct hard links may have it.
      // One directory entry must account for both spellings on this backing.
      const alias =
        sameEntry &&
        sameParent &&
        nameKey === conservativePathLockKey(paths.basename(destination)) &&
        (yield* fs.readDirectory(sourceParent)).filter(
          (name) => conservativePathLockKey(name) === nameKey
        ).length === 1
      if (!alias)
        return yield* Effect.fail(
          fileSystemError(
            'rename',
            source,
            Object.assign(new Error('Name already exists.'), {
              code: 'EEXIST',
            }),
            destination
          )
        )
    }
    yield* fs.rename(source, destination)
  })
}
