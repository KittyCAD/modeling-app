import { FileAlreadyExists } from '@src/lib/fileSystem/fileSystem'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/**
 * Ensure a directory exists without weakening strict create-directory
 * semantics for callers that need to detect collisions.
 */
export async function ensureDirectory(
  fileOperations: FileOperationsRegistryService,
  path: string
): Promise<void> {
  try {
    await fileOperations.createDirectory(path)
  } catch (error) {
    if (!(error instanceof FileAlreadyExists)) {
      return Promise.reject(error)
    }

    const existing = await fileOperations.stat(path)
    if (existing.kind !== 'directory') {
      return Promise.reject(error)
    }
  }
}
