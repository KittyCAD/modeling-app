import { type ReadonlySignal, computed, signal } from '@preact/signals'
import type {
  DirectoryEntry,
  FileStat,
  FileSystem,
} from '@src/contracts/fileSystem'
import { basename, dirname, normalizePath } from '@src/lib/paths'

const ROOT = '/'

/**
 * The browser's origin-private filesystem.
 *
 * Real directories and real files, private to the origin and persistent across
 * reloads — which is what lets directory libraries be the *only* library type
 * and still work on the web. It replaces the localStorage stand-in that came
 * before it.
 *
 * There is one root and no picker: the browser does not let a page reach
 * anywhere else without a user gesture per directory, and a library that
 * silently loses access on reload would be worse than a single fixed root.
 */
export function createOpfsFileSystem(): FileSystem {
  const roots = signal<readonly string[]>([ROOT])

  const segments = (path: string) =>
    normalizePath(path)
      .split('/')
      .filter((segment) => segment.length > 0)

  const rootHandle = async () => {
    if (!navigator.storage?.getDirectory) {
      throw new Error(
        'This browser does not support local file storage, so projects cannot be saved.'
      )
    }
    return navigator.storage.getDirectory()
  }

  /** Walk to a directory, optionally creating the path as it goes. */
  const directoryHandle = async (
    path: string,
    create = false
  ): Promise<FileSystemDirectoryHandle> => {
    let handle = await rootHandle()
    for (const segment of segments(path)) {
      handle = await handle.getDirectoryHandle(segment, { create })
    }
    return handle
  }

  const fileHandle = async (
    path: string,
    create = false
  ): Promise<FileSystemFileHandle> => {
    const parent = await directoryHandle(dirname(path), create)
    return parent.getFileHandle(basename(path), { create })
  }

  const entriesOf = async (
    handle: FileSystemDirectoryHandle
  ): Promise<DirectoryEntry[]> => {
    const entries: DirectoryEntry[] = []
    // `values()` is an async iterator, so there is no length to preallocate.
    for await (const child of handle.values()) {
      entries.push({
        name: child.name,
        kind: child.kind === 'directory' ? 'directory' : 'file',
      })
    }
    return entries
  }

  return {
    id: 'opfs',
    roots: computed(() => roots.value) as ReadonlySignal<readonly string[]>,
    defaultRoot: computed(() => ROOT),

    async stat(path): Promise<FileStat> {
      const normalized = normalizePath(path)

      // Try the file case first; a directory has no size or timestamp of its
      // own in OPFS, so it falls through to a synthesised stat.
      try {
        const handle = await fileHandle(normalized)
        const file = await handle.getFile()
        return {
          kind: 'file',
          size: file.size,
          modifiedAt: file.lastModified,
        }
      } catch {
        // Not a file, or missing. Fall through.
      }

      await directoryHandle(normalized)
      return { kind: 'directory', size: 0, modifiedAt: 0 }
    },

    async exists(path) {
      try {
        await this.stat(path)
        return true
      } catch {
        return false
      }
    },

    async readDirectory(path) {
      return entriesOf(await directoryHandle(path))
    },

    async readTextFile(path) {
      const handle = await fileHandle(path)
      return (await handle.getFile()).text()
    },

    async readFile(path) {
      const handle = await fileHandle(path)
      const buffer = await (await handle.getFile()).arrayBuffer()
      return new Uint8Array(buffer)
    },

    async writeTextFile(path, contents) {
      const handle = await fileHandle(path, true)
      const writable = await handle.createWritable()
      try {
        await writable.write(contents)
      } finally {
        // Closing is what commits the write, so it must happen even on failure.
        await writable.close()
      }
    },

    async makeDirectory(path) {
      await directoryHandle(path, true)
    },

    async remove(path) {
      const parent = await directoryHandle(dirname(path))
      await parent.removeEntry(basename(path), { recursive: true })
    },

    async rename(from, to) {
      // OPFS has no rename, so a directory move is a recursive copy plus a
      // delete. Acceptable for project folders, which are small.
      const stat = await this.stat(from)

      if (stat.kind === 'file') {
        await this.writeTextFile(to, await this.readTextFile(from))
        await this.remove(from)
        return
      }

      const copyDirectory = async (source: string, target: string) => {
        await this.makeDirectory(target)
        for (const entry of await this.readDirectory(source)) {
          const childSource = `${source}/${entry.name}`
          const childTarget = `${target}/${entry.name}`
          if (entry.kind === 'directory') {
            await copyDirectory(childSource, childTarget)
          } else {
            await this.writeTextFile(
              childTarget,
              await this.readTextFile(childSource)
            )
          }
        }
      }

      await copyDirectory(from, to)
      await this.remove(from)
    },
  }
}
