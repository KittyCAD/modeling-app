import type { FileSystem } from '@src/contracts/fileSystem'
import type { FsOperationQueue } from '@src/contracts/fsOperations'
import {
  type SerialisedChangeLog,
  parseChangeLog,
  serialiseChangeLog,
} from '@src/lib/collab/changeLog'
import type { AppliedChange } from '@src/lib/collab/revert'
import { hashString } from '@src/lib/hash'
import { joinPath } from '@src/lib/paths'

/** Where change logs live, relative to the project root. */
export const HISTORY_DIRECTORY = '.zoo/history'

export interface ChangeLogStore {
  /**
   * History for a file, or null when there is none to trust.
   *
   * `head` is the file as it now stands. A log that does not describe it is
   * refused rather than replayed — see `parseChangeLog` for the three reasons.
   */
  load(path: string, head: string): Promise<readonly AppliedChange[] | null>
  save(
    path: string,
    entries: readonly AppliedChange[],
    head: string
  ): Promise<void>
  remove(path: string): Promise<void>
}

/**
 * Change logs on disk, beside the project.
 *
 * A sibling of `transcriptStore` rather than part of it, because this is per
 * *file* and a transcript is per conversation — a turn spanning three files needs
 * history from all three, and two turns from different conversations share it.
 *
 * **Filenames are hashed.** A project-relative path contains separators, and
 * escaping them into a filename is the kind of scheme that works until somebody
 * has a folder called `main.kcl`. The path is stored inside the file so a hash
 * collision is detectable rather than silent — `parseChangeLog` refuses a log
 * whose recorded path is not the one asked for.
 *
 * Under `.zoo/`, so `src/lib/projectFiles.ts` skips it: invisible to the
 * explorer, to `session.files`, and to the baseline sent to the service.
 */
export function createChangeLogStore(dependencies: {
  /** Absolute project root. */
  projectPath: string
  fileSystem: FileSystem
  queue: FsOperationQueue
  /** Contributions of history to keep per file. */
  horizon?: number
}): ChangeLogStore {
  const { projectPath, fileSystem, queue, horizon } = dependencies

  const directory = () => joinPath(projectPath, HISTORY_DIRECTORY)
  const fileFor = (path: string) =>
    joinPath(directory(), `${hashString(path)}.json`)

  return {
    async load(path, head) {
      const contents = await fileSystem.readTextFileIfPresent(fileFor(path))
      if (contents === null) return null

      let serialised: SerialisedChangeLog
      try {
        serialised = JSON.parse(contents) as SerialisedChangeLog
      } catch {
        // Unreadable is the same as absent to a caller: there is no history it
        // can trust, and saying why would not change what it does next.
        return null
      }

      return parseChangeLog(serialised, { path, head })
    },

    async save(path, entries, head) {
      const file = fileFor(path)
      const serialised = serialiseChangeLog({
        path,
        entries,
        head,
        ...(horizon === undefined ? {} : { horizon }),
      })
      const contents = JSON.stringify(serialised)

      await queue.enqueue(file, async () => {
        await fileSystem.makeDirectory(directory())
        // Recorded before the write, so the watcher recognises the change as ours
        // by content rather than reporting it as an external edit.
        queue.recordWrite(file, hashString(contents))
        await fileSystem.writeTextFile(file, contents)
      })
    },

    async remove(path) {
      const file = fileFor(path)
      await queue.enqueue(file, async () => {
        try {
          await fileSystem.remove(file)
        } catch {
          // Already gone is the outcome the caller wanted.
        }
      })
    },
  }
}
