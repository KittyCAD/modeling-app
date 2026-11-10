import { DUPLICATE_PROJECT_TEMPORARY_PREFIX } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import { v4 } from 'uuid'

/** Publish a populated project by renaming its hidden sibling directory. */
export async function createStagedProject(
  operations: FileOperationsRegistryService,
  projectPath: string,
  populate: (temporaryPath: string) => Promise<void>
): Promise<void> {
  const temporaryPath = fsZds.join(
    fsZds.dirname(projectPath),
    `${DUPLICATE_PROJECT_TEMPORARY_PREFIX}${v4()}`
  )
  await operations.createDirectory(temporaryPath)
  try {
    await populate(temporaryPath)
    await operations.rename(temporaryPath, projectPath)
  } catch (error) {
    await operations.remove(temporaryPath).catch(() => undefined)
    return Promise.reject(error)
  }
}
