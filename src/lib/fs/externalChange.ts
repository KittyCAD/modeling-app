import type { FileSystem } from '@src/contracts/fileSystem'
import type { FileChange } from '@src/contracts/fileWatcher'
import type { FsOperationQueue } from '@src/contracts/fsOperations'
import { hashString } from '@src/lib/hash'

/**
 * Read a watched change, and only if something else made it.
 *
 * Returns null when the change was this app's own write coming back, when the
 * file is gone, or when it cannot be read. The provenance check is the important
 * one: autosave writes while someone keeps typing, so a save that echoes back as
 * an incoming change would report a conflict against content the app produced
 * itself — and the divergence bar would appear mid-sentence.
 *
 * Matching is on content, not on timing. A path-and-timestamp guess would drop a
 * genuine external edit that happened to land in the same window.
 */
export async function readExternalChange(
  fileSystem: FileSystem,
  queue: FsOperationQueue,
  change: FileChange
): Promise<{ contents: string } | null> {
  if (change.kind === 'removed') return null

  let contents: string
  try {
    contents = await fileSystem.readTextFile(change.path)
  } catch {
    // Racing the writer is normal: the file can vanish or be locked between the
    // event and the read. The next event will bring it.
    return null
  }

  if (queue.isOwnWrite(change.path, hashString(contents))) return null
  return { contents }
}
