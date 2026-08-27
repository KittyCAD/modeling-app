import { computed, signal } from '@preact/signals'
import type { FileSystem } from '@src/contracts/fileSystem'
import { dirname, normalizePath } from '@src/lib/paths'

export interface FakeFileSystem extends FileSystem {
  /** Every file currently stored, keyed by absolute path. */
  readonly files: Map<string, string>
  /** Directories that exist with no files in them. */
  readonly directories: Set<string>
}

/**
 * An in-memory filesystem for tests.
 *
 * Flat storage with directories derived from the paths, which is enough for
 * everything above the filesystem layer and avoids tests depending on OPFS or on
 * a real disk. `stat` returns a fixed modified time unless one is set, so
 * assertions on ordering stay deterministic.
 */
export function createFakeFileSystem(
  initial: Record<string, string> = {},
  options: { modifiedTimes?: Record<string, number> } = {}
): FakeFileSystem {
  const files = new Map<string, string>(
    Object.entries(initial).map(([path, contents]) => [
      normalizePath(path),
      contents,
    ])
  )
  const directories = new Set<string>()
  const modifiedTimes = new Map<string, number>(
    Object.entries(options.modifiedTimes ?? {}).map(([path, time]) => [
      normalizePath(path),
      time,
    ])
  )
  const roots = signal<readonly string[]>(['/'])

  const ancestorsOf = (path: string): string[] => {
    const parts: string[] = []
    let current = dirname(path)
    while (current && current !== '/' && !parts.includes(current)) {
      parts.push(current)
      current = dirname(current)
    }
    return parts
  }

  const allDirectories = () => {
    const found = new Set(directories)
    for (const path of files.keys()) {
      for (const ancestor of ancestorsOf(path)) found.add(ancestor)
    }
    return found
  }

  const isDirectory = (path: string) =>
    path === '/' || allDirectories().has(normalizePath(path))

  return {
    id: 'fake',
    files,
    directories,
    roots: computed(() => roots.value),
    defaultRoot: computed(() => '/'),

    async stat(path) {
      const normalized = normalizePath(path)
      if (files.has(normalized)) {
        return {
          kind: 'file',
          size: files.get(normalized)?.length ?? 0,
          modifiedAt: modifiedTimes.get(normalized) ?? 1_000,
        }
      }
      if (isDirectory(normalized)) {
        return {
          kind: 'directory',
          size: 0,
          modifiedAt: modifiedTimes.get(normalized) ?? 1_000,
        }
      }
      throw new Error(`ENOENT: ${path}`)
    },

    async exists(path) {
      const normalized = normalizePath(path)
      return files.has(normalized) || isDirectory(normalized)
    },

    async readDirectory(path) {
      const normalized = normalizePath(path)
      if (!isDirectory(normalized)) throw new Error(`ENOTDIR: ${path}`)

      const prefix = normalized === '/' ? '/' : `${normalized}/`
      const names = new Map<string, 'file' | 'directory'>()

      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue
        const rest = filePath.slice(prefix.length)
        const [head] = rest.split('/')
        names.set(head, rest.includes('/') ? 'directory' : 'file')
      }
      for (const directory of allDirectories()) {
        if (!directory.startsWith(prefix)) continue
        const [head] = directory.slice(prefix.length).split('/')
        if (head) names.set(head, 'directory')
      }

      return Array.from(names, ([name, kind]) => ({ name, kind }))
    },

    async readTextFile(path) {
      const normalized = normalizePath(path)
      const contents = files.get(normalized)
      if (contents === undefined) throw new Error(`ENOENT: ${path}`)
      return contents
    },

    async readFile(path) {
      return new TextEncoder().encode(await this.readTextFile(path))
    },

    async writeTextFile(path, contents) {
      files.set(normalizePath(path), contents)
    },

    async makeDirectory(path) {
      directories.add(normalizePath(path))
    },

    async remove(path) {
      const normalized = normalizePath(path)
      files.delete(normalized)
      directories.delete(normalized)
      const prefix = `${normalized}/`
      for (const filePath of [...files.keys()]) {
        if (filePath.startsWith(prefix)) files.delete(filePath)
      }
      for (const directory of [...directories]) {
        if (directory.startsWith(prefix)) directories.delete(directory)
      }
    },

    async rename(from, to) {
      const normalizedFrom = normalizePath(from)
      const normalizedTo = normalizePath(to)

      if (files.has(normalizedFrom)) {
        files.set(normalizedTo, files.get(normalizedFrom) ?? '')
        files.delete(normalizedFrom)
        return
      }

      const prefix = `${normalizedFrom}/`
      for (const filePath of [...files.keys()]) {
        if (!filePath.startsWith(prefix)) continue
        files.set(
          `${normalizedTo}/${filePath.slice(prefix.length)}`,
          files.get(filePath) ?? ''
        )
        files.delete(filePath)
      }
      directories.delete(normalizedFrom)
      directories.add(normalizedTo)
    },
  }
}
