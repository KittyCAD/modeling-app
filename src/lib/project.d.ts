/**
 * The permissions of a file.
 */
export type FilePermission = 'read' | 'write' | 'execute'

/**
 * The type of a file.
 */
export type FileType = 'file' | 'directory' | 'symlink'

/**
 * Metadata about a file or directory.
 */
export type FileMetadata = {
  accessed: string | null
  created: string | null
  type: FileType | null
  size: number
  modified: string | null
  permission: FilePermission | null
}

/**
 * Information about a file or directory.
 */
export type FileEntry = {
  path: string
  name: string
  children: Array<FileEntry> | null
}

/**
 * Information about project.
 */
export type Project = {
  metadata: FileMetadata | null
  kcl_file_count: number
  directory_count: number
  /**
   * The default file to open on load.
   */
  default_file: string
  path: string
  name: string
  children: Array<FileEntry> | null
  readWriteAccess: boolean
}
