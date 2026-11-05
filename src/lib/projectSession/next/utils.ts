import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import { isPathNotFoundError } from '@src/lib/desktop'
import type { ProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'
import { readProjectMetadataFromToml } from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import type { FileStat } from '@src/lib/fileSystem/fileOperations'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, FileMetadata } from '@src/lib/project'
import type {
  Project,
  ProjectDirectory,
} from '@src/lib/projectSession/next/types'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/** Adapt filesystem stats to the file-entry metadata shared with the legacy project tree. */
function convertFileStatToFileMetadata(stats: FileStat): FileMetadata {
  return {
    modified: stats.modifiedAt,
    accessed: stats.accessedAt,
    created: stats.createdAt,
    type: null,
    size: stats.size,
    permission: null,
  }
}

/**
 * Read a directory tree, including configuration, hidden, and gitignored entries.
 * Unlike the explorer reader, this does not filter for display or require write access.
 * File bytes are read separately; symlinks are recorded as leaf entries, not followed.
 * The request signal stops a cancelled opening from traversing the remaining tree.
 */
export async function getProjectContents(
  fileOperations: Pick<FileOperationsRegistryService, 'stat' | 'readDirectory'>,
  projectPath: string,
  signal?: AbortSignal
): Promise<ProjectDirectory> {
  signal?.throwIfAborted()
  const stats = await fileOperations.stat(projectPath)
  if (stats.kind !== 'directory') {
    return Promise.reject(
      new Error(`Project path is not a directory: ${projectPath}`)
    )
  }

  const children: FileEntry[] = []
  for (const name of await fileOperations.readDirectory(projectPath)) {
    signal?.throwIfAborted()
    const path = fsZds.join(projectPath, name)
    const childStats = await fileOperations.stat(path)
    children.push(
      childStats.kind === 'directory'
        ? await getProjectContents(fileOperations, path, signal)
        : {
            name,
            path,
            metadata: convertFileStatToFileMetadata(childStats),
            children: null,
          }
    )
  }
  signal?.throwIfAborted()
  return {
    name: fsZds.basename(projectPath),
    path: projectPath,
    metadata: convertFileStatToFileMetadata(stats),
    children,
  }
}

/**
 * Read a local project snapshot without the legacy settings/default-file initialization.
 * The optional root project.toml supplies the title and initial file; missing or empty
 * titles fall back to the directory name. Read and parse failures propagate.
 * Library ownership is supplied by the caller and write access is observed at open time.
 */
export async function readProject(
  fileOperations: Pick<
    FileOperationsRegistryService,
    'stat' | 'readDirectory' | 'readFile' | 'canReadWrite'
  >,
  projectPath: string,
  options: { signal?: AbortSignal; library?: ProjectLibraryOwnership } = {}
): Promise<Project> {
  const { signal, library } = options
  const contents = await getProjectContents(fileOperations, projectPath, signal)
  let toml: string | undefined
  try {
    toml = new TextDecoder().decode(
      await fileOperations.readFile(
        fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
      )
    )
  } catch (error) {
    if (!isPathNotFoundError(error)) return Promise.reject(error)
  }
  signal?.throwIfAborted()
  const metadata = toml === undefined ? {} : readProjectMetadataFromToml(toml)
  if (isErr(metadata)) return Promise.reject(metadata)
  const readWriteAccess = await fileOperations.canReadWrite(projectPath)
  signal?.throwIfAborted()
  return {
    contents,
    metadata: {
      title: metadata.title ?? contents.name,
      ...(metadata.defaultFile ? { defaultFile: metadata.defaultFile } : {}),
      library,
      readWriteAccess,
    },
  }
}
