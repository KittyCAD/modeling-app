import type { FileSystem } from '@src/contracts/fileSystem'
import type { ProjectFile } from '@src/contracts/projects'
import { extname, joinPath } from '@src/lib/paths'

/** Bounded so an unexpectedly deep tree cannot stall the explorer. */
const MAX_DEPTH = 8

/**
 * Read a project's file tree.
 *
 * Directories first, then case-insensitive alphabetical within each group —
 * the order a file explorer is expected to show, rather than whatever order the
 * filesystem happens to return.
 */
export async function readProjectFileTree(
  fileSystem: FileSystem,
  projectPath: string,
  depth = 0
): Promise<ProjectFile[]> {
  if (depth > MAX_DEPTH) return []

  let entries: Awaited<ReturnType<FileSystem['readDirectory']>>
  try {
    entries = await fileSystem.readDirectory(projectPath)
  } catch (error) {
    // An unreadable *subdirectory* contributes nothing rather than failing the
    // whole tree. An unreadable project root is a real failure the caller has to
    // report, since the alternative is a project that looks empty.
    if (depth === 0) throw error
    return []
  }

  const files: ProjectFile[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    const absolute = joinPath(projectPath, entry.name)
    if (entry.kind === 'directory') {
      files.push({
        path: entry.name,
        name: entry.name,
        kind: 'directory',
        children: (
          await readProjectFileTree(fileSystem, absolute, depth + 1)
        ).map((child) => ({
          ...child,
          // Re-root nested paths so every path is project-relative.
          path: `${entry.name}/${child.path}`,
        })),
      })
      continue
    }

    files.push({ path: entry.name, name: entry.name, kind: 'file' })
  }

  return sortProjectFiles(files)
}

export function sortProjectFiles(files: ProjectFile[]): ProjectFile[] {
  return files
    .toSorted(
      (a, b) =>
        Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
        a.name.localeCompare(b.name)
    )
    .map((file) =>
      file.children
        ? { ...file, children: sortProjectFiles(file.children) }
        : file
    )
}

/** The language id a path selects, used to pick editor capabilities. */
export function languageForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.kcl':
      return 'kcl'
    case '.md':
      return 'markdown'
    case '.toml':
      return 'toml'
    case '.json':
      return 'json'
    default:
      return 'plaintext'
  }
}
