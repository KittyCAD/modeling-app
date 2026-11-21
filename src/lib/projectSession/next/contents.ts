import fsZds from '@src/lib/fs-zds'
import type { FileEntry, FileMetadata } from '@src/lib/project'
import type { ProjectDirectory } from '@src/lib/projectSession/next/types'
import type { FileStat } from '@src/lib/fileSystem/fileOperations'
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
  const stats = await fileOperations.stat(projectPath, {
    followSymlinks: false,
  })
  if (stats.kind !== 'directory') {
    return Promise.reject(
      new Error(`Project path is not a directory: ${projectPath}`)
    )
  }

  const children: FileEntry[] = []
  for (const name of await fileOperations.readDirectory(projectPath)) {
    signal?.throwIfAborted()
    const path = fsZds.join(projectPath, name)
    const childStats = await fileOperations.stat(path, {
      followSymlinks: false,
    })
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
