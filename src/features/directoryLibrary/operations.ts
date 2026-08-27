import type { FileSystem } from '@src/contracts/fileSystem'
import type {
  CreateProjectInput,
  MoveProjectFromInput,
  MoveProjectToInput,
  RealizationInput,
  RenameProjectInput,
} from '@src/contracts/projectLibraries'
import { basename, joinPath, toDirectoryName, uniqueName } from '@src/lib/paths'
import type { ProjectLibraryRealization } from '@src/lib/projectLibraries'
import { realizationId } from '@src/lib/projectLibraries'

/** Folder names already taken inside a library. */
async function takenNames(
  fileSystem: FileSystem,
  libraryPath: string
): Promise<string[]> {
  try {
    const entries = await fileSystem.readDirectory(libraryPath)
    return entries.map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * Pick a folder name for a title, avoiding collisions.
 *
 * Titles are free text and folder names are not, so the two are allowed to
 * diverge: the title lives in `project.toml` and the folder gets a safe,
 * unique derivative.
 */
async function folderNameFor(
  fileSystem: FileSystem,
  libraryPath: string,
  requestedTitle: string
): Promise<string> {
  return uniqueName(
    toDirectoryName(requestedTitle),
    await takenNames(fileSystem, libraryPath)
  )
}

async function writeProjectTitle(
  fileSystem: FileSystem,
  projectPath: string,
  title: string
): Promise<void> {
  // Quotes in a title would break the file, and a title is not worth a TOML
  // serializer here.
  const safeTitle = title.replaceAll('"', "'")
  await fileSystem.writeTextFile(
    joinPath(projectPath, 'project.toml'),
    `title = "${safeTitle}"\n`
  )
}

/** Recursively copy a folder. Used when a rename cannot cross the boundary. */
async function copyDirectory(
  fileSystem: FileSystem,
  from: string,
  to: string
): Promise<void> {
  await fileSystem.makeDirectory(to)
  for (const entry of await fileSystem.readDirectory(from)) {
    const source = joinPath(from, entry.name)
    const target = joinPath(to, entry.name)
    if (entry.kind === 'directory') {
      await copyDirectory(fileSystem, source, target)
    } else {
      await fileSystem.writeTextFile(
        target,
        await fileSystem.readTextFile(source)
      )
    }
  }
}

/**
 * Move a folder, falling back to copy-then-delete.
 *
 * `rename` fails across filesystems, and two granted roots can easily be on
 * different volumes, so the fallback is the normal path rather than an edge case.
 */
async function movePath(
  fileSystem: FileSystem,
  from: string,
  to: string
): Promise<void> {
  try {
    await fileSystem.rename(from, to)
  } catch {
    await copyDirectory(fileSystem, from, to)
    await fileSystem.remove(from)
  }
}

export function createDirectoryLibraryOperations(
  getFileSystem: () => FileSystem
) {
  return {
    createProject: {
      async run({
        library,
        requestedTitle,
        initialFile,
      }: CreateProjectInput): Promise<ProjectLibraryRealization | undefined> {
        const fileSystem = getFileSystem()
        const title = requestedTitle.trim() || 'untitled'
        const name = await folderNameFor(fileSystem, library.path, title)
        const path = joinPath(library.path, name)

        await fileSystem.makeDirectory(path)
        // Write the entry file before the title, so the project is never
        // discoverable in a state with no KCL in it.
        await fileSystem.writeTextFile(
          joinPath(path, initialFile?.name ?? 'main.kcl'),
          initialFile?.contents ?? ''
        )
        if (title !== name) await writeProjectTitle(fileSystem, path, title)

        return {
          id: realizationId(path),
          libraryIds: [library.id],
          path,
          name,
          title: title === name ? undefined : title,
          modifiedAt: Date.now(),
          fileCount: 1,
          kclFileCount: 1,
          directoryCount: 0,
          readWriteAccess: true,
          defaultFile: initialFile?.name ?? 'main.kcl',
        }
      },
    },

    renameProject: {
      async run({
        library,
        realization,
        requestedTitle,
      }: RenameProjectInput): Promise<void> {
        const fileSystem = getFileSystem()
        const title = requestedTitle.trim()
        if (!title) return

        // The title is authoritative; the folder follows it when it can. If a
        // sibling already holds the derived name, only the title changes.
        await writeProjectTitle(fileSystem, realization.path, title)

        const desired = toDirectoryName(title)
        if (desired === realization.name) return

        const siblings = (await takenNames(fileSystem, library.path)).filter(
          (name) => name !== realization.name
        )
        if (siblings.includes(desired)) return

        await movePath(
          fileSystem,
          realization.path,
          joinPath(library.path, desired)
        )
      },
    },

    deleteProject: {
      async run({ realization }: RealizationInput): Promise<void> {
        await getFileSystem().remove(realization.path)
      },
    },

    moveProjectTo: {
      async run({
        library,
        realization,
      }: MoveProjectToInput): Promise<ProjectLibraryRealization | undefined> {
        const fileSystem = getFileSystem()
        const name = uniqueName(
          basename(realization.path),
          await takenNames(fileSystem, library.path)
        )
        const path = joinPath(library.path, name)

        // Copy rather than move: the source releases separately, so a failure
        // here leaves the project where it was.
        await copyDirectory(fileSystem, realization.path, path)

        return {
          ...realization,
          id: realizationId(path),
          libraryIds: [library.id],
          path,
          name,
        }
      },
    },

    moveProjectFrom: {
      async run({ realization }: MoveProjectFromInput): Promise<void> {
        await getFileSystem().remove(realization.path)
      },
    },
  }
}
