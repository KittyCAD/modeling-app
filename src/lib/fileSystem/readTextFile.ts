import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/** Read a file as UTF-8 text. */
export async function readTextFile(
  operations: Pick<FileOperationsRegistryService, 'readFile'>,
  path: string
): Promise<string> {
  return new TextDecoder().decode(await operations.readFile(path))
}
