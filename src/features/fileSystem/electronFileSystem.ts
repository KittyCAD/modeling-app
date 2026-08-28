import { computed, signal } from '@preact/signals'
import type { FileSystem } from '@src/contracts/fileSystem'
import type { DesktopBridge } from '@src/desktop/preload'
import { normalizePath } from '@src/lib/paths'

/**
 * The desktop filesystem, through the preload bridge.
 *
 * Every path is confined in the main process to a directory the user granted,
 * so this side does no checking of its own — duplicating the check here would
 * imply the renderer's copy is load-bearing, and it never is.
 */
export function createElectronFileSystem(bridge: DesktopBridge): FileSystem {
  const roots = signal<readonly string[]>([])
  const defaultRoot = signal('')

  // Populated once at construction; grants change only through the picker,
  // which updates these itself.
  void Promise.all([bridge.grantedRoots(), bridge.projectsDirectory()])
    .then(([granted, projects]) => {
      roots.value = granted.map(normalizePath)
      defaultRoot.value = normalizePath(projects)
    })
    .catch((error) => {
      console.error('fileSystem: could not read granted roots', error)
    })

  return {
    id: 'electron',
    roots: computed(() => roots.value),
    defaultRoot: computed(() => defaultRoot.value),

    stat: (path) => bridge.stat(path),
    exists: (path) => bridge.exists(path),
    readDirectory: (path) => bridge.readDirectory(path),
    readTextFile: (path) => bridge.readTextFile(path),
    readTextFileIfPresent: (path) => bridge.readTextFileIfPresent(path),
    readFile: (path) => bridge.readFile(path),
    writeTextFile: (path, contents) => bridge.writeTextFile(path, contents),
    makeDirectory: (path) => bridge.makeDirectory(path),
    remove: (path) => bridge.remove(path),
    rename: (from, to) => bridge.rename(from, to),

    async chooseDirectory(options) {
      const chosen = await bridge.chooseDirectory(options)
      if (!chosen) return null

      // Picking grants access, so the root list has changed.
      roots.value = (await bridge.grantedRoots()).map(normalizePath)
      return normalizePath(chosen)
    },
  }
}
