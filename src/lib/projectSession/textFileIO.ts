import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

/** Text access shared by the files and editors belonging to one project session. */
export interface TextFileIO {
  readonly read: (path: string) => Promise<string>
  readonly write: (path: string, content: string) => Promise<void>
}

export function createTextFileIO(
  operations: Pick<FileOperationsRegistryService, 'readFile' | 'writeFile'>
): TextFileIO {
  return {
    read: async (path) =>
      new TextDecoder().decode(await operations.readFile(path)),
    write: (path, content) => operations.writeFile(path, content),
  }
}
