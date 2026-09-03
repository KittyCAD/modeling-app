import { defineContract, defineService } from '@kittycad/registry'
import type { FileNameParts } from '@src/lib/fileSystem/fileNames'
import type {
  CopyOptions,
  DirectoryEntry,
  FileContents,
  FileStat,
} from '@src/lib/fileSystem/fileOperations'

/** Promise facade for coordinated project-directory and file operations. */
export interface FileOperationsRegistryService {
  readonly pending: () => Promise<number>
  /** Observe one path while coordinated mutations of it are excluded. */
  readonly stat: (path: string) => Promise<FileStat>
  /**
   * Observe whether one path currently exists. Use strict or unique creation
   * instead when the result would be used to select a name.
   */
  readonly exists: (path: string) => Promise<boolean>
  /** Read a stable snapshot of a directory's immediate membership. */
  readonly readDirectory: (path: string) => Promise<readonly DirectoryEntry[]>
  /** Read one complete version of a file coordinated with path mutations. */
  readonly readFile: (path: string) => Promise<Uint8Array>
  readonly copy: (
    source: string,
    destination: string,
    options?: CopyOptions
  ) => Promise<void>
  /** Move, falling back to copy-and-remove when rename is unavailable. */
  readonly move: (source: string, destination: string) => Promise<void>
  /** Write bytes, or encode a string as UTF-8, without retaining caller data. */
  readonly writeFile: (path: string, contents: FileContents) => Promise<void>
  /** Create exactly this path from bytes or UTF-8 text without overwriting. */
  readonly createFile: (path: string, contents: FileContents) => Promise<void>
  /** Create the preferred filename or a numbered variant from bytes or text. */
  readonly createUniqueFile: (
    parent: string,
    name: FileNameParts,
    contents: FileContents
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
