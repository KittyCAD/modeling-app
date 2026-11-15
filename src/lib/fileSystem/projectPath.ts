import { FileNotFound } from '@src/lib/fileSystem/fileSystem'
import { getRelativePathIfContained } from '@src/lib/paths'
import fsZds from '@src/lib/fs-zds'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/** Reject existing links before project-owned I/O. External filesystem writers can still race these checks. */
export async function assertProjectPathWithoutSymlinks(
  operations: Pick<FileOperationsRegistryService, 'stat'>,
  root: string,
  target: string
): Promise<void> {
  if (getRelativePathIfContained(root, target) === undefined)
    return Promise.reject(new Error('File path is outside its project.'))
  const projectRoot = fsZds.resolve(root)
  let path = fsZds.resolve(target)
  while (true) {
    try {
      if (
        (await operations.stat(path, { followSymlinks: false })).kind ===
        'symlink'
      )
        return Promise.reject(
          new Error('Project files cannot traverse symbolic links.')
        )
    } catch (error) {
      if (!(error instanceof FileNotFound)) return Promise.reject(error)
    }
    if (getRelativePathIfContained(projectRoot, path) === '') return
    path = fsZds.dirname(path)
  }
}
