import { defineContract, defineService } from '@kittycad/registry'

export type FileChangeKind = 'created' | 'changed' | 'removed'

export interface FileChange {
  /** Absolute path, as the filesystem service uses. */
  path: string
  kind: FileChangeKind
}

/**
 * Notices files changing underneath the app.
 *
 * Deliberately separate from `FileSystem`: that is *how* to read and write, this
 * is *when something else did*. Keeping them apart is what lets the web build
 * omit watching entirely rather than stub it — the origin-private filesystem is
 * reachable only by this app, so on the web there is nothing external to notice.
 *
 * Every consumer must therefore treat the service as **optional**. A build with
 * no watcher is not degraded; it is a build where the question does not arise.
 *
 * What arrives here is raw: a change this app itself made looks exactly like one
 * a person made in another editor. Telling them apart needs the content, which
 * only the consumer can decide it wants — see `readExternalChange`.
 */
export interface FileWatcher {
  /** `electron`, for diagnostics. */
  readonly id: string
  /**
   * Watch a directory tree. Returns a disposer.
   *
   * Changes are delivered in coalesced batches rather than one event per
   * syscall: a single save from another editor can produce a create, a rename,
   * and two writes, and reacting to each in turn means reading a file that is
   * still being written.
   *
   * Watching the same directory twice is cheap — one operating-system watch is
   * shared — so a feature should watch what it cares about rather than route
   * events through whoever watched first.
   */
  watch(
    path: string,
    listener: (changes: readonly FileChange[]) => void
  ): () => void
}

export const fileWatcherContract = defineContract({
  fileWatcherService: defineService<FileWatcher>('fileSystem.watcher'),
})

export const { fileWatcherService } = fileWatcherContract
