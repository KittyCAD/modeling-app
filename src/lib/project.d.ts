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
  /**
   * Absolute path
   * /home/kevin/Documents/zoo-design-studio-projects/level1/main.kcl
   * ignore the OS specific delimiters
   */
  path: string
  /**
   * Folder name or file name with extension
   * e.g. main.kcl or a-folder-name
   */
  name: string
  /**
   * children : [] is a folder
   * children : [FileEntry, ...] is a folder
   * children : null is a file
   */
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
   * Absolute path most likely to main.kcl within the project
   */
  default_file: string
  /**
   * Absolute path
   */
  path: string 
  /**
   * Folder name of the project
   */
  name: string
  /**
   * children : [] is a folder
   * children : [FileEntry, ...] is a folder
   * children : null is a file
   */
  children: Array<FileEntry> | null
  readWriteAccess: boolean
}
