import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

export interface FileStat {
  kind: 'file' | 'directory'
  size: number
  modifiedAt: number
}

export interface DirectoryEntry {
  name: string
  kind: 'file' | 'directory'
}

/**
 * Somewhere files live.
 *
 * One interface with two implementations — the desktop's real filesystem and
 * the browser's origin-private filesystem — so everything above this line, most
 * importantly directory libraries, works on both platforms without knowing
 * which it is running on.
 *
 * Paths use forward slashes throughout. On desktop they are absolute paths the
 * user has granted access to; on the web they are rooted at a virtual `/`.
 */
export interface FileSystem {
  /** `electron` or `opfs`. Shown in diagnostics, not in normal UI. */
  readonly id: string
  /**
   * Directories this filesystem will serve.
   *
   * On desktop the user grants these by picking them; on the web there is one.
   * A library configured outside every root cannot be read, and says so rather
   * than appearing empty.
   */
  readonly roots: ReadonlySignal<readonly string[]>
  /** Where a library goes when the user has not chosen anywhere. */
  readonly defaultRoot: ReadonlySignal<string>

  stat(path: string): Promise<FileStat>
  exists(path: string): Promise<boolean>
  readDirectory(path: string): Promise<readonly DirectoryEntry[]>
  readTextFile(path: string): Promise<string>
  /**
   * Read a file that is allowed not to exist.
   *
   * `null` for a missing file rather than a rejection, because "not there yet" is
   * an ordinary answer for the files this app treats as optional — a project's
   * settings are not written until something is set. Every other failure still
   * rejects: unreadable is not the same as absent.
   *
   * Its own method rather than `exists` followed by `readTextFile`, which asks
   * two questions to answer one and leaves a gap between them. On desktop it also
   * keeps the main process from logging a failed handler for a file nobody
   * expected to find.
   */
  readTextFileIfPresent(path: string): Promise<string | null>
  readFile(path: string): Promise<Uint8Array>
  /** Write bytes verbatim, creating parent directories as needed. */
  writeFile(path: string, contents: Uint8Array): Promise<void>
  writeTextFile(path: string, contents: string): Promise<void>
  makeDirectory(path: string): Promise<void>
  /** Recursive. Moves to the OS trash where the platform has one. */
  remove(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>

  /**
   * Ask the user for a directory, granting access to it.
   *
   * Absent on platforms that cannot prompt, which is why callers must check for
   * it rather than assume a picker exists.
   */
  chooseDirectory?(options?: {
    title?: string
    defaultPath?: string
  }): Promise<string | null>
}

export const fileSystemContract = defineContract({
  fileSystemService: defineService<FileSystem>('fileSystem.service'),
})

export const { fileSystemService } = fileSystemContract
