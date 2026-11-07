import { ensureDirectory } from '@src/lib/fileSystem/ensureDirectory'
import fsZds from '@src/lib/fs-zds'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/** Write a file after ensuring its parent directory exists. */
export async function writeFileWithParents(
  operations: FileOperationsRegistryService,
  path: string,
  contents: string | Uint8Array
): Promise<void> {
  await ensureDirectory(operations, fsZds.dirname(path))
  return operations.writeFile(path, contents)
}
