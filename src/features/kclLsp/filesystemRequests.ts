import type { FileSystem } from '@src/contracts/fileSystem'
import type { FsMethod } from '@src/features/kclLsp/workerProtocol'
import { joinPath, normalizePath } from '@src/lib/paths'

/** Absolute in the sense the filesystem contract means: rooted, or drive-prefixed. */
const isAbsolutePath = (path: string) =>
  path.startsWith('/') || /^[a-zA-Z]:/.test(path)

/**
 * Answer the language server's filesystem questions.
 *
 * The server resolves KCL imports, so it reads files the editor has never
 * opened. It cannot do that itself: on desktop the filesystem is behind granted
 * roots in the main process, and on the web it is an origin-private filesystem
 * the renderer owns. So the worker asks, and this answers.
 *
 * Every path is resolved against the project rather than taken as given. A
 * language server is not a trusted component — it is a WASM blob talking to an
 * API — and "read this absolute path" is not a question it gets to ask.
 */
export function createFilesystemResponder(dependencies: {
  fileSystem: () => FileSystem
  projectPath: () => string | null
}) {
  const { fileSystem, projectPath } = dependencies

  const resolve = (path: string) => {
    const root = projectPath()
    if (root === null) throw new Error('No project is open.')

    /*
     * An absolute path is taken at its word and then checked; only a relative
     * one is joined.
     *
     * Joining an absolute path that happens to point elsewhere would quietly
     * produce a nonsense path *inside* the project — `/etc/passwd` becoming
     * `/project/etc/passwd` — and the server would be told the file does not
     * exist rather than that it may not ask. A refusal is the honest answer, and
     * the one that shows up in a log.
     */
    const normalized = normalizePath(path)
    const absolute = isAbsolutePath(normalized)
      ? normalized
      : joinPath(root, normalized)

    if (absolute !== root && !absolute.startsWith(`${root}/`)) {
      throw new Error(`Refusing to read outside the project: ${path}`)
    }
    return absolute
  }

  /** Every file under a directory, absolute, depth first. */
  const allFiles = async (directory: string): Promise<string[]> => {
    const fs = fileSystem()
    const entries = await fs.readDirectory(directory)

    const found: string[] = []
    for (const entry of entries) {
      const child = joinPath(directory, entry.name)
      if (entry.kind === 'directory') {
        found.push(...(await allFiles(child)))
      } else {
        found.push(child)
      }
    }
    return found
  }

  return async (method: FsMethod, path: string): Promise<unknown> => {
    const absolute = resolve(path)
    const fs = fileSystem()

    switch (method) {
      case 'readTextFile':
        return await fs.readTextFile(absolute)

      case 'readFile': {
        const bytes = await fs.readFile(absolute)
        // Sent as the buffer so it transfers as bytes rather than being
        // serialised element by element.
        return bytes.buffer
      }

      case 'exists':
        return await fs.exists(absolute)

      case 'getAllFiles':
        return await allFiles(absolute)
    }
  }
}
