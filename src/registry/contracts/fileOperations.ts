import { defineContract, defineService } from '@kittycad/registry'
import type { FileNameParts } from '@src/lib/fileSystem/fileNames'

/** Promise facade for coordinated project-directory and file operations. */
export interface FileOperationsRegistryService {
  readonly pending: () => Promise<number>
  /** Read one complete version of a file coordinated with path mutations. */
  readonly readFile: (path: string) => Promise<Uint8Array>
  readonly copy: (source: string, destination: string) => Promise<void>
  readonly writeFile: (path: string, contents: Uint8Array) => Promise<void>
  /** Create exactly this path without overwriting an existing entry. */
  readonly createFile: (path: string, contents: Uint8Array) => Promise<void>
  /** Create the preferred filename or a numbered variant and return its path. */
  readonly createUniqueFile: (
    parent: string,
    name: FileNameParts,
    contents: Uint8Array
  ) => Promise<string>
  /** Create exactly this path, rejecting any existing file or directory. */
  readonly createDirectory: (path: string) => Promise<void>
  /** Create the preferred name or a numbered variant and return its path. */
  readonly createUniqueDirectory: (
    parent: string,
    preferredName: string
  ) => Promise<string>
  readonly remove: (path: string) => Promise<void>
  readonly rename: (source: string, destination: string) => Promise<void>
}

export const fileOperationsContract = defineContract({
  fileOperationsService: defineService<FileOperationsRegistryService>(
    'fileOperations.service'
  ),
})

export const { fileOperationsService } = fileOperationsContract
