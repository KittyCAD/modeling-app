import type { FileEntry } from '@src/lib/project'
import type { ProjectLibraryOwnership } from '@src/lib/projectLibraryOwnership'

/** A project root is always a directory, including when it has no files. */
export interface ProjectDirectory extends FileEntry {
  children: FileEntry[]
}

/** Project data observed at open time; storage operations and editors live in the session. */
export interface Project {
  contents: ProjectDirectory
  metadata: {
    title: string
    /** Project-relative initial editor source, when configured in project.toml. */
    defaultFile?: string
    /** Absent when opened outside configured libraries. */
    library?: ProjectLibraryOwnership
    /** Observed platform grant, not a promise that future writes will succeed. */
    readWriteAccess: boolean
  }
}
