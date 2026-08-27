import type { FileSystem } from '@src/contracts/fileSystem'
import { basename, extname, joinPath, normalizePath } from '@src/lib/paths'
import type { ProjectLibraryRealizationContribution } from '@src/lib/projectLibraries'
import { realizationId } from '@src/lib/projectLibraries'

/** A project's own metadata file, if it has one. */
const PROJECT_FILE = 'project.toml'
const KCL_EXTENSION = '.kcl'
/** Depth is bounded: a project folder is not a source tree. */
const MAX_SCAN_DEPTH = 4

interface ProjectFolderSummary {
  fileCount: number
  kclFileCount: number
  directoryCount: number
  kclFiles: string[]
}

/**
 * Read a title out of `project.toml`.
 *
 * A deliberately narrow reader rather than a TOML parse: the only key that
 * matters here is a top-level `title`, and a project whose metadata is
 * unparseable should still appear, named after its folder.
 */
export function parseProjectTitle(contents: string): string | undefined {
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    // Stop at the first table header; `title` is a top-level key.
    if (trimmed.startsWith('[')) break

    const match = /^title\s*=\s*(.*)$/.exec(trimmed)
    if (!match) continue

    const value = match[1].trim().replace(/^["']|["']$/g, '')
    return value.length > 0 ? value : undefined
  }
  return undefined
}

/** Walk a project folder, counting what is in it. */
async function summarizeProjectFolder(
  fileSystem: FileSystem,
  path: string,
  signal: AbortSignal,
  depth = 0
): Promise<ProjectFolderSummary> {
  const summary: ProjectFolderSummary = {
    fileCount: 0,
    kclFileCount: 0,
    directoryCount: 0,
    kclFiles: [],
  }
  if (signal.aborted || depth > MAX_SCAN_DEPTH) return summary

  let entries: Awaited<ReturnType<FileSystem['readDirectory']>>
  try {
    entries = await fileSystem.readDirectory(path)
  } catch {
    // An unreadable subdirectory contributes nothing rather than failing the
    // whole library scan.
    return summary
  }

  for (const entry of entries) {
    if (signal.aborted) return summary
    if (entry.name.startsWith('.')) continue

    if (entry.kind === 'directory') {
      summary.directoryCount += 1
      const nested = await summarizeProjectFolder(
        fileSystem,
        joinPath(path, entry.name),
        signal,
        depth + 1
      )
      summary.fileCount += nested.fileCount
      summary.kclFileCount += nested.kclFileCount
      summary.directoryCount += nested.directoryCount
      summary.kclFiles.push(
        ...nested.kclFiles.map((file) => `${entry.name}/${file}`)
      )
      continue
    }

    summary.fileCount += 1
    if (extname(entry.name).toLowerCase() === KCL_EXTENSION) {
      summary.kclFileCount += 1
      summary.kclFiles.push(entry.name)
    }
  }

  return summary
}

/**
 * Which file a project opens into.
 *
 * `main.kcl` at the root wins, then any root-level KCL file, then the shallowest
 * one anywhere. Sorting by depth keeps a nested `parts/foo.kcl` from being
 * chosen over a root file just because it sorts earlier.
 */
export function pickDefaultFile(
  kclFiles: readonly string[]
): string | undefined {
  if (kclFiles.length === 0) return undefined

  const root = kclFiles.filter((file) => !file.includes('/'))
  if (root.includes('main.kcl')) return 'main.kcl'
  if (root.length > 0) return root.toSorted((a, b) => a.localeCompare(b))[0]

  return kclFiles.toSorted(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)
  )[0]
}

/**
 * Discover project folders in one directory library.
 *
 * A project is any immediate subdirectory. Folders with no KCL file at all are
 * skipped, so an unrelated directory the user happens to keep alongside their
 * projects does not show up as an empty project card.
 */
export async function readDirectoryLibraryRealizations({
  fileSystem,
  libraryPath,
  signal,
  excludePaths = [],
}: {
  fileSystem: FileSystem
  libraryPath: string
  signal: AbortSignal
  /** Nested library roots. These are libraries, not projects. */
  excludePaths?: readonly string[]
}): Promise<ProjectLibraryRealizationContribution[]> {
  // Creating the root on demand means a freshly configured library works
  // without the user having to make the folder first.
  await fileSystem.makeDirectory(libraryPath).catch(() => {})

  const entries = await fileSystem.readDirectory(libraryPath)
  const excluded = new Set(excludePaths.map(normalizePath))
  const realizations: ProjectLibraryRealizationContribution[] = []

  for (const entry of entries) {
    if (signal.aborted) return realizations
    if (entry.kind !== 'directory' || entry.name.startsWith('.')) continue

    const path = joinPath(libraryPath, entry.name)
    if (excluded.has(path)) continue
    const summary = await summarizeProjectFolder(fileSystem, path, signal)
    if (summary.kclFileCount === 0) continue

    const [stat, title] = await Promise.all([
      fileSystem.stat(path).catch(() => undefined),
      fileSystem
        .readTextFile(joinPath(path, PROJECT_FILE))
        .then(parseProjectTitle)
        .catch(() => undefined),
    ])

    realizations.push({
      id: realizationId(path),
      path,
      name: basename(path),
      title,
      modifiedAt: stat?.modifiedAt ?? 0,
      fileCount: summary.fileCount,
      kclFileCount: summary.kclFileCount,
      directoryCount: summary.directoryCount,
      // Write access is assumed until an operation proves otherwise; probing
      // every folder on every scan would cost more than the answer is worth.
      readWriteAccess: true,
      defaultFile: pickDefaultFile(summary.kclFiles),
    })
  }

  return realizations
}
