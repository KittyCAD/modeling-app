import type { ProjectFile } from '@src/contracts/projects'

export interface FileChoice {
  /** Project-relative path, which is what the session opens. */
  path: string
  name: string
}

export interface FileChoiceGroup {
  /** The containing directory's project-relative path. Empty for the root. */
  directory: string
  files: readonly FileChoice[]
}

/**
 * The KCL files a project offers, grouped by the folder they sit in.
 *
 * KCL only, because this chooses what the engine executes and the session
 * refuses anything else that role — offering a markdown file would be offering
 * half an action.
 *
 * Flattened into groups rather than kept as a tree. This is a chooser, not the
 * explorer: every file is one click away, no folder needs opening first, and
 * nesting a tree inside a menu would bring expansion state and the tree's own
 * create-rename-delete affordances along with it.
 *
 * Root files come first, then folders alphabetically, and files by name within
 * each — so the list is stable between openings even though the filesystem
 * listing's order is not something to rely on.
 */
export function kclFileChoices(
  files: readonly ProjectFile[]
): readonly FileChoiceGroup[] {
  const groups = new Map<string, FileChoice[]>()

  const walk = (entries: readonly ProjectFile[], directory: string) => {
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        walk(entry.children ?? [], entry.path)
        continue
      }
      if (!entry.name.endsWith('.kcl')) continue

      const bucket = groups.get(directory)
      if (bucket) bucket.push({ path: entry.path, name: entry.name })
      else groups.set(directory, [{ path: entry.path, name: entry.name }])
    }
  }

  walk(files, '')

  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === '') return -1
      if (b === '') return 1
      return a.localeCompare(b)
    })
    .map(([directory, entries]) => ({
      directory,
      files: [...entries].sort((a, b) => a.name.localeCompare(b.name)),
    }))
}
