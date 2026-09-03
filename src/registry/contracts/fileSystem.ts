import { defineContract, defineService } from '@kittycad/registry'
import type { DirectoryEntry, FileStat } from '@src/lib/fileSystem/fileSystem'

/**
 * Promise facade for the mounted filesystem capability.
 *
 * Effect programs compose against the FileSystem tag. This registry contract
 * keeps interpretation private to the runtime adapter while registry consumers
 * use conventional Promises.
 */
export interface FileSystemRegistryService {
  readonly stat: (path: string) => Promise<FileStat>
  readonly exists: (path: string) => Promise<boolean>
  readonly readDirectory: (path: string) => Promise<readonly DirectoryEntry[]>
  readonly readFile: (path: string) => Promise<Uint8Array>
  readonly copy: (source: string, destination: string) => Promise<void>
  readonly writeFile: (path: string, contents: Uint8Array) => Promise<void>
  readonly makeDirectory: (path: string) => Promise<void>
  readonly remove: (path: string) => Promise<void>
  readonly rename: (source: string, destination: string) => Promise<void>
}

export const fileSystemContract = defineContract({
  fileSystemService:
    defineService<FileSystemRegistryService>('fileSystem.service'),
})

export const { fileSystemService } = fileSystemContract
